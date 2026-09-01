import { describe, expect, it } from "vitest";

import {
  canonicalEvidenceDigest,
  deriveEvidenceSummary,
  findingIdentity,
} from "@kernel-zero/contracts";
import { canonicalSha256 } from "@kernel-zero/domain";

import { RepositoryEvidenceSchema, findingMessage } from "./evidence";

const digest = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const location = { endColumn: 10, endLine: 4, startColumn: 2, startLine: 4 };

function validEvidence() {
  const policyDigest = digest("1");
  const identity = findingIdentity({
    location,
    messageCode: "DENIED_IMPORT",
    path: "apps/control/src/app/page.tsx",
    policyDigest,
    ruleId: "layers-no-ui-db",
    subject: "@prisma/client",
  });
  const finding = {
    ...identity,
    exceptionId: null,
    level: "error" as const,
    location,
    message: findingMessage("DENIED_IMPORT"),
    messageCode: "DENIED_IMPORT" as const,
    path: "apps/control/src/app/page.tsx",
    ruleId: "layers-no-ui-db",
    subject: "@prisma/client",
  };
  const base = {
    apiVersion: "kernel-zero.dev/evidence/v1" as const,
    exceptionBundleDigest: null,
    findings: [finding],
    generatedAt: "2026-08-31T12:00:00.000Z",
    kind: "RepositoryEvidence" as const,
    policy: { digest: policyDigest, name: "service-boundaries", revision: 1 },
    result: { ...deriveEvidenceSummary([finding], 4), durationMs: 125 },
    runId: "0195f000-0000-7000-8000-000000000001",
    signature: null,
    subject: { manifestDigest: digest("2"), repository: "example/service", revision: "git:abc123" },
    tool: { name: "kernel-zero-validator" as const, version: "1.0.0" },
    workspace: "0195f000-0000-7000-8000-000000000002",
  };
  return { ...base, integrity: { algorithm: "sha256" as const, digest: canonicalEvidenceDigest(base) } };
}

function onlyFinding(evidence: ReturnType<typeof validEvidence>) {
  const finding = evidence.findings[0];
  if (finding === undefined) throw new TypeError("Expected one finding.");
  return finding;
}

describe("repository evidence contract", () => {
  it("strictly validates a self-consistent document", () => {
    expect(RepositoryEvidenceSchema.safeParse(validEvidence()).success).toBe(true);
    expect(RepositoryEvidenceSchema.safeParse({ ...validEvidence(), source: "secret" }).success).toBe(false);
    const withoutSubject = structuredClone(validEvidence()) as Record<string, unknown>;
    delete (withoutSubject.findings as Record<string, unknown>[])[0]?.subject;
    expect(RepositoryEvidenceSchema.safeParse(withoutSubject).success).toBe(false);
  });

  it("recomputes fingerprint, location-sensitive ID, message, counts, and status", () => {
    const original = validEvidence();
    const moved = structuredClone(original);
    const originalFinding = onlyFinding(original);
    const movedFinding = onlyFinding(moved);
    movedFinding.location.startLine += 1;
    movedFinding.location.endLine += 1;
    const movedIdentity = findingIdentity({
      location: movedFinding.location,
      messageCode: movedFinding.messageCode,
      path: movedFinding.path,
      policyDigest: moved.policy.digest,
      ruleId: movedFinding.ruleId,
      subject: movedFinding.subject,
    });
    expect(movedIdentity.fingerprint).toBe(originalFinding.fingerprint);
    expect(movedIdentity.id).not.toBe(originalFinding.id);
    expect(RepositoryEvidenceSchema.safeParse({ ...original, result: { ...original.result, errors: 0 } }).success).toBe(false);
    expect(RepositoryEvidenceSchema.safeParse({ ...original, findings: [{ ...originalFinding, message: "arbitrary" }] }).success).toBe(false);
  });

  it("excludes run metadata and diagnostic duration from integrity", () => {
    const original = validEvidence();
    expect(canonicalEvidenceDigest({ ...original, runId: "0195f000-0000-7000-8000-000000000099" })).toBe(original.integrity.digest);
    expect(canonicalEvidenceDigest({ ...original, generatedAt: "2026-08-31T12:01:00.000Z" })).toBe(original.integrity.digest);
    expect(canonicalEvidenceDigest({ ...original, result: { ...original.result, durationMs: 999 } })).toBe(original.integrity.digest);
    expect(canonicalEvidenceDigest({ ...original, subject: { ...original.subject, revision: "git:def456" } })).not.toBe(original.integrity.digest);
    expect(canonicalSha256({ ruleId: "x" })).toMatch(/^sha256:/u);
  });
});
