import { generateKeyPairSync } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createSignedExceptionGrantSet } from "@kernel-zero/contracts";
import { canonicalJson } from "@kernel-zero/domain";

import { runValidation } from "./runner";

const WORKSPACE = "0195f000-0000-7000-8000-000000000002";
const VALIDATOR_TEST_TIMEOUT_MS = 30_000;

async function fixture(source: string, policyPatch: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "kernel-zero-runner-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "entry.ts"), source, "utf8");
  const policy = {
    apiVersion: "kernel-zero.dev/v1",
    kind: "RepositoryPolicy",
    metadata: { description: "Dependency policy", name: "dependency-policy", revision: 1 },
    rules: [{
      check: { deny: ["module:@prisma/client"], from: ["src/**/*.ts"], kind: "forbid-import-edge" },
      id: "no-raw-prisma", level: "error", remediation: "Use the repository boundary.", title: "No raw Prisma",
    }],
    scope: { exclude: [], include: ["src/**/*.ts"], languages: ["typescript"] },
    ...policyPatch,
  };
  const policyPath = path.join(root, "policy.json");
  const out = path.join(root, "evidence.json");
  await writeFile(policyPath, canonicalJson(policy), "utf8");
  return { out, policy: policyPath, root };
}

describe("validator runner", { timeout: VALIDATOR_TEST_TIMEOUT_MS }, () => {
  it("executes the repository self-policy instead of silently succeeding", async () => {
    const root = process.cwd();
    const result = await runValidation({
      command: "validate",
      out: path.join(root, ".kernel-zero", "test-evidence.json"),
      policy: path.join(root, "kernel-zero.policy.json"),
      root,
      workspace: "00000000-0000-7000-8000-000000000000",
    });
    expect(result.outcome).toBe("pass");
    expect(result.evidence.result.filesScanned).toBeGreaterThan(0);
  }, 120_000);

  it("emits canonical deterministic finding identity, manifest, and integrity", async () => {
    const paths = await fixture('import { PrismaClient } from "@prisma/client";\nexport const value = PrismaClient;\n');
    const first = await runValidation({ command: "validate", ...paths, workspace: WORKSPACE }, {
      generatedAt: new Date("2026-08-31T12:00:00.000Z"),
      runId: "0195f000-0000-7000-8000-000000000001",
    });
    const second = await runValidation({ command: "validate", ...paths, workspace: WORKSPACE }, {
      generatedAt: new Date("2026-08-31T12:05:00.000Z"),
      runId: "0195f000-0000-7000-8000-000000000003",
    });

    expect(first.outcome).toBe("violations");
    expect(first.evidence.result.status).toBe("fail");
    expect(first.evidence.findings).toHaveLength(1);
    expect(first.evidence.findings).toEqual(second.evidence.findings);
    expect(first.evidence.integrity.digest).toBe(second.evidence.integrity.digest);
    expect(first.evidence.subject.manifestDigest).toBe(second.evidence.subject.manifestDigest);
    expect(JSON.parse(await readFile(paths.out, "utf8")) as unknown).toEqual(second.evidence);
  });

  it("resolves layer references after the digest and finds what the expanded twin finds", async () => {
    const source = 'import { PrismaClient } from "@prisma/client";\nexport const value = PrismaClient;\n';
    const runtime = { generatedAt: new Date("2026-08-31T12:00:00.000Z"), runId: "0195f000-0000-7000-8000-000000000004" };
    const expanded = await runValidation({ command: "validate", ...(await fixture(source)), workspace: WORKSPACE }, runtime);
    const layered = await runValidation({ command: "validate", ...(await fixture(source, {
      layers: { source: ["src/**/*.ts"] },
      rules: [{
        check: { deny: ["module:@prisma/client"], from: ["layer:source"], kind: "forbid-import-edge" },
        id: "no-raw-prisma", level: "error", remediation: "Use the repository boundary.", title: "No raw Prisma",
      }],
    })), workspace: WORKSPACE }, runtime);

    const observable = (finding: (typeof expanded.evidence.findings)[number]) => ({
      level: finding.level, location: finding.location, messageCode: finding.messageCode, path: finding.path, ruleId: finding.ruleId, subject: finding.subject,
    });
    expect(layered.outcome).toBe("violations");
    expect(layered.evidence.findings).toHaveLength(1);
    expect(layered.evidence.findings.map(observable)).toEqual(expanded.evidence.findings.map(observable));
    // The digest covers the parsed document with its references, so the two documents differ and the returned policy is unexpanded.
    expect(layered.evidence.policy.digest).not.toBe(expanded.evidence.policy.digest);
    expect(layered.policy.rules[0]?.check).toMatchObject({ from: ["layer:source"] });
  });

  it("returns pass for a conforming repository and error for a claimed parse failure", async () => {
    const passing = await fixture("export const value = 1;\n");
    const passed = await runValidation({ command: "validate", ...passing, workspace: WORKSPACE });
    expect(passed.outcome).toBe("pass");

    const broken = await fixture("export const = ;\n");
    const failed = await runValidation({ command: "validate", ...broken, workspace: WORKSPACE });
    expect(failed.outcome).toBe("error");
    expect(failed.evidence.result.status).toBe("error");
    expect(failed.evidence.findings.some((finding) => finding.messageCode === "PARSE_FAILURE")).toBe(true);
  });

  it("applies only a bundle authenticated by the explicitly pinned contained Ed25519 key", async () => {
    const paths = await fixture('import { PrismaClient } from "@prisma/client";\nexport const value = PrismaClient;\n');
    const now = new Date("2026-08-31T12:00:00.000Z");
    const baseline = await runValidation({ command: "validate", ...paths, workspace: WORKSPACE }, {
      generatedAt: now,
      runId: "0195f000-0000-7000-8000-000000000010",
    });
    const finding = baseline.evidence.findings[0];
    if (finding === undefined) throw new Error("Expected one validator finding.");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const keyId = "offline-exception-key";
    const bundle = createSignedExceptionGrantSet({
      expiresAt: new Date("2026-08-31T13:00:00.000Z"),
      generatedAt: now,
      grants: [{
        exceptionId: "0195f000-0000-7000-8000-000000000011",
        fingerprint: finding.fingerprint,
        ruleId: finding.ruleId,
        validUntil: new Date("2026-09-01T12:00:00.000Z"),
      }],
      keyId,
      policyDigest: baseline.evidence.policy.digest,
      privateKey,
      workspace: WORKSPACE,
    });
    const bundlePath = path.join(paths.root, "exceptions.json");
    const trustPath = path.join(paths.root, "trust.jwk");
    const exported = publicKey.export({ format: "jwk" });
    if (exported.crv === undefined || exported.kty === undefined || exported.x === undefined) {
      throw new Error("Expected an Ed25519 public JWK.");
    }
    await writeFile(bundlePath, canonicalJson(bundle), "utf8");
    await writeFile(trustPath, canonicalJson({ crv: exported.crv, kid: keyId, kty: exported.kty, x: exported.x }), "utf8");

    const result = await runValidation({
      command: "validate",
      exceptions: bundlePath,
      exceptionsTrustKey: trustPath,
      ...paths,
      workspace: WORKSPACE,
    }, { generatedAt: now, runId: "0195f000-0000-7000-8000-000000000012" });
    expect(result.outcome).toBe("pass");
    expect(result.evidence.exceptionBundleDigest).toBe(bundle.integrity.digest);
    expect(result.evidence.findings[0]?.exceptionId).toBe("0195f000-0000-7000-8000-000000000011");
  });

  it("fails before scanning or output for malformed or mismatched exception trust", async () => {
    const paths = await fixture("export const value = 1;\n");
    const now = new Date("2026-08-31T12:00:00.000Z");
    const baseline = await runValidation({ command: "validate", ...paths, workspace: WORKSPACE }, { generatedAt: now });
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const keyId = "strict-key";
    const bundle = createSignedExceptionGrantSet({
      expiresAt: new Date("2026-08-31T13:00:00.000Z"),
      generatedAt: now,
      grants: [],
      keyId,
      policyDigest: baseline.evidence.policy.digest,
      privateKey,
      workspace: WORKSPACE,
    });
    const bundlePath = path.join(paths.root, "exceptions.json");
    const trustPath = path.join(paths.root, "trust.jwk");
    const protectedOut = path.join(paths.root, "must-not-exist.json");
    const exported = publicKey.export({ format: "jwk" });
    if (exported.x === undefined) throw new Error("Expected an Ed25519 public JWK.");
    await writeFile(bundlePath, canonicalJson(bundle), "utf8");
    await writeFile(trustPath, canonicalJson({ crv: "Ed25519", extra: true, kid: keyId, kty: "OKP", x: exported.x }), "utf8");

    await expect(runValidation({
      command: "validate",
      exceptions: bundlePath,
      exceptionsTrustKey: trustPath,
      out: protectedOut,
      policy: paths.policy,
      root: paths.root,
      workspace: WORKSPACE,
    }, { generatedAt: now })).rejects.toThrow(/strict public JWK/u);
    await expect(access(protectedOut)).rejects.toBeDefined();
  });
});
