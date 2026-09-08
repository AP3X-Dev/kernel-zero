import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { EvidenceEnvelopeSchema, PolicyEnvelopeSchema } from "@kernel-zero/contracts";
import { isUuidV7 } from "@kernel-zero/domain";
import { RepositoryEvidenceSchema, RepositoryPolicySchema } from "@kernel-zero/profile-software-architecture";

import { renderEvidence, renderPolicy } from "./render";

export type ExplainCommand = Readonly<{ command: "explain"; artifact: string; kind: "policy" | "evidence" }>;
export type InitCommand = Readonly<{ command: "init"; root: string; workspace: string }>;

export const VALIDATOR_VERSION = "0.1.0";
const PLACEHOLDER_WORKSPACE = "00000000-0000-7000-8000-000000000000";

export class CommandError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

function optionValues(argv: readonly string[], allowed: ReadonlySet<string>): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === undefined) break;
    if (!option.startsWith("--")) throw new CommandError(`Unexpected positional argument: ${option}`);
    if (!allowed.has(option)) throw new CommandError(`Unknown option ${option}`);
    if (values.has(option)) throw new CommandError(`Duplicate option ${option}`);
    const value = argv[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) throw new CommandError(`Option ${option} requires a value`);
    values.set(option, value);
    index += 1;
  }
  return values;
}

export function parseExplainArguments(argv: readonly string[]): ExplainCommand {
  const values = optionValues(argv, new Set(["--policy", "--evidence"]));
  if (values.size !== 1) throw new CommandError("explain takes exactly one of --policy or --evidence");
  const [option, artifact] = [...values.entries()][0] ?? [];
  if (option === undefined || artifact === undefined) throw new CommandError("explain takes exactly one of --policy or --evidence");
  return { command: "explain", artifact, kind: option === "--policy" ? "policy" : "evidence" };
}

export function parseInitArguments(argv: readonly string[]): InitCommand {
  const values = optionValues(argv, new Set(["--root", "--workspace"]));
  const workspace = values.get("--workspace") ?? PLACEHOLDER_WORKSPACE;
  if (!isUuidV7(workspace)) throw new CommandError("Option --workspace requires a lowercase UUIDv7");
  return { command: "init", root: values.get("--root") ?? ".", workspace };
}

async function readJson(artifact: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(artifact, "utf8")) as unknown;
  } catch (error) {
    throw new CommandError(`Artifact is not readable JSON: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

/** Renders a strictly parsed artifact. Reads one file, never source, never the network. */
export async function explain(command: ExplainCommand): Promise<string> {
  const value = await readJson(command.artifact);
  switch (command.kind) {
    case "policy": {
      const envelope = PolicyEnvelopeSchema.safeParse(value);
      if (!envelope.success) throw new CommandError("Artifact does not satisfy the policy envelope contract.");
      if (envelope.data.kind !== "RepositoryPolicy") throw new CommandError(`explain supports RepositoryPolicy only; received ${envelope.data.kind}`);
      const policy = RepositoryPolicySchema.safeParse(value);
      if (!policy.success) throw new CommandError("Artifact does not satisfy the RepositoryPolicy contract.");
      return renderPolicy(policy.data);
    }
    case "evidence": {
      const envelope = EvidenceEnvelopeSchema.safeParse(value);
      if (!envelope.success) throw new CommandError("Artifact does not satisfy the evidence contract.");
      if (envelope.data.kind !== "RepositoryEvidence") throw new CommandError(`explain supports RepositoryEvidence only; received ${envelope.data.kind}`);
      // The profile schema closes the message codes, so an unknown code fails here instead of rendering.
      const evidence = RepositoryEvidenceSchema.safeParse(value);
      if (!evidence.success) throw new CommandError("Artifact does not satisfy the RepositoryEvidence contract.");
      return renderEvidence(evidence.data, new Map());
    }
  }
}

const POLICY_TEMPLATE = {
  apiVersion: "kernel-zero.dev/v1",
  kind: "RepositoryPolicy",
  metadata: { name: "repository-policy", revision: 1, description: "Repository architecture rules. Edit the scope and rules, then approve a revision." },
  scope: { languages: ["typescript", "tsx"], include: ["src/**/*.ts", "src/**/*.tsx"], exclude: ["**/*.test.ts", "**/fixtures/**"] },
  rules: [{
    id: "no-raw-database-client",
    title: "Raw database clients stay behind a repository boundary",
    level: "error",
    check: { kind: "forbid-import-edge", from: ["src/**"], deny: ["module:@prisma/client"] },
    remediation: "Import the tenant-scoped repository instead of the raw client.",
  }],
};

const HOOK_TEMPLATE = "#!/usr/bin/env sh\nset -eu\n\nnpm run validator:self\n";

const WORKFLOW_TEMPLATE = `name: Kernel Zero

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run validator:self
      - name: Preserve deterministic evidence
        if: always()
        uses: actions/upload-artifact@v4
        with:
          if-no-files-found: error
          name: kernel-zero-evidence
          path: .kernel-zero/evidence.json
          retention-days: 14
`;

export function scaffoldTargets(root: string): readonly Readonly<{ content: string; mode: number; relative: string }>[] {
  void root;
  return [
    { content: `${JSON.stringify(POLICY_TEMPLATE, null, 2)}\n`, mode: 0o644, relative: "kernel-zero.policy.json" },
    { content: HOOK_TEMPLATE, mode: 0o755, relative: ".githooks/pre-commit" },
    { content: WORKFLOW_TEMPLATE, mode: 0o644, relative: ".github/workflows/kernel-zero.yml" },
  ];
}

export function agentInstructions(workspace: string): string {
  return [
    "Add this to AGENTS.md or CLAUDE.md (a human places it; init never edits those files):",
    "",
    "## KERNEL ZERO enforcement",
    "",
    "Architecture rules live in `kernel-zero.policy.json`. Run `npm run validator:self` before every commit; exit 0 is the only pass,",
    "1 means definite violations, 2 means validation could not complete. Never edit the policy, the validator version, the hook, or the",
    "workflow to make a failing change pass; propose the rule change to the policy owner instead.",
    "",
    "Add this script to package.json and install the exact validator version:",
    "",
    `  "validator:self": "kernel-zero validate --policy kernel-zero.policy.json --root . --workspace ${workspace} --out .kernel-zero/evidence.json"`,
    `  npm install --save-dev @kernel-zero/validator@${VALIDATOR_VERSION}`,
    "",
    "Enable the local hook with `git config core.hooksPath .githooks`. A repository administrator must make the CI `verify` job a",
    "required branch check and protect the policy, workflow, and validator from the contributors being judged; init does not do this.",
    "",
  ].join("\n");
}

/** Local-only scaffold. Refuses every overwrite and never touches package.json, agent instructions, git config, or the network. */
export async function init(command: InitCommand): Promise<string> {
  const root = path.resolve(command.root);
  const targets = scaffoldTargets(root);
  const conflicts: string[] = [];
  for (const target of targets) {
    try {
      await stat(path.join(root, ...target.relative.split("/")));
      conflicts.push(target.relative);
    } catch {
      // absent: safe to create
    }
  }
  if (conflicts.length > 0) {
    throw new CommandError(`init refuses to overwrite existing files: ${conflicts.join(", ")}`);
  }
  for (const target of targets) {
    const absolute = path.join(root, ...target.relative.split("/"));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, target.content, { encoding: "utf8", flag: "wx", mode: target.mode });
  }
  return `${["kernel-zero init wrote:", ...targets.map((target) => `  ${target.relative}`), ""].join("\n")}\n${agentInstructions(command.workspace)}`;
}
