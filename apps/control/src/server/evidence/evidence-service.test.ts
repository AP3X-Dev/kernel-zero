import { generateKeyPairSync, sign } from "node:crypto";

import {
  canonicalEvidenceDigest,
  deriveEvidenceSummary,
  findingIdentity,
  findingMessage,
  type EvidenceFinding,
  type RepositoryEvidence,
  type RepositoryPolicy,
} from "@kernel-zero/contracts";
import { describe, expect, it } from "vitest";

import { EvidenceService } from "./evidence-service";
import type {
  CurrentExceptionGrant,
  EvidenceRepository,
  EvidenceSaveInput,
  EvidenceSaveResult,
  ResolvedEvidencePolicy,
} from "./repository";

const workspaceId = "0195f000-0000-7000-8000-000000000002";
const runId = "0195f000-0000-7000-8000-000000000001";
const exceptionId = "0195f000-0000-7000-8000-000000000003";
const digest = `sha256:${"1".repeat(64)}` as const;
const manifestDigest = `sha256:${"2".repeat(64)}` as const;
const now = new Date("2026-08-31T12:00:00.000Z");

const policy: RepositoryPolicy = {
  apiVersion: "kernel-zero.dev/v1",
  kind: "RepositoryPolicy",
  metadata: { description: "Policy", name: "service-boundaries", revision: 1 },
  rules: [{
    check: { allowTypeOnly: false, files: ["**/*.ts"], kind: "require-import", module: "server-only" },
    id: "server-only",
    level: "error",
    remediation: "Import server-only.",
    title: "Server only",
  }],
  scope: { exclude: [], include: ["**/*.ts"], languages: ["typescript"] },
};

function finding(overrides: Partial<EvidenceFinding> = {}): EvidenceFinding {
  const identity = findingIdentity({
    location: { endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 },
    messageCode: overrides.messageCode ?? "REQUIRED_IMPORT_MISSING",
    path: "src/example.ts",
    policyDigest: digest,
    ruleId: "server-only",
    subject: overrides.subject ?? "file",
  });
  return {
    exceptionId: null,
    level: "error",
    location: { endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 },
    message: findingMessage(overrides.messageCode ?? "REQUIRED_IMPORT_MISSING"),
    messageCode: "REQUIRED_IMPORT_MISSING",
    path: "src/example.ts",
    ruleId: "server-only",
    subject: "file",
    ...identity,
    ...overrides,
  };
}

function evidence(options: Readonly<{ finding?: EvidenceFinding; generatedAt?: string; signature?: RepositoryEvidence["signature"] }> = {}): RepositoryEvidence {
  const findings = [options.finding ?? finding()];
  const base = {
    apiVersion: "kernel-zero.dev/evidence/v1" as const,
    exceptionBundleDigest: findings.some((item) => item.exceptionId !== null) ? `sha256:${"3".repeat(64)}` as const : null,
    findings,
    generatedAt: options.generatedAt ?? now.toISOString(),
    kind: "RepositoryEvidence" as const,
    policy: { digest, name: policy.metadata.name, revision: policy.metadata.revision },
    result: { ...deriveEvidenceSummary(findings, 4), durationMs: 10 },
    runId,
    signature: options.signature ?? null,
    subject: { manifestDigest, repository: "example/service", revision: "git:abc123" },
    tool: { name: "kernel-zero-validator" as const, version: "1.0.0" },
    workspace: workspaceId,
  };
  return { ...base, integrity: { algorithm: "sha256", digest: canonicalEvidenceDigest(base) } };
}

class MemoryRepository implements EvidenceRepository {
  activeKey: string | null = null;
  exceptions: readonly CurrentExceptionGrant[] = [];
  policy: ResolvedEvidencePolicy | null = { digest, document: policy, state: "approved" };
  saves: EvidenceSaveInput[] = [];
  saveResult: EvidenceSaveResult = { kind: "created" };

  findActiveSigningKey(): Promise<string | null> { return Promise.resolve(this.activeKey); }
  findCurrentExceptions(): Promise<readonly CurrentExceptionGrant[]> { return Promise.resolve(this.exceptions); }
  resolveApprovedPolicy(): Promise<ResolvedEvidencePolicy | null> { return Promise.resolve(this.policy); }
  saveEvidence(input: EvidenceSaveInput): Promise<EvidenceSaveResult> { this.saves.push(input); return Promise.resolve(this.saveResult); }
}

const actor = { capabilityDocument: { capabilities: ["evidence.submit"] }, isOwner: false as const, userId: "user-1" };
const submission = (document: unknown) => ({ actor, correlationId: "0195f000-0000-7000-8000-000000000004", document, workspaceId });

describe("EvidenceService", () => {
  it("enforces workspace authentication and evidence.submit before repository access", async () => {
    const repository = new MemoryRepository();
    const service = new EvidenceService(repository);
    await expect(service.submit({ ...submission(evidence()), actor: { ...actor, capabilityDocument: { capabilities: ["evidence.read"] } } }, now)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const otherWorkspace = { ...evidence(), workspace: "0195f000-0000-7000-8000-000000000099" };
    const mismatched = { ...otherWorkspace, integrity: { algorithm: "sha256" as const, digest: canonicalEvidenceDigest(otherWorkspace) } };
    await expect(service.submit({ ...submission(mismatched) }, now)).rejects.toMatchObject({ code: "INVALID_EVIDENCE", reason: "workspace_mismatch" });
    expect(repository.saves).toHaveLength(0);
  });

  it("requires an immutable approved or active policy with exact identity", async () => {
    const repository = new MemoryRepository();
    repository.policy = null;
    await expect(new EvidenceService(repository).submit(submission(evidence()), now)).rejects.toMatchObject({ reason: "approved_policy_not_found" });
    repository.policy = { digest, document: { ...policy, metadata: { ...policy.metadata, revision: 2 } }, state: "approved" };
    await expect(new EvidenceService(repository).submit(submission(evidence()), now)).rejects.toMatchObject({ reason: "policy_identity_mismatch" });
  });

  it("recomputes the contract and validates rule, code, level, and subject compatibility", async () => {
    const repository = new MemoryRepository();
    const service = new EvidenceService(repository);
    const badCount = evidence();
    await expect(service.submit(submission({ ...badCount, result: { ...badCount.result, errors: 0 } }), now)).rejects.toMatchObject({ reason: "contract" });

    const incompatible = finding({ message: findingMessage("DENIED_IMPORT"), messageCode: "DENIED_IMPORT", subject: "blocked-package" });
    const identity = findingIdentity({ location: incompatible.location, messageCode: incompatible.messageCode, path: incompatible.path, policyDigest: digest, ruleId: incompatible.ruleId, subject: incompatible.subject });
    await expect(service.submit(submission(evidence({ finding: { ...incompatible, ...identity } })), now)).rejects.toMatchObject({ reason: "rule_code_mismatch" });

    const wrongLevel = finding({ level: "warning" });
    await expect(service.submit(submission(evidence({ finding: wrongLevel })), now)).rejects.toMatchObject({ reason: "rule_level_mismatch" });
  });

  it("revalidates every applied exception against current durable state at generatedAt", async () => {
    const repository = new MemoryRepository();
    const exceptedFinding = finding({ exceptionId });
    repository.exceptions = [{
      decidedAt: now, decisionState: "approved", findingFingerprint: exceptedFinding.fingerprint, id: exceptionId,
      policyDigest: digest, revokedAt: null, ruleId: exceptedFinding.ruleId,
      validUntil: new Date("2026-09-01T00:00:00.000Z"), workspaceId,
    }];
    await expect(new EvidenceService(repository).submit(submission(evidence({ finding: exceptedFinding })), now)).resolves.toMatchObject({ kind: "created" });

    const current = repository.exceptions[0];
    if (current === undefined) throw new Error("Test fixture requires an exception.");
    const invalidGrants: readonly CurrentExceptionGrant[] = [
      { ...current, decisionState: "denied" },
      { ...current, decidedAt: null },
      { ...current, decidedAt: new Date("2026-08-31T12:00:00.001Z") },
      { ...current, findingFingerprint: `sha256:${"9".repeat(64)}` },
      { ...current, policyDigest: `sha256:${"9".repeat(64)}` },
      { ...current, revokedAt: now },
      { ...current, ruleId: "other-rule" },
      { ...current, validUntil: now },
      { ...current, workspaceId: "0195f000-0000-7000-8000-000000000099" },
    ];
    for (const invalidGrant of invalidGrants) {
      repository.exceptions = [invalidGrant];
      await expect(new EvidenceService(repository).submit(submission(evidence({ finding: exceptedFinding })), now)).rejects.toMatchObject({ reason: "exception_invalid" });
    }
    repository.exceptions = [];
    await expect(new EvidenceService(repository).submit(submission(evidence({ finding: exceptedFinding })), now)).rejects.toMatchObject({ reason: "exception_invalid" });
  });

  it("records hash-only evidence and attests only a valid signature from an active Ed25519 key", async () => {
    const repository = new MemoryRepository();
    const service = new EvidenceService(repository);
    await expect(service.submit(submission(evidence()), now)).resolves.toMatchObject({ attestationState: "recorded" });
    expect(repository.saves[0]?.attestationState).toBe("recorded");

    const keys = generateKeyPairSync("ed25519");
    repository.activeKey = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
    const unsigned = evidence();
    const signature = sign(null, Buffer.from(unsigned.integrity.digest.slice(7), "hex"), keys.privateKey).toString("base64");
    const signed = evidence({ signature: { algorithm: "ed25519", keyId: "ci-key", value: signature } });
    await expect(service.submit(submission(signed), now)).resolves.toMatchObject({ attestationState: "attested" });

    const otherKeys = generateKeyPairSync("ed25519");
    repository.activeKey = otherKeys.publicKey.export({ format: "pem", type: "spki" }).toString();
    await expect(service.submit(submission(signed), now)).rejects.toMatchObject({ reason: "signature_invalid" });

    repository.activeKey = null;
    await expect(service.submit(submission(signed), now)).rejects.toMatchObject({ reason: "signing_key_inactive" });
  });

  it("rejects evidence generated more than fifteen minutes in the future", async () => {
    const repository = new MemoryRepository();
    const service = new EvidenceService(repository);
    await expect(service.submit(submission(evidence({ generatedAt: "2026-08-31T12:15:00.000Z" })), now)).resolves.toMatchObject({ kind: "created" });
    await expect(service.submit(submission(evidence({ generatedAt: "2026-08-31T12:15:00.001Z" })), now)).rejects.toMatchObject({ reason: "generated_at_future" });
  });

  it("maps repository create, duplicate, and digest-conflict outcomes", async () => {
    const repository = new MemoryRepository();
    const service = new EvidenceService(repository);
    await expect(service.submit(submission(evidence()), now)).resolves.toMatchObject({ kind: "created" });
    repository.saveResult = { kind: "duplicate" };
    await expect(service.submit(submission(evidence()), now)).resolves.toMatchObject({ kind: "duplicate" });
    repository.saveResult = { kind: "conflict" };
    await expect(service.submit(submission(evidence()), now)).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });
});
