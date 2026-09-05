import "server-only";

import { createPublicKey, verify } from "node:crypto";

import {
  PolicyApprovalSchema,
  createWorkspaceTrustBundle,
  policyApprovalDigest,
  type PolicyApproval,
  type WorkspaceTrustBundle,
} from "@kernel-zero/contracts";
import { canonicalJson, digestBytes, generateUuidV7 } from "@kernel-zero/domain";

import { createAuditRepository } from "./audit";
import type { PersistenceClient, TransactionClient } from "./client";
import { freezeDraftRevision } from "./policies";

/**
 * A local signer for one workspace authority key. It never exposes private material to the
 * repository; the repository only asks it to sign a digest and then verifies the result
 * against the stored public coordinate before anything is persisted.
 */
export type PolicyAuthoritySigner = Readonly<{
  keyId: string;
  sign(digest: Uint8Array): Promise<Uint8Array>;
}>;

type CustodyActorInput = Readonly<{ actorUserId: string; correlationId: string; workspaceId: string }>;

export type PolicyAuthorityKeySummary = Readonly<{
  createdAt: Date;
  id: string;
  keyId: string;
  label: string;
  revokedFrom: Date | null;
  validFrom: Date;
  validUntil: Date | null;
}>;

const PUBLIC_X = /^[A-Za-z0-9_-]{43}$/u;

export async function registerPolicyAuthorityKey(client: PersistenceClient, input: CustodyActorInput & Readonly<{
  keyId: string;
  label: string;
  publicKeyX: string;
  validFrom: Date;
  validUntil: Date | null;
}>): Promise<Readonly<{ id: string; keyId: string }>> {
  const keyId = input.keyId.trim();
  const label = input.label.trim();
  if (keyId.length < 1 || keyId.length > 120) throw failure("VALIDATION_FAILED", "keyId");
  if (label.length < 1 || label.length > 120) throw failure("VALIDATION_FAILED", "label");
  if (input.validUntil !== null && input.validUntil.getTime() <= input.validFrom.getTime()) throw failure("VALIDATION_FAILED", "validUntil");
  const publicKeyX = normalizeEd25519PublicX(input.publicKeyX);
  return client.$transaction(async (tx) => {
    const created = await tx.policyAuthorityKey.create({ data: {
      creatorId: input.actorUserId, id: generateUuidV7(), keyId, label, publicKeyX,
      revokedFrom: null, validFrom: input.validFrom, validUntil: input.validUntil, workspaceId: input.workspaceId,
    } });
    await appendAudit(tx, input, "policy-authority-key.registered", created.id, { keyId });
    return Object.freeze({ id: created.id, keyId: created.keyId });
  });
}

/** Revocation is retroactive from `revokedFrom`; approvals signed at or after that instant stop verifying. */
export async function revokePolicyAuthorityKey(client: PersistenceClient, input: CustodyActorInput & Readonly<{
  keyId: string;
  revokedFrom: Date;
}>): Promise<Readonly<{ revoked: boolean }>> {
  return client.$transaction(async (tx) => {
    const changed = await tx.policyAuthorityKey.updateMany({
      data: { revokedFrom: input.revokedFrom },
      where: { keyId: input.keyId, revokedFrom: null, validFrom: { lte: input.revokedFrom }, workspaceId: input.workspaceId },
    });
    if (changed.count === 0) return Object.freeze({ revoked: false });
    await appendAudit(tx, input, "policy-authority-key.revoked", input.keyId, { keyId: input.keyId, revokedFrom: input.revokedFrom.toISOString() });
    return Object.freeze({ revoked: true });
  });
}

export async function listPolicyAuthorityKeys(client: PersistenceClient | TransactionClient, workspaceId: string): Promise<readonly PolicyAuthorityKeySummary[]> {
  const keys = await client.policyAuthorityKey.findMany({
    orderBy: { keyId: "asc" },
    select: { createdAt: true, id: true, keyId: true, label: true, revokedFrom: true, validFrom: true, validUntil: true },
    where: { workspaceId },
  });
  return Object.freeze(keys.map((key) => Object.freeze({ ...key })));
}

/**
 * The workspace trust bundle as the validator consumes it. The revision counts every registered
 * key plus every revocation, which are the only two mutations, so it is monotonic without a counter row.
 * ponytail: a dedicated revision column becomes necessary only if keys ever get edited in place.
 */
export async function readWorkspaceTrustBundle(client: PersistenceClient | TransactionClient, workspaceId: string): Promise<WorkspaceTrustBundle | null> {
  const keys = await client.policyAuthorityKey.findMany({ orderBy: { keyId: "asc" }, where: { workspaceId } });
  if (keys.length === 0) return null;
  const revision = keys.length + keys.filter((key) => key.revokedFrom !== null).length;
  return createWorkspaceTrustBundle({
    keys: keys.map((key) => ({
      crv: "Ed25519" as const, keyId: key.keyId, kty: "OKP" as const, revokedFrom: key.revokedFrom?.toISOString() ?? null,
      validFrom: key.validFrom.toISOString(), validUntil: key.validUntil?.toISOString() ?? null, x: key.publicKeyX,
    })),
    revision,
    workspace: workspaceId,
  });
}

export async function findPolicyApprovalArtifact(client: PersistenceClient | TransactionClient, input: Readonly<{
  revisionId: string;
  workspaceId: string;
}>): Promise<PolicyApproval | null> {
  const row = await client.policyApprovalArtifact.findFirst({ where: { revisionId: input.revisionId, workspaceId: input.workspaceId } });
  if (row === null) return null;
  return PolicyApprovalSchema.parse(JSON.parse(row.canonicalJson) as unknown);
}

/**
 * Persist a signed approval inside the caller's transaction. A retry for the same revision returns the
 * stored artifact unchanged; a different artifact for the same revision is a conflict, never a rewrite.
 */
export async function createPolicyApprovalArtifact(tx: TransactionClient, approval: PolicyApproval, input: Readonly<{
  authorityKeyId: string;
  revisionId: string;
  workspaceId: string;
}>): Promise<Readonly<{ approvalId: string; created: boolean }>> {
  if (approval.workspace !== input.workspaceId) throw failure("VALIDATION_FAILED", "approval_workspace");
  const existing = await tx.policyApprovalArtifact.findFirst({ where: { revisionId: input.revisionId, workspaceId: input.workspaceId } });
  if (existing !== null) {
    if (existing.digest !== approval.integrity.digest) throw failure("CONFLICT", "approval_artifact_exists");
    return Object.freeze({ approvalId: existing.id, created: false });
  }
  const created = await tx.policyApprovalArtifact.create({ data: {
    approvedAt: new Date(approval.approvedAt), authorityKeyId: input.authorityKeyId, canonicalJson: canonicalJson(approval),
    digest: approval.integrity.digest, id: approval.approvalId, policyDigest: approval.policy.digest,
    revisionId: input.revisionId, workspaceId: input.workspaceId,
  } });
  return Object.freeze({ approvalId: created.id, created: true });
}

/**
 * Approve a draft revision and file its signed custody artifact in one transaction. Maker-checker,
 * authority validity at one database-sourced time, signing, signature self-verification, artifact
 * persistence, and audit all commit together or not at all. A retry for an already custody-approved
 * revision returns the stored artifact and never signs again.
 */
export async function approvePolicyRevisionWithCustody(client: PersistenceClient, input: CustodyActorInput & Readonly<{
  keyId: string;
  revisionId: string;
  signer: PolicyAuthoritySigner;
}>): Promise<Readonly<{ approval: PolicyApproval; created: boolean }>> {
  if (input.signer.keyId !== input.keyId) throw failure("FORBIDDEN", "signer_key_mismatch");
  return client.$transaction(async (tx) => {
    const revision = await tx.policyRevision.findFirst({ where: { id: input.revisionId, workspaceId: input.workspaceId } });
    if (revision === null) throw failure("NOT_FOUND", "revision");
    if (revision.state !== "draft") {
      const existing = await findPolicyApprovalArtifact(tx, { revisionId: input.revisionId, workspaceId: input.workspaceId });
      if (existing !== null) return Object.freeze({ approval: existing, created: false });
      throw failure("CONFLICT", "approved_without_custody");
    }
    const key = await tx.policyAuthorityKey.findFirst({ where: { keyId: input.keyId, workspaceId: input.workspaceId } });
    if (key === null) throw failure("NOT_FOUND", "authority_key");
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
    if (clock === undefined) throw failure("CONFLICT", "database_clock");
    const approvedAt = clock.now;
    const authorized = key.validFrom.getTime() <= approvedAt.getTime()
      && (key.validUntil === null || approvedAt.getTime() <= key.validUntil.getTime())
      && (key.revokedFrom === null || approvedAt.getTime() < key.revokedFrom.getTime());
    if (!authorized) throw failure("FORBIDDEN", "authority_not_valid");

    const frozen = await freezeDraftRevision(tx, { ...input, approvedAt });
    const unsigned = {
      apiVersion: "kernel-zero.dev/custody/v1" as const,
      kind: "PolicyApproval" as const,
      workspace: input.workspaceId,
      policy: { digest: frozen.digest, kind: frozen.kind, name: frozen.name, revision: frozen.revision },
      approvalId: generateUuidV7(approvedAt.getTime()),
      authorId: frozen.authorId,
      approverId: input.actorUserId,
      approvedAt: approvedAt.toISOString(),
    };
    const digest = policyApprovalDigest(unsigned);
    const signature = Buffer.from(await input.signer.sign(digestBytes(digest)));
    const approval = PolicyApprovalSchema.parse({
      ...unsigned,
      integrity: { algorithm: "sha256", digest },
      signature: { algorithm: "ed25519", keyId: key.keyId, value: signature.toString("base64") },
    });
    const publicKey = createPublicKey({ format: "jwk", key: { crv: "Ed25519", kty: "OKP", x: key.publicKeyX } });
    if (!verify(null, digestBytes(digest), publicKey, signature)) throw failure("CONFLICT", "signature_invalid");

    const stored = await createPolicyApprovalArtifact(tx, approval, { authorityKeyId: key.id, revisionId: input.revisionId, workspaceId: input.workspaceId });
    await appendAudit(tx, input, "policy.revision-approved-with-custody", input.revisionId, {
      approvalId: stored.approvalId, digest: frozen.digest, keyId: key.keyId, revision: String(frozen.revision),
    }, "policy-revision");
    return Object.freeze({ approval, created: stored.created });
  });
}

function normalizeEd25519PublicX(value: string): string {
  const x = value.trim();
  if (!PUBLIC_X.test(x) || x.includes("PRIVATE")) throw failure("VALIDATION_FAILED", "publicKeyX");
  try {
    const key = createPublicKey({ format: "jwk", key: { crv: "Ed25519", kty: "OKP", x } });
    if (key.asymmetricKeyType !== "ed25519") throw new TypeError("wrong key type");
  } catch {
    throw failure("VALIDATION_FAILED", "publicKeyX");
  }
  return x;
}

async function appendAudit(tx: Parameters<typeof createAuditRepository>[0], input: CustodyActorInput, actionCode: string, subjectId: string, metadata: Record<string, string>, subjectType = "policy-authority-key"): Promise<void> {
  await createAuditRepository(tx).append({ actionCode, actor: { kind: "user", userId: input.actorUserId }, correlationId: input.correlationId, description: actionCode.replaceAll(".", " "), metadata, subjectId, subjectType, workspaceOpaqueId: input.workspaceId });
}

function failure(code: string, reason: string): Error { return new Error(`${code}:${reason}`); }
