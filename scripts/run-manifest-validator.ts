#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { canonicalEvidenceDigest, deriveEvidenceSummary } from "@kernel-zero/contracts";
import { canonicalSha256, generateUuidV7, type JsonValue } from "@kernel-zero/domain";
import { ManifestEvidenceSchema, ManifestPolicySchema, checkManifest } from "@kernel-zero/profile-manifest";

function run(policyPath: string, root: string, workspace: string, out: string): number {
  const policy = ManifestPolicySchema.parse(JSON.parse(readFileSync(resolve(policyPath), "utf8")));
  const policyDigest = canonicalSha256(policy);
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as JsonValue;
  const findings = checkManifest({ manifest, path: "package.json", policy, policyDigest });

  const base = {
    apiVersion: "kernel-zero.dev/evidence/v1" as const,
    exceptionBundleDigest: null,
    findings: [...findings],
    generatedAt: new Date().toISOString(),
    kind: "ManifestEvidence" as const,
    policy: { digest: policyDigest, name: policy.metadata.name, revision: policy.metadata.revision },
    result: { ...deriveEvidenceSummary(findings, 1), durationMs: 0 },
    runId: generateUuidV7(),
    signature: null,
    subject: { manifestDigest: canonicalSha256(manifest), repository: "local", revision: "working-tree" },
    tool: { name: "kernel-zero-manifest" as const, version: "0.1.0" },
    workspace,
  };
  const evidence = ManifestEvidenceSchema.parse({ ...base, integrity: { algorithm: "sha256", digest: canonicalEvidenceDigest(base) } });

  const outPath = resolve(out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`manifest: ${evidence.result.status} (${String(evidence.result.errors)} errors, ${String(evidence.result.warnings)} warnings)\n`);
  return evidence.result.status === "pass" ? 0 : evidence.result.status === "fail" ? 1 : 2;
}

const [policyPath, root, workspace, out] = process.argv.slice(2);
if (policyPath === undefined || root === undefined || workspace === undefined || out === undefined) {
  process.stderr.write("usage: run-manifest-validator <policy.json> <root> <workspaceId> <out.json>\n");
  process.exit(2);
}

try {
  process.exit(run(policyPath, root, workspace, out));
} catch (error) {
  const message = error instanceof Error ? error.message : "failed";
  process.stderr.write(`manifest-validator: ${message.replace(/\s+/gu, " ").trim().slice(0, 300)}\n`);
  process.exit(2);
}
