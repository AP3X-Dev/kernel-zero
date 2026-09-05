import "server-only";

import {
  registerPolicyAuthorityKey,
  revokePolicyAuthorityKey,
  type PersistenceClient,
} from "@kernel-zero/persistence";

import { requireCapability, type WorkspaceAuthoritySource } from "../authorization/workspace";

export type CustodyActor = WorkspaceAuthoritySource & Readonly<{ userId: string }>;

type CustodyOperations = Readonly<{
  registerKey: typeof registerPolicyAuthorityKey;
  revokeKey: typeof revokePolicyAuthorityKey;
}>;

const defaultOperations: CustodyOperations = Object.freeze({
  registerKey: registerPolicyAuthorityKey,
  revokeKey: revokePolicyAuthorityKey,
});

/** Owner-only management of the workspace policy-authority keys; signing itself never passes through here. */
export class PolicyCustodyService {
  readonly #operations: CustodyOperations;
  readonly #prisma: PersistenceClient;

  constructor(prisma: PersistenceClient, operations: CustodyOperations = defaultOperations) {
    this.#operations = operations;
    this.#prisma = prisma;
  }

  async registerKey(input: Readonly<{ actor: CustodyActor; correlationId: string; keyId: string; label: string; publicKeyX: string; validFrom: Date; validUntil: Date | null; workspaceId: string }>) {
    authorize(input.actor);
    return this.#operations.registerKey(this.#prisma, {
      actorUserId: input.actor.userId, correlationId: input.correlationId, keyId: input.keyId, label: input.label,
      publicKeyX: input.publicKeyX, validFrom: input.validFrom, validUntil: input.validUntil, workspaceId: input.workspaceId,
    });
  }

  async revokeKey(input: Readonly<{ actor: CustodyActor; correlationId: string; keyId: string; revokedFrom: Date; workspaceId: string }>) {
    authorize(input.actor);
    return this.#operations.revokeKey(this.#prisma, {
      actorUserId: input.actor.userId, correlationId: input.correlationId, keyId: input.keyId, revokedFrom: input.revokedFrom, workspaceId: input.workspaceId,
    });
  }
}

function authorize(actor: CustodyActor): void {
  const denied = requireCapability(actor, "policy.authority-key.manage");
  if (denied !== null) throw new Error(denied.code);
}
