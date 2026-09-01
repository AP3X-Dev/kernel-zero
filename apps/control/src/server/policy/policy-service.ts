import "server-only";

import type { RepositoryPolicy } from "@kernel-zero/contracts";
import {
  activatePolicyRevision,
  approvePolicyRevision,
  createPolicyPack,
  diffPolicyRules,
  retirePolicyPack,
  savePolicyDraft,
  type PersistenceClient,
} from "@kernel-zero/persistence";

import { requireCapability, type WorkspaceAuthoritySource } from "../authorization/workspace";

export type PolicyActor = WorkspaceAuthoritySource & Readonly<{ userId: string }>;

type PolicyOperations = Readonly<{
  activate: typeof activatePolicyRevision;
  approve: typeof approvePolicyRevision;
  create: typeof createPolicyPack;
  retire: typeof retirePolicyPack;
  save: typeof savePolicyDraft;
}>;

const defaultOperations: PolicyOperations = Object.freeze({
  activate: activatePolicyRevision,
  approve: approvePolicyRevision,
  create: createPolicyPack,
  retire: retirePolicyPack,
  save: savePolicyDraft,
});

export class PolicyService {
  readonly #operations: PolicyOperations;
  readonly #prisma: PersistenceClient;

  constructor(prisma: PersistenceClient, operations: PolicyOperations = defaultOperations) {
    this.#operations = operations;
    this.#prisma = prisma;
  }

  async approve(input: Readonly<{ actor: PolicyActor; correlationId: string; revisionId: string; workspaceId: string }>) {
    authorize(input.actor, "policy.approve");
    return this.#operations.approve(this.#prisma, { actorUserId: input.actor.userId, correlationId: input.correlationId, revisionId: input.revisionId, workspaceId: input.workspaceId });
  }

  async activate(input: Readonly<{ activePolicyLimit: number | null; actor: PolicyActor; correlationId: string; revisionId: string; workspaceId: string }>): Promise<void> {
    authorize(input.actor, "policy.activate");
    await this.#operations.activate(this.#prisma, { activePolicyLimit: input.activePolicyLimit, actorUserId: input.actor.userId, correlationId: input.correlationId, revisionId: input.revisionId, workspaceId: input.workspaceId });
  }

  async create(input: Readonly<{ actor: PolicyActor; correlationId: string; description: string; displayName: string; document: unknown; slug: string; workspaceId: string }>) {
    authorize(input.actor, "policy.write");
    return this.#operations.create(this.#prisma, { actorUserId: input.actor.userId, correlationId: input.correlationId, description: input.description, displayName: input.displayName, document: input.document, slug: input.slug, workspaceId: input.workspaceId });
  }

  async save(input: Readonly<{ actor: PolicyActor; correlationId: string; document: unknown; packId: string; workspaceId: string }>) {
    authorize(input.actor, "policy.write");
    return this.#operations.save(this.#prisma, { actorUserId: input.actor.userId, correlationId: input.correlationId, document: input.document, packId: input.packId, workspaceId: input.workspaceId });
  }

  async retire(input: Readonly<{ actor: PolicyActor; correlationId: string; packId: string; workspaceId: string }>): Promise<void> {
    authorize(input.actor, "policy.retire");
    await this.#operations.retire(this.#prisma, { actorUserId: input.actor.userId, correlationId: input.correlationId, packId: input.packId, workspaceId: input.workspaceId });
  }

  diff(before: RepositoryPolicy, after: RepositoryPolicy) {
    return diffPolicyRules(before, after);
  }
}

export function policyRevisionActions(actor: PolicyActor, authorId: string): Readonly<{ canApprove: boolean }> {
  return Object.freeze({ canApprove: actor.userId !== authorId && requireCapability(actor, "policy.approve") === null });
}

function authorize(actor: PolicyActor, capability: "policy.activate" | "policy.approve" | "policy.retire" | "policy.write"): void {
  const denied = requireCapability(actor, capability);
  if (denied !== null) throw new Error(denied.code);
}
