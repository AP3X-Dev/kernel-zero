import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, type Dirent } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalEvidenceDigest, deriveEvidenceSummary } from "@kernel-zero/contracts";
import { canonicalSha256, generateUuidV7, isUuidV7 } from "@kernel-zero/domain";

import { checkPython } from "./check";
import { PythonEvidenceSchema } from "./evidence";
import { PythonAnalysisSchema, type PythonAnalysis } from "./facts";
import { PythonPolicySchema } from "./policy";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const SKIPPED_DIRECTORIES = new Set([".git", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".venv", "__pycache__", "build", "dist", "node_modules", "site-packages", "venv"]);

export class PythonRunnerError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PythonRunnerError";
  }
}

export type PythonRunInput = Readonly<{
  analyzerPath?: string;
  out: string;
  policy: string;
  root: string;
  workspace: string;
}>;

export function runPythonValidation(input: PythonRunInput): 0 | 1 | 2 {
  if (!isUuidV7(input.workspace)) throw new PythonRunnerError("Workspace must be a lowercase UUIDv7.");
  const root = realpathSync(resolve(input.root));
  const policyPath = containedExistingFile(root, input.policy, "Policy");
  const outPath = containedOutput(root, input.out);
  if (samePath(policyPath, outPath)) throw new PythonRunnerError("Output path collides with the policy input.");
  const policy = PythonPolicySchema.parse(JSON.parse(readFileSync(policyPath, "utf8")));
  const policyDigest = canonicalSha256(policy);
  const files = collectPythonSources(root, policy.scope.include, policy.scope.exclude);
  if (files.some((file) => samePath(resolve(root, file.path), outPath))) throw new PythonRunnerError("Output path collides with a Python source input.");
  const analysis = analyzePython(files, input.analyzerPath ?? fileURLToPath(new URL("../python-analyzer.py", import.meta.url)));
  const [major, minor, micro] = analysis.python.version;
  const findings = checkPython({ files: analysis.files, policy, policyDigest });
  const manifestDigest = canonicalSha256(Object.fromEntries(files.map((file) => [file.path, canonicalSha256(file.source)])));
  const base = {
    apiVersion: "kernel-zero.dev/evidence/v1" as const,
    exceptionBundleDigest: null,
    findings: [...findings],
    generatedAt: new Date().toISOString(),
    kind: "PythonEvidence" as const,
    policy: { digest: policyDigest, name: policy.metadata.name, revision: policy.metadata.revision },
    result: { ...deriveEvidenceSummary(findings, files.length), durationMs: 0 },
    runId: generateUuidV7(),
    signature: null,
    subject: { manifestDigest, repository: "local", revision: "working-tree" },
    tool: { name: "kernel-zero-python" as const, version: `0.1.0+cpython.${String(major)}.${String(minor)}.${String(micro)}` },
    workspace: input.workspace,
  };
  const evidence = PythonEvidenceSchema.parse({ ...base, integrity: { algorithm: "sha256", digest: canonicalEvidenceDigest(base) } });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  for (const finding of evidence.findings) {
    process.stdout.write(`python: ${finding.level} ${finding.ruleId} ${finding.path}:${String(finding.location.startLine)}:${String(finding.location.startColumn)} ${finding.messageCode} ${finding.subject}\n`);
  }
  process.stdout.write(`python: ${evidence.result.status} (${String(evidence.result.errors)} errors, ${String(evidence.result.warnings)} warnings, ${String(files.length)} files, CPython ${String(major)}.${String(minor)}.${String(micro)})\n`);
  return evidence.result.status === "pass" ? 0 : evidence.result.status === "fail" ? 1 : 2;
}

type PythonSource = Readonly<{ path: string; source: string }>;

function collectPythonSources(root: string, include: readonly string[], exclude: readonly string[]): readonly PythonSource[] {
  const includePatterns = include.map(globToRegExp);
  const excludePatterns = exclude.map(globToRegExp);
  const relativePaths = listPythonFiles(root)
    .map((absolute) => relative(root, absolute).split(sep).join("/"))
    .filter((path) => includePatterns.some((pattern) => pattern.test(path)) && !excludePatterns.some((pattern) => pattern.test(path)))
    .sort();
  let totalBytes = 0;
  return relativePaths.map((path) => {
    const absolute = containedExistingFile(root, path, "Python source");
    const size = lstatSync(absolute).size;
    if (size > MAX_FILE_BYTES) throw new PythonRunnerError(`Python source exceeds ${String(MAX_FILE_BYTES)} bytes: ${path}`);
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new PythonRunnerError(`Python source set exceeds ${String(MAX_TOTAL_BYTES)} bytes.`);
    return Object.freeze({ path, source: readFileSync(absolute, "utf8") });
  });
}

function listPythonFiles(directory: string): readonly string[] {
  const files: string[] = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    let entries: readonly Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      throw new PythonRunnerError(`Cannot read Python source directory: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = join(current, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) pending.push(absolute);
      else if (entry.isFile() && entry.name.endsWith(".py")) files.push(absolute);
    }
  }
  return files;
}

function analyzePython(files: readonly PythonSource[], analyzerPath: string): PythonAnalysis {
  const request = JSON.stringify({ files, protocolVersion: "kernel-zero.python-analysis/v1" });
  const configured = process.env.KERNEL_ZERO_PYTHON;
  const candidates: readonly Readonly<{ args: readonly string[]; command: string }>[] = configured === undefined || configured.trim() === ""
    ? [{ command: "python3", args: [] }, { command: "python", args: [] }, ...(process.platform === "win32" ? [{ command: "py", args: ["-3"] }] : [])]
    : [{ command: configured, args: [] }];
  const failures: string[] = [];
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, analyzerPath], {
      encoding: "utf8",
      input: request,
      maxBuffer: 64 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    });
    if (result.error !== undefined) {
      failures.push(`${candidate.command}: ${result.error.message}`);
      continue;
    }
    if (result.status !== 0) {
      failures.push(`${candidate.command}: ${normalizeError(result.stderr)}`);
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(result.stdout);
    } catch {
      failures.push(`${candidate.command}: analyzer returned malformed JSON`);
      continue;
    }
    const parsed = PythonAnalysisSchema.safeParse(value);
    if (!parsed.success) {
      failures.push(`${candidate.command}: analyzer response failed its strict contract`);
      continue;
    }
    const [major, minor] = parsed.data.python.version;
    if (major !== 3 || minor < 11 || minor >= 15) {
      failures.push(`${candidate.command}: unsupported CPython ${String(major)}.${String(minor)}`);
      continue;
    }
    if (parsed.data.files.length !== files.length || parsed.data.files.some((file, index) => file.path !== files[index]?.path)) {
      failures.push(`${candidate.command}: analyzer response does not match the requested sorted files`);
      continue;
    }
    return parsed.data;
  }
  throw new PythonRunnerError(`No supported CPython 3.11-3.14 analyzer completed: ${failures.join("; ")}`);
}

function containedExistingFile(root: string, candidate: string, label: string): string {
  const lexical = resolve(root, candidate);
  if (!isContained(root, lexical) || !existsSync(lexical)) throw new PythonRunnerError(`${label} path is missing or escapes the repository root.`);
  const actual = realpathSync(lexical);
  if (!isContained(root, actual) || !lstatSync(actual).isFile()) throw new PythonRunnerError(`${label} path is not a contained file.`);
  return actual;
}

function containedOutput(root: string, candidate: string): string {
  const output = resolve(root, candidate);
  if (!isContained(root, output)) throw new PythonRunnerError("Output path escapes the repository root.");
  if (existsSync(output)) {
    if (lstatSync(output).isSymbolicLink() || !isContained(root, realpathSync(output))) {
      throw new PythonRunnerError("Output path is a symlink, junction, or escape.");
    }
  }
  let ancestor = dirname(output);
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new PythonRunnerError("Output path has no contained existing ancestor.");
    ancestor = parent;
  }
  if (!isContained(root, realpathSync(ancestor))) throw new PythonRunnerError("Output path escapes through a symlink or junction.");
  return output;
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isContained(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

function globToRegExp(glob: string): RegExp {
  const expression = glob.replace(/\*\*\/|\*\*|\*|[.+^${}()|[\]\\?]/gu, (token) => {
    if (token === "**/") return "(?:[^\\0]*/)?";
    if (token === "**") return "[^\\0]*";
    if (token === "*") return "[^/]*";
    return `\\${token}`;
  });
  return new RegExp(`^${expression}$`, "u");
}

function normalizeError(value: string): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, 300) || "analyzer failed";
}
