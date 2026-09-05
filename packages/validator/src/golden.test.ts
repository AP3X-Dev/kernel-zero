import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createSignedExceptionGrantSet } from "@kernel-zero/contracts";
import { canonicalJson, type JsonValue } from "@kernel-zero/domain";
import { RepositoryPolicySchema } from "@kernel-zero/profile-software-architecture";

import { discoverTypeScriptSources } from "./discovery";
import { createRepositoryProgram, evaluatePolicyChecks } from "./engine";
import { runValidation } from "./runner";

// Golden baseline for the seven original check kinds. Every engine change must
// leave these files byte-identical. Regenerate only for an approved contract
// change: KERNEL_ZERO_UPDATE_GOLDEN=1 npx vitest run packages/validator/src/golden.test.ts
const fixtureRoot = fileURLToPath(new URL("../fixtures/", import.meta.url));
const goldenDir = path.join(fixtureRoot, "golden");
const policyPath = path.join(goldenDir, "policy.json");
const WORKSPACE = "0195f000-0000-7000-8000-000000000002";
const GENERATED_AT = new Date("2026-09-04T12:00:00.000Z");
const RUN_ID = "0195f000-0000-7000-8000-000000000020";
const EXCEPTION_ID = "0195f000-0000-7000-8000-000000000021";
const UPDATE = process.env.KERNEL_ZERO_UPDATE_GOLDEN === "1";

async function expectGolden(name: string, actual: unknown): Promise<void> {
  const target = path.join(goldenDir, name);
  // The JSON round-trip drops undefined optionals exactly as the CLI's own serialization does.
  const rendered = `${canonicalJson(JSON.parse(JSON.stringify(actual)) as JsonValue)}\n`;
  if (UPDATE) {
    await writeFile(target, rendered, "utf8");
    return;
  }
  expect(rendered).toBe(await readFile(target, "utf8"));
}

async function validate(extra: Readonly<{ exceptions?: string; exceptionsTrustKey?: string }> = {}) {
  const out = path.join(await mkdtemp(path.join(tmpdir(), "kernel-zero-golden-")), "evidence.json");
  return runValidation({ command: "validate", out, policy: policyPath, root: fixtureRoot, workspace: WORKSPACE, ...extra }, {
    generatedAt: GENERATED_AT,
    repositoryLabel: "golden-fixtures",
    revisionLabel: "golden",
    runId: RUN_ID,
  });
}

describe("validator golden baseline", { timeout: 60_000 }, () => {
  it("freezes raw findings, public evidence, and exit outcome for the seven original check kinds", async () => {
    const policy = RepositoryPolicySchema.parse(JSON.parse(await readFile(policyPath, "utf8")));
    const discovery = await discoverTypeScriptSources({ ...policy.scope, root: fixtureRoot });
    const repository = createRepositoryProgram({ rootPath: discovery.root, filePaths: discovery.files.map((file) => file.path) });
    await expectGolden("raw-findings.json", evaluatePolicyChecks(policy, repository));

    const run = await validate();
    const result: Partial<typeof run.evidence.result> = { ...run.evidence.result };
    delete result.durationMs;
    await expectGolden("evidence.json", { ...run.evidence, result });
    expect(run.outcome).toBe("error");
  });

  it("matches an exception grant only by exact rule id and frozen fingerprint", async () => {
    const baseline = await validate();
    const target = baseline.evidence.findings.find((finding) => finding.ruleId === "governed-operation");
    if (target === undefined) throw new Error("Expected a governed-operation finding.");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const keyId = "golden-exception-key";
    const bundle = createSignedExceptionGrantSet({
      expiresAt: new Date("2026-09-04T13:00:00.000Z"),
      generatedAt: GENERATED_AT,
      grants: [
        { exceptionId: EXCEPTION_ID, fingerprint: target.fingerprint, ruleId: target.ruleId, validUntil: new Date("2026-09-05T12:00:00.000Z") },
        { exceptionId: "0195f000-0000-7000-8000-000000000022", fingerprint: target.fingerprint, ruleId: "import-edge", validUntil: new Date("2026-09-05T12:00:00.000Z") },
      ],
      keyId,
      policyDigest: baseline.evidence.policy.digest,
      privateKey,
      workspace: WORKSPACE,
    });
    const scratch = await mkdtemp(path.join(tmpdir(), "kernel-zero-golden-exceptions-"));
    const exceptions = path.join(scratch, "exceptions.json");
    const exceptionsTrustKey = path.join(scratch, "trust.jwk");
    const jwk = publicKey.export({ format: "jwk" });
    if (jwk.x === undefined) throw new Error("Expected an Ed25519 public JWK.");
    await writeFile(exceptions, canonicalJson(bundle), "utf8");
    await writeFile(exceptionsTrustKey, canonicalJson({ crv: "Ed25519", kid: keyId, kty: "OKP", x: jwk.x }), "utf8");

    const excepted = await validate({ exceptions, exceptionsTrustKey });
    const changed = excepted.evidence.findings.filter((finding, index) => finding.exceptionId !== baseline.evidence.findings[index]?.exceptionId);
    expect(changed.map((finding) => [finding.fingerprint, finding.exceptionId])).toEqual([[target.fingerprint, EXCEPTION_ID]]);
    expect(excepted.evidence.result.excepted).toBe(1);
    expect(excepted.evidence.result.errors).toBe(baseline.evidence.result.errors - 1);
  });
});
