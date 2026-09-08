import "server-only";

import type { PolicyRuleDiff } from "@kernel-zero/contracts";
import {
  activatePolicyRevision,
  approvePolicyRevision,
  createPolicyPack,
  retirePolicyPack,
  savePolicyDraft,
  type PersistenceClient,
} from "@kernel-zero/persistence";
import { parsePolicyDocument } from "@kernel-zero/profiles";

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

type Command = Readonly<{ correlationId: string; workspaceId: string }>;

/** Every document crosses the profile registry before persistence sees it; the operator is the only actor. */
export class PolicyService {
  readonly #operations: PolicyOperations;
  readonly #prisma: PersistenceClient;

  constructor(prisma: PersistenceClient, operations: PolicyOperations = defaultOperations) {
    this.#operations = operations;
    this.#prisma = prisma;
  }

  async approve(input: Command & Readonly<{ revisionId: string }>) {
    return this.#operations.approve(this.#prisma, input);
  }

  async activate(input: Command & Readonly<{ revisionId: string }>): Promise<void> {
    await this.#operations.activate(this.#prisma, input);
  }

  async create(input: Command & Readonly<{ description: string; displayName: string; document: unknown; slug: string }>) {
    const parsed = parsePolicyDocument(input.document);
    if (parsed === null) throw new Error("POLICY_INVALID");
    return this.#operations.create(this.#prisma, { ...input, document: parsed.policy });
  }

  async save(input: Command & Readonly<{ document: unknown; packId: string }>) {
    const parsed = parsePolicyDocument(input.document);
    if (parsed === null) throw new Error("POLICY_INVALID");
    return this.#operations.save(this.#prisma, { ...input, document: parsed.policy });
  }

  async retire(input: Command & Readonly<{ packId: string }>): Promise<void> {
    await this.#operations.retire(this.#prisma, input);
  }

  diff(before: unknown, after: unknown): readonly PolicyRuleDiff[] {
    const left = parsePolicyDocument(before);
    const right = parsePolicyDocument(after);
    if (left === null || right === null) throw new Error("POLICY_INVALID");
    if (left.profile !== right.profile) throw new Error("POLICY_PROFILE_MISMATCH");
    return left.profile.diffRules(left.policy, right.policy);
  }
}
