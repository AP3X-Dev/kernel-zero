#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { isSha256Digest, isUuidV7 } from "@kernel-zero/domain";

import { resolveValidatorPaths, type ResolvedValidatorPaths } from "./discovery";

export type ValidatorExitCode = 0 | 1 | 2;

export type ValidateCommand = Readonly<{
  command: "validate";
  exceptions?: string;
  exceptionsTrustKey?: string;
  out: string;
  policy: string;
  root: string;
  workspace: string;
}>;

export type ExportExceptionsCommand = Readonly<{
  command: "exceptions-export";
  out: string;
  policyDigest: string;
}>;

export type CliCommand = ValidateCommand | ExportExceptionsCommand;

export type ResolvedValidateCommand = Readonly<ResolvedValidatorPaths & { command: "validate" }>;
export type ValidationOutcome = Readonly<{ outcome: "pass" | "violations" | "error" }>;
export type ValidationExecutor = (command: ResolvedValidateCommand) => Promise<ValidationOutcome>;

const REQUIRED_OPTIONS = ["--policy", "--root", "--workspace", "--out"] as const;
const ALLOWED_OPTIONS = new Set([...REQUIRED_OPTIONS, "--exceptions", "--exceptions-trust-key"]);

export class CliUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function parseCliArguments(argv: readonly string[]): CliCommand {
  if (argv[0] === "exceptions") return parseExportArguments(argv);
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
  return exceptions === undefined || exceptionsTrustKey === undefined
    ? { command: "validate", out, policy, root, workspace }
    : { command: "validate", exceptions, exceptionsTrustKey, out, policy, root, workspace };
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
    const paths = await resolveValidatorPaths(command);
    const outcome = await execute({ command: "validate", ...paths });
    return exitCodeForOutcome(outcome.outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown validator failure.";
    process.stderr.write(`validator: ${message}\n`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { runValidation } = await import("./runner");
  process.exitCode = await runCli(process.argv.slice(2), runValidation);
}
