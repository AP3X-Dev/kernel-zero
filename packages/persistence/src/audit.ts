import "server-only";

import type { Prisma } from "@prisma/client";
import {
  canonicalJson,
  err,
  generateUuidV7,
  isCorrelationId,
  isUuidV7,
  ok,
  type AppError,
  type JsonPrimitive,
  type Result,
} from "@kernel-zero/domain";
import { appError } from "@kernel-zero/domain";

import type { TransactionClient } from "./client";

export type AuditActor =
  | Readonly<{ kind: "operator" }>
  | Readonly<{ kind: "system"; reference: string }>;

export type AuditMetadata = Readonly<Record<string, JsonPrimitive>>;

export type AuditRecordInput = Readonly<{
  actionCode: string;
  actor: AuditActor;
  clientAddressHint?: string | null;
  correlationId: string;
  description: string;
  metadata: AuditMetadata;
  subjectId: string;
  subjectType: string;
  userAgentHint?: string | null;
  workspaceOpaqueId: string;
}>;

export const SAFE_AUDIT_SELECT = Object.freeze({
  actionCode: true,
  actorKind: true,
  correlationId: true,
  createdAt: true,
  description: true,
  id: true,
  metadata: true,
  subjectId: true,
  subjectType: true,
  systemActorRef: true,
  workspaceOpaqueId: true,
} as const satisfies Prisma.AuditRecordSelect);

export type SafeAuditRecord = Prisma.AuditRecordGetPayload<{ select: typeof SAFE_AUDIT_SELECT }>;

export function validateAuditRecord(input: AuditRecordInput): Result<AuditRecordInput, AppError> {
  if (!isUuidV7(input.workspaceOpaqueId)) return invalid("workspaceOpaqueId");
  if (!isCorrelationId(input.correlationId)) return invalid("correlationId");
  if (!bounded(input.actionCode, 120)) return invalid("actionCode");
  if (!bounded(input.subjectType, 120)) return invalid("subjectType");
  if (!bounded(input.subjectId, 255)) return invalid("subjectId");
  if (!bounded(input.description, 1_000)) return invalid("description");
  if (input.actor.kind === "system" && !bounded(input.actor.reference, 120)) return invalid("actor.reference");
  if (!hint(input.clientAddressHint, 128)) return invalid("clientAddressHint");
  if (!hint(input.userAgentHint, 1_024)) return invalid("userAgentHint");
  const keys = Object.keys(input.metadata);
  if (keys.length > 32 || !isPlainObject(input.metadata)) return invalid("metadata");
  for (const value of Object.values(input.metadata)) {
    if (value !== null && typeof value !== "boolean" && typeof value !== "number" && typeof value !== "string") {
      return invalid("metadata");
    }
    if (typeof value === "number" && !Number.isFinite(value)) return invalid("metadata");
  }
  try {
    if (Buffer.byteLength(canonicalJson(input.metadata), "utf8") > 16 * 1_024) return invalid("metadata");
  } catch {
    return invalid("metadata");
  }
  return ok(input);
}

export type TransactionAuditRepository = Readonly<{
  append(input: AuditRecordInput): Promise<SafeAuditRecord>;
  listSafe(input: Readonly<{ cursor?: string; limit: number; workspaceOpaqueId: string }>): Promise<readonly SafeAuditRecord[]>;
}>;

class AuditValidationError extends Error {
  readonly code;
  readonly details;

  constructor(error: AppError) {
    super(error.message);
    this.name = "AuditValidationError";
    this.code = error.code;
    this.details = error.details;
  }
}

export function createAuditRepository(tx: TransactionClient): TransactionAuditRepository {
  return Object.freeze({
    async append(input) {
      const validation = validateAuditRecord(input);
      if (!validation.ok) throw new AuditValidationError(validation.error);
      const systemActorRef = input.actor.kind === "system" ? input.actor.reference.trim() : null;
      return tx.auditRecord.create({
        data: {
          actionCode: input.actionCode.trim(),
          actorKind: input.actor.kind,
          clientAddressHint: input.clientAddressHint ?? null,
          correlationId: input.correlationId,
          description: input.description.trim(),
          id: generateUuidV7(),
          metadata: input.metadata,
          subjectId: input.subjectId.trim(),
          subjectType: input.subjectType.trim(),
          systemActorRef,
          userAgentHint: input.userAgentHint ?? null,
          workspaceOpaqueId: input.workspaceOpaqueId,
        },
        select: SAFE_AUDIT_SELECT,
      });
    },

    async listSafe(input) {
      return tx.auditRecord.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: SAFE_AUDIT_SELECT,
        take: Math.max(1, Math.min(100, Math.trunc(input.limit))),
        where: {
          workspaceOpaqueId: input.workspaceOpaqueId,
          ...(input.cursor === undefined ? {} : { id: { lt: input.cursor } }),
        },
      });
    },
  });
}

function invalid(field: string): Result<never, AppError> {
  return err(appError("VALIDATION_FAILED", { details: { field } }));
}

function bounded(value: string, max: number): boolean {
  const length = value.trim().length;
  return length >= 1 && length <= max;
}

function hint(value: string | null | undefined, max: number): boolean {
  return value === undefined || value === null || value.length <= max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
