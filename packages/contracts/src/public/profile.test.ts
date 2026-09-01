import { describe, expect, it } from "vitest";

import { EvidenceEnvelopeSchema, PolicyEnvelopeSchema } from "./profile";

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
