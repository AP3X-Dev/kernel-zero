import "server-only";

import { canonicalJson, generateUuidV7, sha256, type JsonValue, type Sha256Digest } from "@kernel-zero/domain";
import { PolicyEnvelopeSchema, type PolicyEnvelope } from "@kernel-zero/contracts";

import type { PersistenceClient, TransactionClient } from "./client";
import { createAuditRepository } from "./audit";

type PolicyActorInput = Readonly<{ correlationId: string; workspaceId: string }>;

export async function createPolicyPack(client: PersistenceClient, input: PolicyActorInput & Readonly<{
  description: string;
  displayName: string;
  document: PolicyEnvelope;
  slug: string;
}>): Promise<Readonly<{ packId: string; revisionId: string }>> {
  const document = PolicyEnvelopeSchema.parse(input.document);
  if (document.metadata.revision !== 1 || document.metadata.name !== input.slug) throw failure("VALIDATION_FAILED", "policy_metadata");
  return client.$transaction(async (tx) => {
    const packId = generateUuidV7();
    const revisionId = generateUuidV7();
    await tx.policyPack.create({ data: {
      description: input.description.trim(), displayName: input.displayName.trim(), id: packId,
      lifecycleState: "draft", slug: input.slug, workspaceId: input.workspaceId,
    } });
    await tx.policyRevision.create({ data: {
      canonicalJson: canonicalPolicyBytes(document), id: revisionId,
      packId, revision: 1, state: "draft", workspaceId: input.workspaceId,
    } });
    await appendAudit(tx, input, "policy.pack-created", "policy-pack", packId, { revision: 1 });
    return Object.freeze({ packId, revisionId });
  });
}

export async function savePolicyDraft(client: PersistenceClient, input: PolicyActorInput & Readonly<{
  document: PolicyEnvelope;
  packId: string;
}>): Promise<Readonly<{ revision: number; revisionId: string }>> {
  const document = PolicyEnvelopeSchema.parse(input.document);
  return client.$transaction(async (tx) => {
    const current = await tx.policyRevision.findFirst({
      orderBy: { revision: "desc" },
      where: { packId: input.packId, state: "draft", workspaceId: input.workspaceId },
    });
    if (current !== null) {
      if (document.metadata.revision !== current.revision) throw failure("VALIDATION_FAILED", "metadata.revision");
      const changed = await tx.policyRevision.updateMany({
        data: { canonicalJson: canonicalPolicyBytes(document) },
        where: { id: current.id, state: "draft", workspaceId: input.workspaceId },
      });
      if (changed.count !== 1) throw failure("CONFLICT", "draft_changed");
      await appendAudit(tx, input, "policy.draft-saved", "policy-revision", current.id, { revision: current.revision });
      return Object.freeze({ revision: current.revision, revisionId: current.id });
    }
    const latest = await tx.policyRevision.findFirst({ orderBy: { revision: "desc" }, where: { packId: input.packId, workspaceId: input.workspaceId } });
    if (latest === null) throw failure("NOT_FOUND", "policy_pack");
    const revision = latest.revision + 1;
    if (document.metadata.revision !== revision) throw failure("VALIDATION_FAILED", "metadata.revision");
    const revisionId = generateUuidV7();
    await tx.policyRevision.create({ data: {
      canonicalJson: canonicalPolicyBytes(document), id: revisionId,
      packId: input.packId, revision, state: "draft", workspaceId: input.workspaceId,
    } });
    await appendAudit(tx, input, "policy.draft-created", "policy-revision", revisionId, { revision });
    return Object.freeze({ revision, revisionId });
  });
}

export async function approvePolicyRevision(client: PersistenceClient, input: PolicyActorInput & Readonly<{ revisionId: string }>): Promise<Readonly<{ digest: string }>> {
  return client.$transaction(async (tx) => {
    const approved = await freezeDraftRevision(tx, input);
    await appendAudit(tx, input, "policy.revision-approved", "policy-revision", input.revisionId, { digest: approved.digest, revision: approved.revision });
    return Object.freeze({ digest: approved.digest });
  });
}

export type FrozenRevision = Readonly<{ digest: Sha256Digest; kind: string; name: string; revision: number }>;

/** Canonical freeze, digest, and a single-writer state change. Callers own the audit record. */
export async function freezeDraftRevision(tx: TransactionClient, input: PolicyActorInput & Readonly<{ approvedAt?: Date; revisionId: string }>): Promise<FrozenRevision> {
  const revision = await tx.policyRevision.findFirst({ where: { id: input.revisionId, workspaceId: input.workspaceId } });
  if (revision?.state !== "draft") throw failure("NOT_FOUND", "revision");
  const document = PolicyEnvelopeSchema.parse(JSON.parse(revision.canonicalJson) as unknown);
  if (document.metadata.revision !== revision.revision) throw failure("VALIDATION_FAILED", "metadata.revision");
  const frozenBytes = canonicalPolicyBytes(document);
  const digest = sha256(frozenBytes);
  const changed = await tx.policyRevision.updateMany({
    data: { approvedAt: input.approvedAt ?? new Date(), canonicalJson: frozenBytes, digest, state: "approved" },
    where: { id: input.revisionId, state: "draft", workspaceId: input.workspaceId },
  });
  if (changed.count !== 1) throw failure("CONFLICT", "approval_race");
  return Object.freeze({ digest, kind: document.kind, name: document.metadata.name, revision: revision.revision });
}

export async function activatePolicyRevision(client: PersistenceClient, input: PolicyActorInput & Readonly<{ revisionId: string }>): Promise<void> {
  await client.$transaction(async (tx) => {
    const revision = await tx.policyRevision.findFirst({ where: { id: input.revisionId, workspaceId: input.workspaceId } });
    if (revision?.state !== "approved") throw failure("NOT_FOUND", "approved_revision");
    const pack = await tx.policyPack.findFirst({ where: { id: revision.packId, workspaceId: input.workspaceId } });
    if (pack === null) throw failure("NOT_FOUND", "policy_pack");
    if (pack.activeRevisionId !== null) {
      await tx.policyRevision.updateMany({ data: { state: "superseded" }, where: { id: pack.activeRevisionId, state: "active", workspaceId: input.workspaceId } });
    }
    const activated = await tx.policyRevision.updateMany({ data: { state: "active" }, where: { id: revision.id, state: "approved", workspaceId: input.workspaceId } });
    const updated = await tx.policyPack.updateMany({ data: { activeRevisionId: revision.id, lifecycleState: "active" }, where: { id: pack.id, workspaceId: input.workspaceId } });
    if (activated.count !== 1 || updated.count !== 1) throw failure("CONFLICT", "activation_race");
    await appendAudit(tx, input, "policy.revision-activated", "policy-revision", revision.id, { revision: revision.revision });
  });
}

export async function retirePolicyPack(client: PersistenceClient, input: PolicyActorInput & Readonly<{ packId: string }>): Promise<void> {
  await client.$transaction(async (tx) => {
    const pack = await tx.policyPack.findFirst({ where: { id: input.packId, workspaceId: input.workspaceId } });
    if (pack === null) throw failure("NOT_FOUND", "policy_pack");
    if (pack.activeRevisionId !== null) {
      await tx.policyRevision.updateMany({ data: { state: "superseded" }, where: { id: pack.activeRevisionId, state: "active", workspaceId: input.workspaceId } });
    }
    await tx.policyPack.updateMany({ data: { activeRevisionId: null, lifecycleState: "retired" }, where: { id: input.packId, workspaceId: input.workspaceId } });
    await appendAudit(tx, input, "policy.pack-retired", "policy-pack", input.packId, {});
  });
}

async function appendAudit(tx: Parameters<typeof createAuditRepository>[0], input: PolicyActorInput, actionCode: string, subjectType: string, subjectId: string, metadata: Record<string, string | number>): Promise<void> {
  await createAuditRepository(tx).append({ actionCode, actor: { kind: "operator" }, correlationId: input.correlationId, description: actionCode.replaceAll(".", " "), metadata, subjectId, subjectType, workspaceOpaqueId: input.workspaceId });
}

/** Envelope documents come from validated JSON, so their unknown-valued extra keys are JSON by construction. */
function canonicalPolicyBytes(document: PolicyEnvelope): string {
  return canonicalJson(document as unknown as JsonValue);
}

function failure(code: string, reason: string): Error { return new Error(`${code}:${reason}`); }
