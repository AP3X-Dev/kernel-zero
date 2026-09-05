#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { PolicyCustodyEvidence } from "@kernel-zero/contracts";
import { isSha256Digest, isUuidV7 } from "@kernel-zero/domain";

import { explain, init, parseExplainArguments, parseInitArguments, type ExplainCommand, type InitCommand } from "./commands";
import { resolveValidatorPaths, type ResolvedValidatorPaths } from "./discovery";
import { remediationsOf, renderCustody, renderEvidence, type RenderableEvidence } from "./render";

export type ValidatorExitCode = 0 | 1 | 2;

export type ValidateCommand = Readonly<{
  command: "validate";
  custodyOut?: string;
  exceptions?: string;
  exceptionsTrustKey?: string;
  out: string;
  policy: string;
  policyApproval?: string;
  root: string;
  workspace: string;
  workspaceTrust?: string;
}>;

export type ExportExceptionsCommand = Readonly<{
  command: "exceptions-export";
  out: string;
  policyDigest: string;
}>;

export type CliCommand = ValidateCommand | ExportExceptionsCommand | ExplainCommand | InitCommand;

export type ResolvedValidateCommand = Readonly<ResolvedValidatorPaths & { command: "validate" }>;
export type ValidationOutcome = Readonly<{ outcome: "pass" | "violations" | "error" }>;
/** What an executor may hand back: the outcome, plus the artifacts the CLI renders when present. */
export type ValidationReport = ValidationOutcome & Readonly<{
  custody?: PolicyCustodyEvidence | null;
  evidence?: RenderableEvidence;
  policy?: Readonly<{ rules: readonly Readonly<{ id: string; remediation: string }>[] }>;
}>;
export type ValidationExecutor = (command: ResolvedValidateCommand) => Promise<ValidationReport>;

const REQUIRED_OPTIONS = ["--policy", "--root", "--workspace", "--out"] as const;
const CUSTODY_OPTIONS = ["--policy-approval", "--workspace-trust", "--custody-out"] as const;
const ALLOWED_OPTIONS = new Set([...REQUIRED_OPTIONS, "--exceptions", "--exceptions-trust-key", ...CUSTODY_OPTIONS]);

export class CliUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

/** Custody was validly proven to fail: custody evidence is written, source is never scanned, exit is 1. */
export class CustodyRejectedError extends Error {
  public constructor(public readonly custody: PolicyCustodyEvidence) {
    super("Policy custody verification failed.");
    this.name = "CustodyRejectedError";
  }
}

export function isDirectExecution(
  moduleUrl: string,
  argvPath: string | undefined,
  resolveRealPath: (path: string) => string = realpathSync,
): boolean {
  if (argvPath === undefined || argvPath.length === 0) return false;
  try {
    return resolveRealPath(fileURLToPath(moduleUrl)) === resolveRealPath(argvPath);
  } catch {
    return false;
  }
}

export function parseCliArguments(argv: readonly string[]): CliCommand {
  if (argv[0] === "exceptions") return parseExportArguments(argv);
  if (argv[0] === "explain") return parseExplainArguments(argv.slice(1));
  if (argv[0] === "init") return parseInitArguments(argv.slice(1));
  if (argv[0] !== "validate") throw new CliUsageError("Expected the validate command");

  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === undefined) break;
    if (!option.startsWith("--")) throw new CliUsageError(`Unexpected positional argument: ${option}`);
    if (!ALLOWED_OPTIONS.has(option)) throw new CliUsageError(`Unknown option ${option}`);
    if (values.has(option)) throw new CliUsageError(`Duplicate option ${option}`);

    const value = argv[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      throw new CliUsageError(`Option ${option} requires a value`);
    }
    values.set(option, value);
    index += 1;
  }

  for (const option of REQUIRED_OPTIONS) {
    if (!values.has(option)) throw new CliUsageError(`Missing required option ${option}`);
  }

  const policy = values.get("--policy");
  const root = values.get("--root");
  const workspace = values.get("--workspace");
  const out = values.get("--out");
  if (policy === undefined || root === undefined || workspace === undefined || out === undefined) {
    throw new CliUsageError("Missing required validate options");
  }
  if (!isUuidV7(workspace)) throw new CliUsageError("Option --workspace requires a lowercase UUIDv7");
  const exceptions = values.get("--exceptions");
  const exceptionsTrustKey = values.get("--exceptions-trust-key");
  if ((exceptions === undefined) !== (exceptionsTrustKey === undefined)) {
    throw new CliUsageError("Options --exceptions and --exceptions-trust-key must be supplied together");
  }
  const custodyPresent = CUSTODY_OPTIONS.filter((option) => values.has(option));
  if (custodyPresent.length !== 0 && custodyPresent.length !== CUSTODY_OPTIONS.length) {
    throw new CliUsageError("Options --policy-approval, --workspace-trust, and --custody-out must be supplied together");
  }
  const base = exceptions === undefined || exceptionsTrustKey === undefined
    ? { command: "validate" as const, out, policy, root, workspace }
    : { command: "validate" as const, exceptions, exceptionsTrustKey, out, policy, root, workspace };
  const policyApproval = values.get("--policy-approval");
  const workspaceTrust = values.get("--workspace-trust");
  const custodyOut = values.get("--custody-out");
  return policyApproval === undefined || workspaceTrust === undefined || custodyOut === undefined
    ? base
    : { ...base, custodyOut, policyApproval, workspaceTrust };
}

function parseExportArguments(argv: readonly string[]): ExportExceptionsCommand {
  if (argv[1] !== "export") throw new CliUsageError("Expected the exceptions export command");
  const allowed = new Set(["--policy-digest", "--out"]);
  const values = new Map<string, string>();
  for (let index = 2; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === undefined) break;
    if (!option.startsWith("--")) throw new CliUsageError(`Unexpected positional argument: ${option}`);
    if (!allowed.has(option)) throw new CliUsageError(`Unknown option ${option}`);
    if (values.has(option)) throw new CliUsageError(`Duplicate option ${option}`);
    const value = argv[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      throw new CliUsageError(`Option ${option} requires a value`);
    }
    values.set(option, value);
    index += 1;
  }
  const policyDigest = values.get("--policy-digest");
  const out = values.get("--out");
  if (policyDigest === undefined) throw new CliUsageError("Missing required option --policy-digest");
  if (out === undefined) throw new CliUsageError("Missing required option --out");
  if (!isSha256Digest(policyDigest)) throw new CliUsageError("Option --policy-digest requires a canonical SHA-256 digest");
  return { command: "exceptions-export", out, policyDigest };
}

function exitCodeForOutcome(outcome: ValidationOutcome["outcome"]): ValidatorExitCode {
  if (outcome === "pass") return 0;
  if (outcome === "violations") return 1;
  return 2;
}

export async function runCli(argv: readonly string[], execute: ValidationExecutor): Promise<ValidatorExitCode> {
  try {
    const command = parseCliArguments(argv);
    if (command.command === "exceptions-export") {
      process.stderr.write("kernel-zero: EXPORT_UNAVAILABLE: authenticated export and signing-key custody are not configured\n");
      return 2;
    }
    if (command.command === "explain") {
      process.stdout.write(await explain(command));
      return 0;
    }
    if (command.command === "init") {
      process.stdout.write(await init(command));
      return 0;
    }
    const paths = await resolveValidatorPaths(command);
    const report = await execute({ command: "validate", ...paths });
    if (report.custody !== undefined && report.custody !== null) process.stdout.write(renderCustody(report.custody));
    if (report.evidence !== undefined) process.stdout.write(renderEvidence(report.evidence, remediationsOf(report.policy ?? { rules: [] })));
    return exitCodeForOutcome(report.outcome);
  } catch (error) {
    if (error instanceof CustodyRejectedError) {
      process.stdout.write(renderCustody(error.custody));
      process.stderr.write(`validator: ${error.message} (${String(error.custody.result.errors)} custody findings)\n`);
      return 1;
    }
    const message = error instanceof Error ? error.message : "Unknown validator failure.";
    process.stderr.write(`validator: ${message}\n`);
    return 2;
  }
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const { runValidation } = await import("./runner");
  process.exitCode = await runCli(process.argv.slice(2), runValidation);
}
