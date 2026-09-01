import { sign, verify, type KeyLike } from "node:crypto";
import { z } from "zod";

import { canonicalSha256, digestBytes, type Sha256Digest } from "@kernel-zero/domain";

import { DigestSchema, InstantSchema, SlugSchema, UuidV7Schema, uniqueArray } from "./shared";

export const EXCEPTION_GRANT_SET_MEDIA_TYPE = "application/vnd.kernel-zero.exceptions+json;version=1" as const;

const GrantSchema = z.strictObject({
  exceptionId: UuidV7Schema,
  ruleId: SlugSchema(3, 80),
  fingerprint: DigestSchema,
  validUntil: InstantSchema,
});

const SignatureSchema = z.strictObject({
  algorithm: z.literal("ed25519"),
  keyId: z.string().trim().min(1).max(120),
  value: z.base64(),
});

export const ExceptionGrantSetSchema = z.strictObject({
  apiVersion: z.literal("kernel-zero.dev/exceptions/v1"),
  kind: z.literal("ExceptionGrantSet"),
  workspace: UuidV7Schema,
  policyDigest: DigestSchema,
  generatedAt: InstantSchema,
  expiresAt: InstantSchema,
  grants: uniqueArray(GrantSchema, 0, 5_000),
  integrity: z.strictObject({ algorithm: z.literal("sha256"), digest: DigestSchema }),
  signature: SignatureSchema,
}).superRefine((bundle, context) => {
  const generatedAt = Date.parse(bundle.generatedAt);
  const expiresAt = Date.parse(bundle.expiresAt);
  if (expiresAt <= generatedAt || expiresAt - generatedAt > 86_400_000) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "Bundle lifetime must be positive and no more than 24 hours." });
  }
  if (bundle.grants.some((grant) => Date.parse(grant.validUntil) < expiresAt)) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "Bundle expiry cannot extend a grant." });
  }
  const ids = bundle.grants.map((grant) => grant.exceptionId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["grants"], message: "Grant IDs must be unique." });
});

export type ExceptionGrantSet = z.infer<typeof ExceptionGrantSetSchema>;

export type ExceptionGrantExportInput = Readonly<{
  expiresAt: Date;
  generatedAt: Date;
  grants: readonly Readonly<{ exceptionId: string; fingerprint: string; ruleId: string; validUntil: Date }>[];
  keyId: string;
  policyDigest: Sha256Digest;
  privateKey: KeyLike;
  workspace: string;
}>;

export function createSignedExceptionGrantSet(input: ExceptionGrantExportInput): ExceptionGrantSet {
  const unsigned = {
    apiVersion: "kernel-zero.dev/exceptions/v1" as const,
    kind: "ExceptionGrantSet" as const,
    workspace: input.workspace,
    policyDigest: input.policyDigest,
    generatedAt: input.generatedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    grants: [...input.grants]
      .sort((left, right) => left.exceptionId.localeCompare(right.exceptionId))
      .map((grant) => ({ ...grant, validUntil: grant.validUntil.toISOString() })),
  };
  const digest = canonicalSha256(unsigned);
  return ExceptionGrantSetSchema.parse({
    ...unsigned,
    integrity: { algorithm: "sha256", digest },
    signature: {
      algorithm: "ed25519",
      keyId: input.keyId,
      value: sign(null, digestBytes(digest), input.privateKey).toString("base64"),
    },
  });
}

export function verifyExceptionGrantSet(
  value: unknown,
  publicKey: KeyLike,
  expected: Readonly<{ now: Date; policyDigest: Sha256Digest; workspace: string }>,
): Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }> {
  const parsed = ExceptionGrantSetSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "invalid_bundle" };
  const bundle = parsed.data;
  if (bundle.workspace !== expected.workspace) return { ok: false, reason: "workspace_mismatch" };
  if (bundle.policyDigest !== expected.policyDigest) return { ok: false, reason: "policy_digest_mismatch" };
  if (Date.parse(bundle.expiresAt) <= expected.now.getTime()) return { ok: false, reason: "expired" };
  const unsigned = {
    apiVersion: bundle.apiVersion,
    expiresAt: bundle.expiresAt,
    generatedAt: bundle.generatedAt,
    grants: bundle.grants,
    kind: bundle.kind,
    policyDigest: bundle.policyDigest,
    workspace: bundle.workspace,
  };
  const recomputed = canonicalSha256(unsigned);
  if (recomputed !== bundle.integrity.digest) return { ok: false, reason: "integrity_mismatch" };
  const valid = verify(null, digestBytes(recomputed), publicKey, Buffer.from(bundle.signature.value, "base64"));
  return valid ? { ok: true } : { ok: false, reason: "invalid_signature" };
}

export function exceptionGrantSetJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ExceptionGrantSetSchema, { io: "input", reused: "ref" });
}
