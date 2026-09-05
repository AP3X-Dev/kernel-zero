import "server-only";

import {
  appError,
  type Capability,
  type QuotaKey,
} from "@kernel-zero/domain";
import {
  runSerializableTransaction,
  type AuditActor,
  type AuditMetadata,
  type PersistenceClient,
  type TransactionRepositorySet,
} from "@kernel-zero/persistence";

import { requireCapability, type WorkspaceAuthoritySource } from "./authorization/workspace";

class GovernedActionError extends Error {
  readonly code;
  readonly details;
  readonly retryable;

  constructor(error: ReturnType<typeof appError>) {
    super(error.message);
    this.name = "GovernedActionError";
    this.code = error.code;
    this.details = error.details;
    this.retryable = error.retryable;
  }
}

export type GovernedActionQuota = Readonly<{
  amount: number;
  finalize: "commit" | "hold";
  quotaKey: QuotaKey;
}>;

export type GovernedActionDefinition = Readonly<{
  actionId: string;
  audit: Readonly<{
    actionCode: string;
    description: string;
    subjectType: string;
  }>;
  capability: Capability | null;
  idempotency: "none" | "idempotent" | "required-key";
  quota: GovernedActionQuota | null;
  tenantScope: "bootstrap" | "workspace";
  transactionTimeoutMs: number;
}>;

type DefinitionInput = Omit<GovernedActionDefinition, "actionId">;

export function defineGovernedAction(
  actionId: string,
  definition: DefinitionInput,
): GovernedActionDefinition {
  assertGovernedActionDefinition(actionId, definition);
  return Object.freeze({
    ...definition,
    actionId,
    audit: Object.freeze({ ...definition.audit }),
    quota: definition.quota === null ? null : Object.freeze({ ...definition.quota }),
  });
}

function assertGovernedActionDefinition(actionId: string, definition: DefinitionInput): void {
  const required = [
    "audit",
    "capability",
    "idempotency",
    "quota",
    "tenantScope",
    "transactionTimeoutMs",
  ] as const;
  for (const field of required) {
    if (!(field in (definition as object))) throw new TypeError(`Governed action is missing ${field}.`);
  }
  if (actionId.trim().length === 0) throw new TypeError("Governed action ID is required.");
  if (!Number.isSafeInteger(definition.transactionTimeoutMs) || definition.transactionTimeoutMs < 1 || definition.transactionTimeoutMs > 30_000) {
    throw new TypeError("Governed action transactionTimeoutMs is invalid.");
  }
  if (definition.audit.actionCode.trim().length === 0) throw new TypeError("Governed action audit actionCode is required.");
  if (definition.audit.subjectType.trim().length === 0) throw new TypeError("Governed action audit subjectType is required.");
  if (definition.audit.description.trim().length === 0) throw new TypeError("Governed action audit description is required.");
  if (definition.quota !== null && (!Number.isSafeInteger(definition.quota.amount) || definition.quota.amount < 1)) {
    throw new TypeError("Governed action quota amount is invalid.");
  }
}

export const GOVERNED_ACTIONS = Object.freeze({
  "exception.decide": defineGovernedAction("exception.decide", {
    audit: { actionCode: "exception.decided", description: "Exception request decided.", subjectType: "exception" },
    capability: "exception.decide", idempotency: "none", quota: null, tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  "exception.request": defineGovernedAction("exception.request", {
    audit: { actionCode: "exception.requested", description: "Exception requested.", subjectType: "exception" },
    capability: "exception.request", idempotency: "required-key", quota: null, tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  "exception.revoke": defineGovernedAction("exception.revoke", {
    audit: { actionCode: "exception.revoked", description: "Exception revoked.", subjectType: "exception" },
    capability: "exception.revoke", idempotency: "none", quota: null, tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  "invitation.accept": defineGovernedAction("invitation.accept", {
    audit: { actionCode: "invitation.accepted", description: "Workspace invitation accepted.", subjectType: "invitation" },
    capability: null,
    idempotency: "idempotent",
    quota: null,
    tenantScope: "workspace",
    transactionTimeoutMs: 10_000,
  }),
  "invitation.cancel": defineGovernedAction("invitation.cancel", {
    audit: { actionCode: "invitation.cancelled", description: "Workspace invitation cancelled.", subjectType: "invitation" },
    capability: "member.invite",
    idempotency: "idempotent",
    quota: null,
    tenantScope: "workspace",
    transactionTimeoutMs: 10_000,
  }),
  "invitation.issue": defineGovernedAction("invitation.issue", {
    audit: { actionCode: "invitation.issued", description: "Workspace invitation issued.", subjectType: "invitation" },
    capability: "member.invite",
    idempotency: "required-key",
    quota: { amount: 1, finalize: "hold", quotaKey: "occupied_seats" },
    tenantScope: "workspace",
    transactionTimeoutMs: 10_000,
  }),
  "invitation.resend": defineGovernedAction("invitation.resend", {
    audit: { actionCode: "invitation.resent", description: "Workspace invitation resent.", subjectType: "invitation" },
    capability: "member.invite",
    idempotency: "none",
    quota: null,
    tenantScope: "workspace",
    transactionTimeoutMs: 10_000,
  }),
  "policy.activate": defineGovernedAction("policy.activate", {
    audit: { actionCode: "policy.revision-activated", description: "Policy revision activated.", subjectType: "policy-revision" },
    capability: "policy.activate", idempotency: "idempotent", quota: { amount: 1, finalize: "commit", quotaKey: "active_policy_packs" }, tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  "policy.approve": defineGovernedAction("policy.approve", {
    audit: { actionCode: "policy.revision-approved", description: "Policy revision approved.", subjectType: "policy-revision" },
    capability: "policy.approve", idempotency: "none", quota: null, tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  // quota is null because approval consumes no plan-limited resource (ADR 2026-09-04, control-plane custody).
  "policy.approve-with-custody": defineGovernedAction("policy.approve-with-custody", {
    audit: { actionCode: "policy.revision-approved-with-custody", description: "Policy revision approved with workspace custody.", subjectType: "policy-revision" },
    capability: "policy.approve", idempotency: "idempotent", quota: null, tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  "policy-authority-key.manage": defineGovernedAction("policy-authority-key.manage", {
    audit: { actionCode: "policy-authority-key.changed", description: "Workspace policy authority key changed.", subjectType: "policy-authority-key" },
    capability: "policy.authority-key.manage", idempotency: "none", quota: null, tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  "policy.retire": defineGovernedAction("policy.retire", {
    audit: { actionCode: "policy.pack-retired", description: "Policy pack retired.", subjectType: "policy-pack" },
    capability: "policy.retire", idempotency: "idempotent", quota: null, tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  "policy.write": defineGovernedAction("policy.write", {
    audit: { actionCode: "policy.draft-saved", description: "Policy draft saved.", subjectType: "policy-revision" },
    capability: "policy.write", idempotency: "none", quota: null, tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  "signing-key.manage": defineGovernedAction("signing-key.manage", {
    audit: { actionCode: "signing-key.changed", description: "Workspace signing key changed.", subjectType: "signing-key" },
    capability: "evidence.signing-key.manage", idempotency: "none", quota: null, tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  "workspace.create": defineGovernedAction("workspace.create", {
    audit: { actionCode: "workspace.created", description: "Workspace created.", subjectType: "workspace" },
    capability: null,
    idempotency: "required-key",
    quota: null,
    tenantScope: "bootstrap",
    transactionTimeoutMs: 10_000,
  }),
  "workspace.delete": defineGovernedAction("workspace.delete", {
    audit: { actionCode: "workspace.deleted", description: "Workspace deleted.", subjectType: "workspace" },
    capability: "workspace.delete",
    idempotency: "required-key",
    quota: null,
    tenantScope: "workspace",
    transactionTimeoutMs: 10_000,
  }),
  "workspace.owner-transfer": defineGovernedAction("workspace.owner-transfer", {
    audit: { actionCode: "workspace.owner-transferred", description: "Workspace ownership transferred.", subjectType: "workspace" },
    capability: "workspace.transfer",
    idempotency: "required-key",
    quota: null,
    tenantScope: "workspace",
    transactionTimeoutMs: 10_000,
  }),
});

export function validateGovernedActionRegistry(
  registry: Readonly<Record<string, GovernedActionDefinition>>,
): Readonly<{ ok: true }> {
  const actionIds = new Set<string>();
  for (const [key, definition] of Object.entries(registry)) {
    if (key !== definition.actionId) throw new TypeError(`Governed action key mismatch: ${key}.`);
    if (actionIds.has(definition.actionId)) throw new TypeError(`Duplicate governed action: ${key}.`);
    assertGovernedActionDefinition(definition.actionId, definition);
    actionIds.add(definition.actionId);
  }
  return Object.freeze({ ok: true as const });
}

export type GovernedActor = Readonly<{
  actor: AuditActor;
  authority: WorkspaceAuthoritySource | null;
}>;

export async function executeGovernedAction<T>(input: Readonly<{
  action: GovernedActionDefinition;
  actor: GovernedActor;
  client: PersistenceClient;
  clientAddressHint?: string | null;
  correlationId: string;
  metadata: AuditMetadata;
  operation: (repositories: TransactionRepositorySet) => Promise<T>;
  quota?: Readonly<{ limit: number | null; periodKey: string }>;
  repositoryFactory?: (transaction: TransactionRepositorySet["transaction"]) => TransactionRepositorySet;
  subjectId: string;
  userAgentHint?: string | null;
  workspaceId: string;
}>): Promise<T> {
  if (input.action.capability !== null) {
    if (input.actor.authority === null) throw new GovernedActionError(appError("FORBIDDEN"));
    const denied = requireCapability(input.actor.authority, input.action.capability);
    if (denied !== null) throw new GovernedActionError(denied);
  }
  if (input.action.tenantScope === "workspace" && input.workspaceId.trim().length === 0) {
    throw new GovernedActionError(appError("WORKSPACE_REQUIRED"));
  }
  if (input.action.quota !== null && input.quota === undefined) {
    throw new GovernedActionError(appError("INTERNAL_ERROR", { details: { reason: "quota_context_missing" } }));
  }

  return runSerializableTransaction(input.client, async (repositories) => {
    const quotaDefinition = input.action.quota;
    const reservation = quotaDefinition === null ? null : await repositories.quota.reserve({
      amount: quotaDefinition.amount,
      limit: input.quota?.limit ?? null,
      periodKey: input.quota?.periodKey ?? "lifetime",
      quotaKey: quotaDefinition.quotaKey,
      workspaceId: input.workspaceId,
    });
    const result = await input.operation(repositories);
    if (reservation !== null && quotaDefinition?.finalize === "commit") {
      await repositories.quota.commit(input.workspaceId, reservation);
    }
    await repositories.audit.append({
      actionCode: input.action.audit.actionCode,
      actor: input.actor.actor,
      ...(input.clientAddressHint === undefined ? {} : { clientAddressHint: input.clientAddressHint }),
      correlationId: input.correlationId,
      description: input.action.audit.description,
      metadata: input.metadata,
      subjectId: input.subjectId,
      subjectType: input.action.audit.subjectType,
      ...(input.userAgentHint === undefined ? {} : { userAgentHint: input.userAgentHint }),
      workspaceOpaqueId: input.workspaceId,
    });
    return result;
  }, {
    ...(input.repositoryFactory === undefined ? {} : { repositoryFactory: input.repositoryFactory }),
    timeoutMs: input.action.transactionTimeoutMs,
  });
}

validateGovernedActionRegistry(GOVERNED_ACTIONS);
