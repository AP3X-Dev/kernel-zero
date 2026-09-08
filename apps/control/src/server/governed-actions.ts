import "server-only";

import { appError } from "@kernel-zero/domain";
import {
  runSerializableTransaction,
  type AuditActor,
  type AuditMetadata,
  type PersistenceClient,
  type TransactionRepositorySet,
} from "@kernel-zero/persistence";

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

export type GovernedActionDefinition = Readonly<{
  actionId: string;
  audit: Readonly<{
    actionCode: string;
    description: string;
    subjectType: string;
  }>;
  idempotency: "none" | "idempotent" | "required-key";
  tenantScope: "workspace";
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
  });
}

function assertGovernedActionDefinition(actionId: string, definition: DefinitionInput): void {
  const required = ["audit", "idempotency", "tenantScope", "transactionTimeoutMs"] as const;
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
}

export const GOVERNED_ACTIONS = Object.freeze({
  "exception.decide": defineGovernedAction("exception.decide", {
    audit: { actionCode: "exception.decided", description: "Exception request decided.", subjectType: "exception" },
    idempotency: "none", tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  "exception.request": defineGovernedAction("exception.request", {
    audit: { actionCode: "exception.requested", description: "Exception requested.", subjectType: "exception" },
    idempotency: "required-key", tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  "exception.revoke": defineGovernedAction("exception.revoke", {
    audit: { actionCode: "exception.revoked", description: "Exception revoked.", subjectType: "exception" },
    idempotency: "none", tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  "policy.activate": defineGovernedAction("policy.activate", {
    audit: { actionCode: "policy.revision-activated", description: "Policy revision activated.", subjectType: "policy-revision" },
    idempotency: "idempotent", tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  "policy.approve": defineGovernedAction("policy.approve", {
    audit: { actionCode: "policy.revision-approved", description: "Policy revision approved.", subjectType: "policy-revision" },
    idempotency: "none", tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  "policy.retire": defineGovernedAction("policy.retire", {
    audit: { actionCode: "policy.pack-retired", description: "Policy pack retired.", subjectType: "policy-pack" },
    idempotency: "idempotent", tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  "policy.write": defineGovernedAction("policy.write", {
    audit: { actionCode: "policy.draft-saved", description: "Policy draft saved.", subjectType: "policy-revision" },
    idempotency: "none", tenantScope: "workspace", transactionTimeoutMs: 10_000,
  }),
  "signing-key.manage": defineGovernedAction("signing-key.manage", {
    audit: { actionCode: "signing-key.changed", description: "Workspace signing key changed.", subjectType: "signing-key" },
    idempotency: "none", tenantScope: "workspace", transactionTimeoutMs: 10_000,
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

export async function executeGovernedAction<T>(input: Readonly<{
  action: GovernedActionDefinition;
  actor: AuditActor;
  client: PersistenceClient;
  clientAddressHint?: string | null;
  correlationId: string;
  metadata: AuditMetadata;
  operation: (repositories: TransactionRepositorySet) => Promise<T>;
  repositoryFactory?: (transaction: TransactionRepositorySet["transaction"]) => TransactionRepositorySet;
  subjectId: string;
  userAgentHint?: string | null;
  workspaceId: string;
}>): Promise<T> {
  if (input.workspaceId.trim().length === 0) throw new GovernedActionError(appError("WORKSPACE_REQUIRED"));

  return runSerializableTransaction(input.client, async (repositories) => {
    const result = await input.operation(repositories);
    await repositories.audit.append({
      actionCode: input.action.audit.actionCode,
      actor: input.actor,
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
