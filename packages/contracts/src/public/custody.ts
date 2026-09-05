import { createPublicKey, sign, verify, type KeyLike } from "node:crypto";
import { z } from "zod";

import { canonicalSha256, digestBytes, type Sha256Digest } from "@kernel-zero/domain";

import { DigestSchema, InstantSchema, SlugSchema, UuidV7Schema, uniqueArray } from "./shared";

export const POLICY_APPROVAL_MEDIA_TYPE = "application/vnd.kernel-zero.policy-approval+json;version=1" as const;
export const WORKSPACE_TRUST_BUNDLE_MEDIA_TYPE = "application/vnd.kernel-zero.workspace-trust+json;version=1" as const;
export const POLICY_CUSTODY_EVIDENCE_MEDIA_TYPE = "application/vnd.kernel-zero.custody-evidence+json;version=1" as const;

const CUSTODY_API_VERSION = "kernel-zero.dev/custody/v1" as const;
const KeyIdSchema = z.string().trim().min(1).max(120);
const PolicyIdentitySchema = z.strictObject({
  kind: z.string().min(3).max(64).regex(/^[A-Z][A-Za-z]+Policy$/u),
  name: SlugSchema(3, 64),
  revision: z.number().int().min(1),
  digest: DigestSchema,
});
const IntegritySchema = z.strictObject({ algorithm: z.literal("sha256"), digest: DigestSchema });
const SignatureSchema = z.strictObject({ algorithm: z.literal("ed25519"), keyId: KeyIdSchema, value: z.base64() });

export const PolicyApprovalSchema = z.strictObject({
  apiVersion: z.literal(CUSTODY_API_VERSION),
  kind: z.literal("PolicyApproval"),
  workspace: UuidV7Schema,
  policy: PolicyIdentitySchema,
  approvalId: UuidV7Schema,
  authorId: UuidV7Schema,
  approverId: UuidV7Schema,
  approvedAt: InstantSchema,
  integrity: IntegritySchema,
  signature: SignatureSchema,
});

export type PolicyApproval = z.infer<typeof PolicyApprovalSchema>;

const TrustedKeySchema = z.strictObject({
  keyId: KeyIdSchema,
  kty: z.literal("OKP"),
  crv: z.literal("Ed25519"),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  validFrom: InstantSchema,
  validUntil: InstantSchema.nullable(),
  revokedFrom: InstantSchema.nullable(),
}).superRefine((key, context) => {
  const decoded = Buffer.from(key.x, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== key.x) {
    context.addIssue({ code: "custom", path: ["x"], message: "Ed25519 public keys must be exactly 32 unpadded base64url bytes." });
  }
  if (key.validUntil !== null && Date.parse(key.validUntil) <= Date.parse(key.validFrom)) {
    context.addIssue({ code: "custom", path: ["validUntil"], message: "Key validity must end after it begins." });
  }
});

export const WorkspaceTrustBundleSchema = z.strictObject({
  apiVersion: z.literal(CUSTODY_API_VERSION),
  kind: z.literal("WorkspaceTrustBundle"),
  workspace: UuidV7Schema,
  revision: z.number().int().min(1),
  keys: uniqueArray(TrustedKeySchema, 1, 100),
  integrity: IntegritySchema,
}).superRefine((bundle, context) => {
  const ids = bundle.keys.map((key) => key.keyId);
  const sorted = [...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (new Set(ids).size !== ids.length || ids.some((id, index) => id !== sorted[index])) {
    context.addIssue({ code: "custom", path: ["keys"], message: "Keys must be unique and sorted by key ID." });
  }
});

export type WorkspaceTrustBundle = z.infer<typeof WorkspaceTrustBundleSchema>;

export const CUSTODY_FINDING_CODES = Object.freeze([
  "CUSTODY_TRUST_INTEGRITY_INVALID",
  "CUSTODY_APPROVAL_INTEGRITY_INVALID",
  "CUSTODY_MAKER_CHECKER_INVALID",
  "CUSTODY_WORKSPACE_MISMATCH",
  "CUSTODY_POLICY_IDENTITY_MISMATCH",
  "CUSTODY_POLICY_DIGEST_MISMATCH",
  "CUSTODY_AUTHORITY_UNTRUSTED",
  "CUSTODY_AUTHORITY_TIME_INVALID",
  "CUSTODY_APPROVAL_SIGNATURE_INVALID",
] as const);

export type CustodyFindingCode = (typeof CUSTODY_FINDING_CODES)[number];

export const custodyMessages: Readonly<Record<CustodyFindingCode, string>> = Object.freeze({
  CUSTODY_TRUST_INTEGRITY_INVALID: "The workspace trust bundle integrity digest does not match its canonical content.",
  CUSTODY_APPROVAL_INTEGRITY_INVALID: "The policy approval artifact integrity digest does not match its canonical content.",
  CUSTODY_MAKER_CHECKER_INVALID: "The policy revision author and approver are not distinct.",
  CUSTODY_WORKSPACE_MISMATCH: "The policy approval and trust authority do not match the requested workspace.",
  CUSTODY_POLICY_IDENTITY_MISMATCH: "The approved policy identity or revision does not match the supplied policy.",
  CUSTODY_POLICY_DIGEST_MISMATCH: "The approved policy digest does not match the supplied policy.",
  CUSTODY_AUTHORITY_UNTRUSTED: "The approval signing authority is not present in the supplied workspace trust bundle.",
  CUSTODY_AUTHORITY_TIME_INVALID: "The approval signing authority was not authorized at the signed approval time.",
  CUSTODY_APPROVAL_SIGNATURE_INVALID: "The policy approval signature is not valid for the approved artifact.",
});

const CustodyFindingSchema = z.strictObject({
  code: z.enum(CUSTODY_FINDING_CODES),
  message: z.string().min(1).max(500),
  subject: z.string().min(1).max(500).regex(/^[\x20-\x7e]+$/u),
});

export type CustodyFinding = z.infer<typeof CustodyFindingSchema>;

export const PolicyCustodyEvidenceSchema = z.strictObject({
  apiVersion: z.literal(CUSTODY_API_VERSION),
  kind: z.literal("PolicyCustodyEvidence"),
  workspace: UuidV7Schema,
  policy: PolicyIdentitySchema,
  approval: z.strictObject({ approvalId: UuidV7Schema, digest: DigestSchema, approvedAt: InstantSchema }),
  trust: z.strictObject({ digest: DigestSchema, revision: z.number().int().min(1), keyId: KeyIdSchema }),
  tool: z.strictObject({ name: z.literal("kernel-zero-validator"), version: z.string().min(1).max(80) }),
  result: z.strictObject({ status: z.enum(["pass", "fail"]), errors: z.number().int().min(0).max(CUSTODY_FINDING_CODES.length) }),
  findings: uniqueArray(CustodyFindingSchema, 0, CUSTODY_FINDING_CODES.length),
  integrity: IntegritySchema,
});

export type PolicyCustodyEvidence = z.infer<typeof PolicyCustodyEvidenceSchema>;

function approvalPayload(approval: Omit<PolicyApproval, "integrity" | "signature">) {
  return {
    apiVersion: approval.apiVersion,
    approvalId: approval.approvalId,
    approvedAt: approval.approvedAt,
    approverId: approval.approverId,
    authorId: approval.authorId,
    kind: approval.kind,
    policy: approval.policy,
    workspace: approval.workspace,
  };
}

function trustPayload(bundle: Omit<WorkspaceTrustBundle, "integrity">) {
  return { apiVersion: bundle.apiVersion, keys: bundle.keys, kind: bundle.kind, revision: bundle.revision, workspace: bundle.workspace };
}

export function policyApprovalDigest(approval: Omit<PolicyApproval, "integrity" | "signature">): Sha256Digest {
  return canonicalSha256(approvalPayload(approval));
}

export function workspaceTrustBundleDigest(bundle: Omit<WorkspaceTrustBundle, "integrity">): Sha256Digest {
  return canonicalSha256(trustPayload(bundle));
}

export type PolicyApprovalSigningInput = Readonly<{
  approvalId: string;
  approvedAt: Date;
  approverId: string;
  authorId: string;
  keyId: string;
  policy: PolicyApproval["policy"];
  privateKey: KeyLike;
  workspace: string;
}>;

/** Control-plane side: canonicalize, digest, and sign. The validator never imports a private key. */
export function createSignedPolicyApproval(input: PolicyApprovalSigningInput): PolicyApproval {
  const unsigned = {
    apiVersion: CUSTODY_API_VERSION,
    kind: "PolicyApproval" as const,
    workspace: input.workspace,
    policy: input.policy,
    approvalId: input.approvalId,
    authorId: input.authorId,
    approverId: input.approverId,
    approvedAt: input.approvedAt.toISOString(),
  };
  const digest = policyApprovalDigest(unsigned);
  return PolicyApprovalSchema.parse({
    ...unsigned,
    integrity: { algorithm: "sha256", digest },
    signature: { algorithm: "ed25519", keyId: input.keyId, value: sign(null, digestBytes(digest), input.privateKey).toString("base64") },
  });
}

export function createWorkspaceTrustBundle(input: Readonly<{ keys: WorkspaceTrustBundle["keys"]; revision: number; workspace: string }>): WorkspaceTrustBundle {
  const unsigned = {
    apiVersion: CUSTODY_API_VERSION,
    kind: "WorkspaceTrustBundle" as const,
    workspace: input.workspace,
    revision: input.revision,
    keys: [...input.keys].sort((left, right) => (left.keyId < right.keyId ? -1 : left.keyId > right.keyId ? 1 : 0)),
  };
  return WorkspaceTrustBundleSchema.parse({ ...unsigned, integrity: { algorithm: "sha256", digest: workspaceTrustBundleDigest(unsigned) } });
}

export type CustodyVerificationInput = Readonly<{
  approval: PolicyApproval;
  policy: Readonly<{ digest: Sha256Digest; kind: string; name: string; revision: number }>;
  toolVersion: string;
  trust: WorkspaceTrustBundle;
  workspace: string;
}>;

/**
 * Offline, deterministic custody proof over already-parsed artifacts. Authority is judged only at the
 * signed approval time; nothing here reads a clock, the network, or the environment.
 */
export function verifyPolicyCustody(input: CustodyVerificationInput): PolicyCustodyEvidence {
  const { approval, trust, policy } = input;
  const findings: CustodyFinding[] = [];
  const report = (code: CustodyFindingCode, subject: string): void => {
    findings.push({ code, message: custodyMessages[code], subject });
  };
  const workspaceSubject = `workspace:${input.workspace}`;
  const approvalSubject = `approval:${approval.approvalId}`;
  const policySubject = `policy:${policy.kind}:${policy.name}:${String(policy.revision)}`;
  const authoritySubject = `authority:${approval.signature.keyId}`;

  const trustDigest = workspaceTrustBundleDigest(trust);
  if (trustDigest !== trust.integrity.digest) report("CUSTODY_TRUST_INTEGRITY_INVALID", workspaceSubject);
  const approvalDigest = policyApprovalDigest(approval);
  if (approvalDigest !== approval.integrity.digest) report("CUSTODY_APPROVAL_INTEGRITY_INVALID", approvalSubject);
  if (approval.authorId === approval.approverId) report("CUSTODY_MAKER_CHECKER_INVALID", approvalSubject);
  if (approval.workspace !== input.workspace || trust.workspace !== input.workspace) report("CUSTODY_WORKSPACE_MISMATCH", workspaceSubject);
  if (approval.policy.kind !== policy.kind || approval.policy.name !== policy.name || approval.policy.revision !== policy.revision) {
    report("CUSTODY_POLICY_IDENTITY_MISMATCH", policySubject);
  }
  if (approval.policy.digest !== policy.digest) report("CUSTODY_POLICY_DIGEST_MISMATCH", policySubject);

  const key = trust.keys.find((candidate) => candidate.keyId === approval.signature.keyId);
  if (key === undefined) {
    report("CUSTODY_AUTHORITY_UNTRUSTED", authoritySubject);
  } else {
    const approvedAt = Date.parse(approval.approvedAt);
    const authorized = Date.parse(key.validFrom) <= approvedAt
      && (key.validUntil === null || approvedAt <= Date.parse(key.validUntil))
      && (key.revokedFrom === null || approvedAt < Date.parse(key.revokedFrom));
    if (!authorized) report("CUSTODY_AUTHORITY_TIME_INVALID", authoritySubject);
    let valid = false;
    try {
      const publicKey = createPublicKey({ format: "jwk", key: { crv: key.crv, kty: key.kty, x: key.x } });
      valid = verify(null, digestBytes(approvalDigest), publicKey, Buffer.from(approval.signature.value, "base64"));
    } catch {
      valid = false;
    }
    if (!valid) report("CUSTODY_APPROVAL_SIGNATURE_INVALID", approvalSubject);
  }

  const sorted = [...findings].sort((left, right) => left.code.localeCompare(right.code) || left.subject.localeCompare(right.subject));
  const base = {
    apiVersion: CUSTODY_API_VERSION,
    kind: "PolicyCustodyEvidence" as const,
    workspace: input.workspace,
    policy: { digest: policy.digest, kind: policy.kind, name: policy.name, revision: policy.revision },
    approval: { approvalId: approval.approvalId, digest: approval.integrity.digest, approvedAt: approval.approvedAt },
    trust: { digest: trust.integrity.digest, revision: trust.revision, keyId: approval.signature.keyId },
    tool: { name: "kernel-zero-validator" as const, version: input.toolVersion },
    result: { status: sorted.length === 0 ? "pass" as const : "fail" as const, errors: sorted.length },
    findings: sorted,
  };
  return PolicyCustodyEvidenceSchema.parse({ ...base, integrity: { algorithm: "sha256", digest: canonicalSha256(base) } });
}

export function policyApprovalJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(PolicyApprovalSchema, { io: "input", reused: "ref" });
}

export function workspaceTrustBundleJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(WorkspaceTrustBundleSchema, { io: "input", reused: "ref" });
}

export function policyCustodyEvidenceJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(PolicyCustodyEvidenceSchema, { io: "input", reused: "ref" });
}
