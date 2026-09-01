import "server-only";

import { generateUuidV7, isSha256Digest } from "@kernel-zero/domain";

import { createAuditRepository } from "./audit";
import type { PersistenceClient } from "./client";

type ExceptionActorInput = Readonly<{ actorUserId: string; correlationId: string; workspaceId: string }>;

export async function requestException(client: PersistenceClient, input: ExceptionActorInput & Readonly<{
  findingFingerprint: string; issueUrl?: string | null; policyDigest: string; rationale: string; ruleId: string; validUntil: Date;
}>, now = new Date()): Promise<Readonly<{ id: string }>> {
  if (!isSha256Digest(input.policyDigest) || !isSha256Digest(input.findingFingerprint)) throw failure("VALIDATION_FAILED", "digest");
  if (input.ruleId.trim().length < 3 || input.ruleId.length > 80) throw failure("VALIDATION_FAILED", "ruleId");
  if (input.rationale.trim().length < 1 || input.rationale.trim().length > 2_000) throw failure("VALIDATION_FAILED", "rationale");
  const duration = input.validUntil.getTime() - now.getTime();
  if (duration <= 0 || duration > 90 * 86_400_000) throw failure("VALIDATION_FAILED", "validUntil");
  if (input.issueUrl !== undefined && input.issueUrl !== null) {
    let url: URL;
    try { url = new URL(input.issueUrl); } catch { throw failure("VALIDATION_FAILED", "issueUrl"); }
    if (url.protocol !== "https:") throw failure("VALIDATION_FAILED", "issueUrl");
  }
  return client.$transaction(async (tx) => {
    const revision = await tx.policyRevision.findFirst({ where: { digest: input.policyDigest, state: { in: ["approved", "active"] }, workspaceId: input.workspaceId } });
    if (revision === null) throw failure("NOT_FOUND", "policy_revision");
    const id = generateUuidV7();
    const created = await tx.exceptionRequest.create({ data: {
      decisionState: "pending", findingFingerprint: input.findingFingerprint, id,
      issueUrl: input.issueUrl ?? null, policyDigest: input.policyDigest, rationale: input.rationale.trim(),
      requesterId: input.actorUserId, ruleId: input.ruleId, validUntil: input.validUntil, workspaceId: input.workspaceId,
    } });
    await appendAudit(tx, input, "exception.requested", id, { policyDigest: input.policyDigest, ruleId: input.ruleId });
    return Object.freeze({ id: created.id });
  });
}

export async function decideException(client: PersistenceClient, input: ExceptionActorInput & Readonly<{
  decision: "approved" | "denied"; decisionNote: string; exceptionId: string;
}>): Promise<void> {
  if (input.decisionNote.trim().length < 1 || input.decisionNote.trim().length > 2_000) throw failure("VALIDATION_FAILED", "decisionNote");
  await client.$transaction(async (tx) => {
    const request = await tx.exceptionRequest.findFirst({ where: { id: input.exceptionId, workspaceId: input.workspaceId } });
    if (request === null) throw failure("NOT_FOUND", "exception");
    if (request.requesterId === input.actorUserId) throw failure("FORBIDDEN", "maker_checker");
    const changed = await tx.exceptionRequest.updateMany({
      data: { decidedAt: new Date(), deciderId: input.actorUserId, decisionNote: input.decisionNote.trim(), decisionState: input.decision },
      where: { decisionState: "pending", id: input.exceptionId, requesterId: { not: input.actorUserId }, workspaceId: input.workspaceId },
    });
    if (changed.count !== 1) throw failure("CONFLICT", "decision_race");
    await appendAudit(tx, input, `exception.${input.decision}`, input.exceptionId, { decision: input.decision });
  });
}

export async function revokeException(client: PersistenceClient, input: ExceptionActorInput & Readonly<{ exceptionId: string; reason: string }>): Promise<void> {
  if (input.reason.trim().length < 1 || input.reason.trim().length > 1_000) throw failure("VALIDATION_FAILED", "reason");
  await client.$transaction(async (tx) => {
    const changed = await tx.exceptionRequest.updateMany({
      data: { revocationReason: input.reason.trim(), revokedAt: new Date(), revokedById: input.actorUserId },
      where: { decisionState: "approved", id: input.exceptionId, revokedAt: null, workspaceId: input.workspaceId },
    });
    if (changed.count !== 1) throw failure("NOT_FOUND", "active_exception");
    await appendAudit(tx, input, "exception.revoked", input.exceptionId, { reason: input.reason.trim() });
  });
}

export function isExceptionApplicable(
  grant: Readonly<{ decisionState: string; findingFingerprint: string; policyDigest: string; revokedAt: Date | null; ruleId: string; validUntil: Date; workspaceId: string }>,
  finding: Readonly<{ findingFingerprint: string; policyDigest: string; ruleId: string; workspaceId: string }>,
  at: Date,
): boolean {
  return grant.decisionState === "approved" && grant.revokedAt === null && grant.validUntil.getTime() > at.getTime()
    && grant.workspaceId === finding.workspaceId && grant.policyDigest === finding.policyDigest
    && grant.ruleId === finding.ruleId && grant.findingFingerprint === finding.findingFingerprint;
}

async function appendAudit(tx: Parameters<typeof createAuditRepository>[0], input: ExceptionActorInput, actionCode: string, subjectId: string, metadata: Record<string, string>): Promise<void> {
  await createAuditRepository(tx).append({ actionCode, actor: { kind: "user", userId: input.actorUserId }, correlationId: input.correlationId, description: actionCode.replaceAll(".", " "), metadata, subjectId, subjectType: "exception", workspaceOpaqueId: input.workspaceId });
}

function failure(code: string, reason: string): Error { return new Error(`${code}:${reason}`); }
