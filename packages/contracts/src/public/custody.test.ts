import { generateKeyPairSync, type KeyObject } from "node:crypto";

import { canonicalJson, canonicalSha256 } from "@kernel-zero/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CUSTODY_FINDING_CODES,
  PolicyApprovalSchema,
  PolicyCustodyEvidenceSchema,
  WorkspaceTrustBundleSchema,
  createSignedPolicyApproval,
  createWorkspaceTrustBundle,
  policyApprovalDigest,
  verifyPolicyCustody,
  workspaceTrustBundleDigest,
  type PolicyApproval,
  type WorkspaceTrustBundle,
} from "./custody";

const WORKSPACE = "0195f000-0000-7000-8000-000000000002";
const OTHER_WORKSPACE = "0195f000-0000-7000-8000-000000000009";
const AUTHOR = "0195f000-0000-7000-8000-000000000010";
const APPROVER = "0195f000-0000-7000-8000-000000000011";
const APPROVAL_ID = "0195f000-0000-7000-8000-000000000012";
const APPROVED_AT = new Date("2026-09-04T12:00:00.000Z");
const POLICY: PolicyApproval["policy"] = { digest: `sha256:${"1".repeat(64)}`, kind: "RepositoryPolicy", name: "service-boundaries", revision: 3 };

function keyPair(keyId: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  if (jwk.x === undefined) throw new Error("Expected an Ed25519 JWK.");
  return { keyId, privateKey, publicKey, x: jwk.x };
}

function trustFor(
  keys: readonly ReturnType<typeof keyPair>[],
  timeline: Partial<Pick<WorkspaceTrustBundle["keys"][number], "revokedFrom" | "validFrom" | "validUntil">> = {},
  workspace = WORKSPACE,
): WorkspaceTrustBundle {
  return createWorkspaceTrustBundle({
    keys: keys.map((key) => ({
      crv: "Ed25519", keyId: key.keyId, kty: "OKP", x: key.x,
      revokedFrom: null, validFrom: "2026-01-01T00:00:00.000Z", validUntil: null, ...timeline,
    })),
    revision: 1,
    workspace,
  });
}

function approvalWith(privateKey: KeyObject, keyId: string, overrides: Partial<Parameters<typeof createSignedPolicyApproval>[0]> = {}): PolicyApproval {
  return createSignedPolicyApproval({
    approvalId: APPROVAL_ID, approvedAt: APPROVED_AT, approverId: APPROVER, authorId: AUTHOR,
    keyId, policy: POLICY, privateKey, workspace: WORKSPACE, ...overrides,
  });
}

function codes(evidence: ReturnType<typeof verifyPolicyCustody>): readonly string[] {
  return evidence.findings.map((finding) => finding.code);
}

describe("policy custody contracts", () => {
  const authority = keyPair("workspace-authority-1");
  const trust = trustFor([authority]);
  const approval = approvalWith(authority.privateKey, authority.keyId);
  const verifyInput = { approval, policy: POLICY, toolVersion: "0.1.0", trust, workspace: WORKSPACE };

  it("passes a well-formed approval signed by a trusted authority at an authorized time and is deterministic", () => {
    const first = verifyPolicyCustody(verifyInput);
    const second = verifyPolicyCustody(verifyInput);
    expect(first.result).toEqual({ status: "pass", errors: 0 });
    expect(first.findings).toEqual([]);
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.approval.digest).toBe(approval.integrity.digest);
    expect(first.trust).toEqual({ digest: trust.integrity.digest, revision: 1, keyId: authority.keyId });
    expect(PolicyCustodyEvidenceSchema.parse(JSON.parse(canonicalJson(first)))).toEqual(first);
    expect(Object.keys(first)).not.toContain("generatedAt");
  });

  it("reports every custody failure with its frozen code and subject", () => {
    const stranger = keyPair("stranger");
    const forged = { ...approval, approverId: AUTHOR };
    expect(codes(verifyPolicyCustody({ ...verifyInput, approval: forged }))).toEqual([
      "CUSTODY_APPROVAL_INTEGRITY_INVALID", "CUSTODY_APPROVAL_SIGNATURE_INVALID", "CUSTODY_MAKER_CHECKER_INVALID",
    ]);
    expect(codes(verifyPolicyCustody({ ...verifyInput, trust: { ...trust, revision: 2 } }))).toEqual(["CUSTODY_TRUST_INTEGRITY_INVALID"]);
    expect(codes(verifyPolicyCustody({ ...verifyInput, workspace: OTHER_WORKSPACE }))).toEqual(["CUSTODY_WORKSPACE_MISMATCH"]);
    expect(codes(verifyPolicyCustody({ ...verifyInput, policy: { ...POLICY, revision: 4 } }))).toEqual(["CUSTODY_POLICY_IDENTITY_MISMATCH"]);
    expect(codes(verifyPolicyCustody({ ...verifyInput, policy: { ...POLICY, digest: `sha256:${"2".repeat(64)}` } }))).toEqual(["CUSTODY_POLICY_DIGEST_MISMATCH"]);
    expect(codes(verifyPolicyCustody({ ...verifyInput, trust: trustFor([stranger]) }))).toEqual(["CUSTODY_AUTHORITY_UNTRUSTED"]);
    expect(codes(verifyPolicyCustody({ ...verifyInput, approval: approvalWith(stranger.privateKey, authority.keyId) }))).toEqual(["CUSTODY_APPROVAL_SIGNATURE_INVALID"]);
    const evidence = verifyPolicyCustody({ ...verifyInput, workspace: OTHER_WORKSPACE });
    expect(evidence.findings[0]?.subject).toBe(`workspace:${OTHER_WORKSPACE}`);
    expect(evidence.result).toEqual({ status: "fail", errors: 1 });
  });

  it("judges authority only at the signed approval time, including retroactive revocation", () => {
    const late = trustFor([authority], { validFrom: "2026-09-04T12:00:00.001Z" });
    const expired = trustFor([authority], { validUntil: "2026-09-04T11:59:59.999Z" });
    const revokedBefore = trustFor([authority], { revokedFrom: "2026-09-04T12:00:00.000Z" });
    const revokedAfter = trustFor([authority], { revokedFrom: "2026-09-04T12:00:00.001Z" });
    const startsExactly = trustFor([authority], { validFrom: "2026-09-04T12:00:00.000Z" });
    const endsExactly = trustFor([authority], { validUntil: "2026-09-04T12:00:00.000Z" });
    expect(codes(verifyPolicyCustody({ ...verifyInput, trust: late }))).toEqual(["CUSTODY_AUTHORITY_TIME_INVALID"]);
    expect(codes(verifyPolicyCustody({ ...verifyInput, trust: expired }))).toEqual(["CUSTODY_AUTHORITY_TIME_INVALID"]);
    expect(codes(verifyPolicyCustody({ ...verifyInput, trust: revokedBefore }))).toEqual(["CUSTODY_AUTHORITY_TIME_INVALID"]);
    expect(codes(verifyPolicyCustody({ ...verifyInput, trust: revokedAfter }))).toEqual([]);
    expect(codes(verifyPolicyCustody({ ...verifyInput, trust: startsExactly }))).toEqual([]);
    expect(codes(verifyPolicyCustody({ ...verifyInput, trust: endsExactly }))).toEqual([]);
  });

  it("rejects malformed artifacts strictly", () => {
    const stranger = keyPair("stranger");
    expect(PolicyApprovalSchema.safeParse({ ...approval, extra: true }).success).toBe(false);
    expect(PolicyApprovalSchema.safeParse({ ...approval, signature: { ...approval.signature, algorithm: "rsa" } }).success).toBe(false);
    expect(WorkspaceTrustBundleSchema.safeParse({ ...trust, keys: [...trust.keys, ...trust.keys] }).success).toBe(false);
    expect(WorkspaceTrustBundleSchema.safeParse({ ...trust, keys: [{ ...trust.keys[0], x: "short" }] }).success).toBe(false);
    expect(WorkspaceTrustBundleSchema.safeParse({ ...trust, keys: [{ ...trust.keys[0], validUntil: "2025-01-01T00:00:00.000Z" }] }).success).toBe(false);
    const unsorted = { ...trustFor([stranger, authority]), keys: [...trustFor([stranger, authority]).keys].reverse() };
    expect(WorkspaceTrustBundleSchema.safeParse(unsorted).success).toBe(false);
    expect(WorkspaceTrustBundleSchema.safeParse({ ...trust, keys: [] }).success).toBe(false);
    expect(PolicyCustodyEvidenceSchema.safeParse({ ...verifyPolicyCustody(verifyInput), generatedAt: "2026-09-04T12:00:00.000Z" }).success).toBe(false);
    expect(CUSTODY_FINDING_CODES).toHaveLength(9);
  });

  it("keeps canonical digests stable under key order and detects every single-field tamper", () => {
    const payloadKeys = ["apiVersion", "approvalId", "approvedAt", "approverId", "authorId", "kind", "policy", "workspace"] as const;
    fc.assert(fc.property(fc.shuffledSubarray([...payloadKeys], { minLength: payloadKeys.length }), (order) => {
      const shuffled = Object.fromEntries(order.map((key) => [key, approval[key]])) as unknown as PolicyApproval;
      return policyApprovalDigest(shuffled) === approval.integrity.digest;
    }));
    for (const key of ["approvalId", "approvedAt", "approverId", "authorId", "workspace"] as const) {
      const tampered = { ...approval, [key]: key === "approvedAt" ? "2026-09-04T12:00:01.000Z" : OTHER_WORKSPACE };
      expect(codes(verifyPolicyCustody({ ...verifyInput, approval: tampered }))).toContain("CUSTODY_APPROVAL_INTEGRITY_INVALID");
      expect(codes(verifyPolicyCustody({ ...verifyInput, approval: tampered }))).toContain("CUSTODY_APPROVAL_SIGNATURE_INVALID");
    }
    const tamperedTrust = { ...trust, keys: [{ ...trust.keys[0], validFrom: "2020-01-01T00:00:00.000Z" }] } as WorkspaceTrustBundle;
    expect(workspaceTrustBundleDigest(tamperedTrust)).not.toBe(trust.integrity.digest);
    expect(codes(verifyPolicyCustody({ ...verifyInput, trust: tamperedTrust }))).toEqual(["CUSTODY_TRUST_INTEGRITY_INVALID"]);
    expect(canonicalSha256({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
});
