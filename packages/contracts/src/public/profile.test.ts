import { describe, expect, it } from "vitest";

import { canonicalJson } from "@kernel-zero/domain";

import { canonicalEvidenceDigest, createEvidenceSchema, deriveEvidenceSummary, findingIdentity } from "./evidence";
import { diffRulesById, EvidenceEnvelopeSchema, PolicyEnvelopeSchema } from "./profile";

describe("diffRulesById", () => {
  const rule = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra });

  it("reports added, removed, changed, and unchanged rules, sorted by id regardless of input order", () => {
    const beforeB = rule("b", { level: "error" });
    const afterA = rule("a", { level: "warning" });
    const afterC = rule("c", { level: "error" });
    const afterB = rule("b", { level: "warning" });
    const before = { rules: [beforeB, afterA] };
    const after = { rules: [afterA, afterC, afterB] };

    const diff = diffRulesById(before, after);

    expect(diff).toEqual([
      { after: afterB, before: beforeB, id: "b", status: "changed" },
      { after: afterC, before: null, id: "c", status: "added" },
    ]);
  });

  it("omits unchanged rules and reports removals", () => {
    const ruleZ = rule("z");
    const before = { rules: [rule("a"), ruleZ] };
    const after = { rules: [rule("a")] };

    expect(diffRulesById(before, after)).toEqual([{ after: null, before: ruleZ, id: "z", status: "removed" }]);
  });

  it("compares rules by canonicalJson, ignoring key order", () => {
    const beforeRule = { id: "a", level: "error", scope: "x" };
    const afterRule = { level: "error", id: "a", scope: "x" };
    expect(canonicalJson(beforeRule)).toBe(canonicalJson(afterRule));

    expect(diffRulesById({ rules: [beforeRule] }, { rules: [afterRule] })).toEqual([]);
  });

  it("freezes the result and each entry", () => {
    const diff = diffRulesById({ rules: [rule("a")] }, { rules: [] });

    expect(Object.isFrozen(diff)).toBe(true);
    expect(Object.isFrozen(diff[0])).toBe(true);
  });
});

describe("policy and evidence envelopes", () => {
  it("accepts any kind and ignores profile-owned fields", () => {
    const result = PolicyEnvelopeSchema.safeParse({
      apiVersion: "kernel-zero.dev/v1",
      kind: "AnythingPolicy",
      metadata: { description: "x", name: "any-policy", revision: 1 },
      rules: [{ id: "r" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing kind", () => {
    expect(PolicyEnvelopeSchema.safeParse({ apiVersion: "kernel-zero.dev/v1", metadata: { description: "x", name: "any-policy", revision: 1 } }).success).toBe(false);
  });

  it("reads the policy digest from evidence without knowing the profile", () => {
    const digest = `sha256:${"1".repeat(64)}`;
    const result = EvidenceEnvelopeSchema.safeParse({
      apiVersion: "kernel-zero.dev/evidence/v1",
      kind: "AnythingEvidence",
      policy: { digest, name: "any-policy", revision: 1 },
      workspace: "0195f000-0000-7000-8000-000000000002",
      extra: true,
    });
    expect(result.success && result.data.policy.digest).toBe(digest);
  });
});

describe("createEvidenceSchema message-code closure", () => {
  const built = createEvidenceSchema({ evidenceKind: "TestEvidence", messages: { KNOWN: "Known." }, toolName: "test-tool" });
  const policyDigest = `sha256:${"1".repeat(64)}` as const;
  const location = { endColumn: 20, endLine: 3, startColumn: 4, startLine: 3 };

  function evidenceWith(messageCode: string): unknown {
    const identity = findingIdentity({ location, messageCode, path: "src/thing.ts", policyDigest, ruleId: "a-rule", subject: "thing" });
    const findings = [{
      exceptionId: null,
      fingerprint: identity.fingerprint,
      id: identity.id,
      level: "warning" as const,
      location,
      message: "Known.",
      messageCode,
      path: "src/thing.ts",
      ruleId: "a-rule",
      subject: "thing",
    }];
    const document = {
      apiVersion: "kernel-zero.dev/evidence/v1" as const,
      exceptionBundleDigest: null,
      findings,
      generatedAt: "2026-01-15T12:00:00.000Z",
      kind: "TestEvidence" as const,
      policy: { digest: policyDigest, name: "any-policy", revision: 1 },
      result: { durationMs: 1, ...deriveEvidenceSummary(findings, 1) },
      runId: "0195f000-0000-7000-8000-000000000003",
      signature: null,
      subject: { manifestDigest: `sha256:${"3".repeat(64)}` as const, repository: "kernel-zero", revision: "main" },
      tool: { name: "test-tool" as const, version: "0.1.0" },
      workspace: "0195f000-0000-7000-8000-000000000002",
    };
    return { ...document, integrity: { algorithm: "sha256", digest: canonicalEvidenceDigest(document) } };
  }

  it("accepts a finding whose code the profile declares", () => {
    expect(built.schema.safeParse(evidenceWith("KNOWN")).success).toBe(true);
  });

  it("rejects a finding whose code the profile does not declare", () => {
    const result = built.schema.safeParse(evidenceWith("UNKNOWN_CODE"));
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join(".") === "findings.0.messageCode")).toBe(true);
  });
});
