import { mkdirSync, readFileSync, readdirSync, writeFileSync, type Dirent } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { canonicalEvidenceDigest, deriveEvidenceSummary } from "@kernel-zero/contracts";
import { canonicalSha256, generateUuidV7 } from "@kernel-zero/domain";
import { WorkflowEvidenceSchema, WorkflowPolicySchema, checkWorkflows } from "@kernel-zero/profile-workflow";

type WorkflowFile = Readonly<{ path: string; text: string }>;

// ponytail: `*` matches within a path segment and `**` spans segments; no brace or negation syntax,
// which the policy's glob schema does not allow either.
function globToRegExp(glob: string): RegExp {
  const expression = glob.replace(/\*\*\/|\*\*|\*|[.+^${}()|[\]\\?]/gu, (token) => {
    if (token === "**/") return "(?:[^\\0]*/)?";
    if (token === "**") return "[^\\0]*";
    if (token === "*") return "[^/]*";
    return `\\${token}`;
  });
  return new RegExp(`^${expression}$`, "u");
}

/** A glob whose first segment is a wildcard scans from the root, so the walk never descends into build or history directories. */
function listFiles(directory: string): readonly string[] {
  const files: string[] = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    let entries: readonly Dirent[] = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  return files;
}

function collectWorkflows(root: string, include: readonly string[]): readonly WorkflowFile[] {
  const patterns = include.map(globToRegExp);
  const directories = new Set(include.map((glob) => {
    const segments = glob.split("/");
    const wildcard = segments.findIndex((segment) => segment.includes("*"));
    return segments.slice(0, wildcard === -1 ? segments.length - 1 : wildcard).join("/");
  }));

  const paths = new Set<string>();
  for (const directory of directories) {
    for (const absolute of listFiles(resolve(root, directory))) {
      const relative = absolute.slice(resolve(root).length + 1).replaceAll("\\", "/");
      if (patterns.some((pattern) => pattern.test(relative))) paths.add(relative);
    }
  }
  return [...paths].sort().map((path) => ({ path, text: readFileSync(resolve(root, path), "utf8") }));
}

function run(policyPath: string, root: string, workspace: string, out: string): number {
  const policy = WorkflowPolicySchema.parse(JSON.parse(readFileSync(resolve(policyPath), "utf8")));
  const policyDigest = canonicalSha256(policy);
  const files = collectWorkflows(root, policy.scope.include);
  const findings = checkWorkflows({ files, policy, policyDigest });

  const base = {
    apiVersion: "kernel-zero.dev/evidence/v1" as const,
    exceptionBundleDigest: null,
    findings: [...findings],
    generatedAt: new Date().toISOString(),
    kind: "WorkflowEvidence" as const,
    policy: { digest: policyDigest, name: policy.metadata.name, revision: policy.metadata.revision },
    result: { ...deriveEvidenceSummary(findings, files.length), durationMs: 0 },
    runId: generateUuidV7(),
    signature: null,
    subject: {
      manifestDigest: canonicalSha256(Object.fromEntries(files.map((file) => [file.path, file.text]))),
      repository: "local",
      revision: "working-tree",
    },
    tool: { name: "kernel-zero-workflow" as const, version: "0.1.0" },
    workspace,
  };
  const evidence = WorkflowEvidenceSchema.parse({ ...base, integrity: { algorithm: "sha256", digest: canonicalEvidenceDigest(base) } });

  const outPath = resolve(out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  for (const finding of evidence.findings) {
    process.stdout.write(`workflow: ${finding.level} ${finding.messageCode} ${finding.path}:${String(finding.location.startLine)} ${finding.subject}\n`);
  }
  process.stdout.write(`workflow: ${evidence.result.status} (${String(evidence.result.errors)} errors, ${String(evidence.result.warnings)} warnings, ${String(files.length)} files)\n`);
  return evidence.result.status === "pass" ? 0 : evidence.result.status === "fail" ? 1 : 2;
}

const [policyPath, root, workspace, out] = process.argv.slice(2);
if (policyPath === undefined || root === undefined || workspace === undefined || out === undefined) {
  process.stderr.write("usage: run-workflow-validator <policy.json> <root> <workspaceId> <out.json>\n");
  process.exit(2);
}

try {
  process.exit(run(policyPath, root, workspace, out));
} catch (error) {
  const message = error instanceof Error ? error.message : "failed";
  process.stderr.write(`workflow-validator: ${message.replace(/\s+/gu, " ").trim().slice(0, 300)}\n`);
  process.exit(2);
}
