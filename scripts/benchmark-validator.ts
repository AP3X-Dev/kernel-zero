import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { canonicalJson } from "@kernel-zero/domain";
import { runValidation } from "../packages/validator/src/runner";

const FILE_COUNT = 5_000;
const LIMIT_MS = 30_000;
const LIMIT_RSS = 1024 * 1024 * 1024;
const WORKSPACE = "00000000-0000-7000-8000-000000000000";

const root = await mkdtemp(path.join(tmpdir(), "kernel-zero-validator-benchmark-"));
const source = path.join(root, "src");
await mkdir(source);
for (let start = 0; start < FILE_COUNT; start += 250) {
  await Promise.all(Array.from({ length: Math.min(250, FILE_COUNT - start) }, async (_, offset) => {
    const index = start + offset;
    await writeFile(path.join(source, `module-${String(index).padStart(4, "0")}.ts`), `export const value${String(index)} = ${String(index)};\n`, "utf8");
  }));
}
const policy = {
  apiVersion: "kernel-zero.dev/v1",
  kind: "RepositoryPolicy",
  metadata: { description: "Validator performance fixture", name: "validator-benchmark", revision: 1 },
  rules: [{
    check: { deny: ["module:@prisma/client"], from: ["src/**/*.ts"], kind: "forbid-import-edge" },
    id: "no-raw-database-client",
    level: "error",
    remediation: "Use a repository boundary.",
    title: "No raw database client",
  }],
  scope: { exclude: [], include: ["src/**/*.ts"], languages: ["typescript"] },
};
const policyPath = path.join(root, "policy.json");
await writeFile(policyPath, canonicalJson(policy), "utf8");

async function measuredRun(index: number) {
  const started = performance.now();
  const result = await runValidation({
    command: "validate",
    out: path.join(root, `evidence-${String(index)}.json`),
    policy: policyPath,
    root,
    workspace: WORKSPACE,
  });
  return { elapsedMs: Math.round(performance.now() - started), result, rssBytes: process.memoryUsage().rss };
}

const first = await measuredRun(1);
const second = await measuredRun(2);
const deterministic = first.result.evidence.integrity.digest === second.result.evidence.integrity.digest
  && first.result.evidence.subject.manifestDigest === second.result.evidence.subject.manifestDigest;
const report = {
  deterministic,
  files: FILE_COUNT,
  firstMs: first.elapsedMs,
  limitMs: LIMIT_MS,
  limitRssBytes: LIMIT_RSS,
  peakObservedRssBytes: Math.max(first.rssBytes, second.rssBytes),
  secondMs: second.elapsedMs,
};
process.stdout.write(`${canonicalJson(report)}\n`);
if (!deterministic || first.elapsedMs > LIMIT_MS || second.elapsedMs > LIMIT_MS || report.peakObservedRssBytes > LIMIT_RSS) {
  process.exitCode = 1;
}
