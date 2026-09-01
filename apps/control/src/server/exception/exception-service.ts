import "server-only";

import type { KeyLike } from "node:crypto";

import {
  decideException,
  exportExceptionGrantSet,
  registerSigningKey,
  requestException,
  revokeException,
  revokeSigningKey,
  type PersistenceClient,
} from "@kernel-zero/persistence";

import { requireCapability, type WorkspaceAuthoritySource } from "../authorization/workspace";

export type ExceptionActor = WorkspaceAuthoritySource & Readonly<{ userId: string }>;

type ExceptionOperations = Readonly<{
  decide: typeof decideException;
  exportBundle: typeof exportExceptionGrantSet;
  registerKey: typeof registerSigningKey;
  request: typeof requestException;
  revoke: typeof revokeException;
  revokeKey: typeof revokeSigningKey;
}>;

const defaultOperations: ExceptionOperations = Object.freeze({
  decide: decideException,
  exportBundle: exportExceptionGrantSet,
  registerKey: registerSigningKey,
  request: requestException,
  revoke: revokeException,
  revokeKey: revokeSigningKey,
});

export class ExceptionService {
  readonly #operations: ExceptionOperations;
  readonly #prisma: PersistenceClient;

  constructor(prisma: PersistenceClient, operations: ExceptionOperations = defaultOperations) {
    this.#operations = operations;
    this.#prisma = prisma;
  }

  async request(input: Readonly<{ actor: ExceptionActor; correlationId: string; findingFingerprint: string; issueUrl?: string | null; policyDigest: string; rationale: string; ruleId: string; validUntil: Date; workspaceId: string }>) {
    authorize(input.actor, "exception.request");
    return this.#operations.request(this.#prisma, { actorUserId: input.actor.userId, correlationId: input.correlationId, findingFingerprint: input.findingFingerprint, ...(input.issueUrl === undefined ? {} : { issueUrl: input.issueUrl }), policyDigest: input.policyDigest, rationale: input.rationale, ruleId: input.ruleId, validUntil: input.validUntil, workspaceId: input.workspaceId });
  }

  async decide(input: Readonly<{ actor: ExceptionActor; correlationId: string; decision: "approved" | "denied"; decisionNote: string; exceptionId: string; workspaceId: string }>): Promise<void> {
    authorize(input.actor, "exception.decide");
    await this.#operations.decide(this.#prisma, { actorUserId: input.actor.userId, correlationId: input.correlationId, decision: input.decision, decisionNote: input.decisionNote, exceptionId: input.exceptionId, workspaceId: input.workspaceId });
  }

  async revoke(input: Readonly<{ actor: ExceptionActor; correlationId: string; exceptionId: string; reason: string; workspaceId: string }>): Promise<void> {
    authorize(input.actor, "exception.revoke");
    await this.#operations.revoke(this.#prisma, { actorUserId: input.actor.userId, correlationId: input.correlationId, exceptionId: input.exceptionId, reason: input.reason, workspaceId: input.workspaceId });
  }

  async registerKey(input: Readonly<{ actor: ExceptionActor; correlationId: string; keyId: string; label: string; publicKey: string; workspaceId: string }>) {
    authorize(input.actor, "evidence.signing-key.manage");
    return this.#operations.registerKey(this.#prisma, { actorUserId: input.actor.userId, correlationId: input.correlationId, keyId: input.keyId, label: input.label, publicKey: input.publicKey, workspaceId: input.workspaceId });
  }

  async revokeKey(input: Readonly<{ actor: ExceptionActor; correlationId: string; keyId: string; workspaceId: string }>) {
    authorize(input.actor, "evidence.signing-key.manage");
    return this.#operations.revokeKey(this.#prisma, { actorUserId: input.actor.userId, correlationId: input.correlationId, keyId: input.keyId, workspaceId: input.workspaceId });
  }

  async exportBundle(input: Readonly<{ actor: ExceptionActor; keyId: string; policyDigest: string; privateKey: KeyLike; workspaceId: string }>, generatedAt = new Date()) {
    authorize(input.actor, "exception.read");
    return this.#operations.exportBundle(this.#prisma, { keyId: input.keyId, policyDigest: input.policyDigest, privateKey: input.privateKey, workspaceId: input.workspaceId }, generatedAt);
  }
}

function authorize(actor: ExceptionActor, capability: "evidence.signing-key.manage" | "exception.decide" | "exception.read" | "exception.request" | "exception.revoke"): void {
  const denied = requireCapability(actor, capability);
  if (denied !== null) throw new Error(denied.code);
}
