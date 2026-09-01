import "server-only";

import { createPublicKey, type KeyLike } from "node:crypto";

import { createSignedExceptionGrantSet, type ExceptionGrantSet } from "@kernel-zero/contracts";
import { generateUuidV7, isSha256Digest, type Sha256Digest } from "@kernel-zero/domain";

import { createAuditRepository } from "./audit";
import type { PersistenceClient } from "./client";

type SigningActorInput = Readonly<{ actorUserId: string; correlationId: string; workspaceId: string }>;

export async function registerSigningKey(client: PersistenceClient, input: SigningActorInput & Readonly<{
  keyId: string; label: string; publicKey: string;
}>): Promise<Readonly<{ keyId: string }>> {
  if (input.keyId.trim().length < 1 || input.keyId.trim().length > 120) throw failure("VALIDATION_FAILED", "keyId");
  if (input.label.trim().length < 1 || input.label.trim().length > 120) throw failure("VALIDATION_FAILED", "label");
  const publicKey = normalizeEd25519PublicKey(input.publicKey);
  return client.$transaction(async (tx) => {
    const created = await tx.signingKey.create({ data: {
      active: true, creatorId: input.actorUserId, id: generateUuidV7(), keyId: input.keyId.trim(),
      label: input.label.trim(), publicKey, workspaceId: input.workspaceId,
    } });
    await appendAudit(tx, input, "signing-key.registered", input.keyId, { keyId: input.keyId });
    return Object.freeze({ keyId: created.keyId });
  });
}

export async function revokeSigningKey(client: PersistenceClient, input: SigningActorInput & Readonly<{ keyId: string }>): Promise<Readonly<{ revoked: boolean }>> {
  return client.$transaction(async (tx) => {
    const changed = await tx.signingKey.updateMany({
      data: { active: false, revokedAt: new Date() },
      where: { active: true, keyId: input.keyId, workspaceId: input.workspaceId },
    });
    if (changed.count === 0) return Object.freeze({ revoked: false });
    await appendAudit(tx, input, "signing-key.revoked", input.keyId, { keyId: input.keyId });
    return Object.freeze({ revoked: true });
  });
}

export async function exportExceptionGrantSet(client: PersistenceClient, input: Readonly<{
  keyId: string;
  policyDigest: string;
  privateKey: KeyLike;
  workspaceId: string;
}>, generatedAt = new Date()): Promise<ExceptionGrantSet> {
  if (!isSha256Digest(input.policyDigest)) throw failure("VALIDATION_FAILED", "policyDigest");
  return client.$transaction(async (tx) => {
    const key = await tx.signingKey.findFirst({ where: { active: true, keyId: input.keyId, workspaceId: input.workspaceId } });
    if (key === null) throw failure("NOT_FOUND", "active_signing_key");
    const storedPublic = normalizeEd25519PublicKey(key.publicKey);
    const suppliedPublic = createPublicKey(input.privateKey).export({ format: "pem", type: "spki" }).toString();
    if (storedPublic !== suppliedPublic) throw failure("FORBIDDEN", "signing_key_mismatch");
    const grants = await tx.exceptionRequest.findMany({
      orderBy: { id: "asc" },
      select: { findingFingerprint: true, id: true, ruleId: true, validUntil: true },
      where: {
        decisionState: "approved", policyDigest: input.policyDigest, revokedAt: null,
        validUntil: { gt: generatedAt }, workspaceId: input.workspaceId,
      },
    });
    const maximumExpiry = generatedAt.getTime() + 86_400_000;
    const earliestGrantExpiry = grants.reduce((earliest, grant) => Math.min(earliest, grant.validUntil.getTime()), maximumExpiry);
    return createSignedExceptionGrantSet({
      expiresAt: new Date(earliestGrantExpiry), generatedAt,
      grants: grants.map((grant) => ({ exceptionId: grant.id, fingerprint: grant.findingFingerprint, ruleId: grant.ruleId, validUntil: grant.validUntil })),
      keyId: input.keyId, policyDigest: input.policyDigest as Sha256Digest, privateKey: input.privateKey, workspace: input.workspaceId,
    });
  });
}

export function normalizeEd25519PublicKey(value: string): string {
  if (value.includes("PRIVATE KEY")) throw failure("VALIDATION_FAILED", "publicKey");
  try {
    const key = createPublicKey(value);
    if (key.asymmetricKeyType !== "ed25519") throw new TypeError("wrong key type");
    return key.export({ format: "pem", type: "spki" }).toString();
  } catch {
    throw failure("VALIDATION_FAILED", "publicKey");
  }
}

async function appendAudit(tx: Parameters<typeof createAuditRepository>[0], input: SigningActorInput, actionCode: string, subjectId: string, metadata: Record<string, string>): Promise<void> {
  await createAuditRepository(tx).append({ actionCode, actor: { kind: "user", userId: input.actorUserId }, correlationId: input.correlationId, description: actionCode.replaceAll(".", " "), metadata, subjectId, subjectType: "signing-key", workspaceOpaqueId: input.workspaceId });
}

function failure(code: string, reason: string): Error { return new Error(`${code}:${reason}`); }
