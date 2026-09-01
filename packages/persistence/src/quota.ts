import "server-only";

import type { TransactionClient } from "./client";
import type { QuotaKey } from "@kernel-zero/domain";

export type QuotaReservation = Readonly<{
  amount: number;
  periodKey: string;
  quotaKey: QuotaKey;
}>;

export type QuotaReservationRequest = QuotaReservation & Readonly<{
  limit: number | null;
  workspaceId: string;
}>;

export class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED" as const;
  readonly quotaKey: QuotaKey;

  constructor(quotaKey: QuotaKey) {
    super(`Quota unavailable: ${quotaKey}`);
    this.name = "QuotaExceededError";
    this.quotaKey = quotaKey;
  }
}

export class QuotaCounterInvariantError extends Error {
  readonly code = "CONFLICT" as const;
  readonly quotaKey: QuotaKey;

  constructor(quotaKey: QuotaKey) {
    super(`Quota counter invariant failed: ${quotaKey}`);
    this.name = "QuotaCounterInvariantError";
    this.quotaKey = quotaKey;
  }
}

export type TransactionQuotaRepository = Readonly<{
  commit(workspaceId: string, reservation: QuotaReservation): Promise<void>;
  decrementUsed(input: Readonly<{
    actualCount: number;
    periodKey: string;
    quotaKey: QuotaKey;
    workspaceId: string;
  }>): Promise<void>;
  release(workspaceId: string, reservation: QuotaReservation): Promise<void>;
  reserve(input: QuotaReservationRequest): Promise<QuotaReservation>;
}>;

export function createQuotaRepository(tx: TransactionClient): TransactionQuotaRepository {
  return Object.freeze({
    async reserve(input) {
      assertPositiveInteger(input.amount, "amount");
      let changed: number;
      if (input.limit === null) {
        const result = await tx.quotaCounter.updateMany({
          data: { reserved: { increment: input.amount } },
          where: quotaScope(input),
        });
        changed = result.count;
      } else {
        assertNonnegativeInteger(input.limit, "limit");
        changed = await tx.$executeRaw`
          UPDATE "QuotaCounter"
          SET "reserved" = "reserved" + ${input.amount}, "updatedAt" = now()
          WHERE "workspaceId" = ${input.workspaceId}::uuid
            AND "quotaKey" = ${input.quotaKey}
            AND "periodKey" = ${input.periodKey}
            AND "used" + "reserved" + ${input.amount} <= ${input.limit}
        `;
      }
      if (changed !== 1) throw new QuotaExceededError(input.quotaKey);
      return Object.freeze({
        amount: input.amount,
        periodKey: input.periodKey,
        quotaKey: input.quotaKey,
      });
    },

    async commit(workspaceId, reservation) {
      assertReservation(reservation);
      const changed = await tx.quotaCounter.updateMany({
        data: {
          reserved: { decrement: reservation.amount },
          used: { increment: reservation.amount },
        },
        where: {
          ...quotaScope({ ...reservation, workspaceId }),
          reserved: { gte: reservation.amount },
        },
      });
      if (changed.count !== 1) throw new QuotaCounterInvariantError(reservation.quotaKey);
    },

    async release(workspaceId, reservation) {
      assertReservation(reservation);
      const changed = await tx.quotaCounter.updateMany({
        data: { reserved: { decrement: reservation.amount } },
        where: {
          ...quotaScope({ ...reservation, workspaceId }),
          reserved: { gte: reservation.amount },
        },
      });
      if (changed.count !== 1) throw new QuotaCounterInvariantError(reservation.quotaKey);
    },

    async decrementUsed(input) {
      assertNonnegativeInteger(input.actualCount, "actualCount");
      if (input.actualCount === 0) return;
      const changed = await tx.quotaCounter.updateMany({
        data: { used: { decrement: input.actualCount } },
        where: {
          ...quotaScope(input),
          used: { gte: input.actualCount },
        },
      });
      if (changed.count !== 1) throw new QuotaCounterInvariantError(input.quotaKey);
    },
  });
}

function quotaScope(input: Readonly<{
  periodKey: string;
  quotaKey: QuotaKey;
  workspaceId: string;
}>): Readonly<{ periodKey: string; quotaKey: QuotaKey; workspaceId: string }> {
  return {
    periodKey: input.periodKey,
    quotaKey: input.quotaKey,
    workspaceId: input.workspaceId,
  };
}

function assertReservation(reservation: QuotaReservation): void {
  assertPositiveInteger(reservation.amount, "amount");
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer.`);
}

function assertNonnegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a nonnegative integer.`);
}
