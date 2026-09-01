import "server-only";

import type { PrismaClient } from "@prisma/client";

import { createAuditRepository, type TransactionAuditRepository } from "./audit";
import type { TransactionClient } from "./client";
import { mapKnownPersistenceError } from "./constraint-errors";
import { createQuotaRepository, type TransactionQuotaRepository } from "./quota";

export type TransactionRepositorySet = Readonly<{
  audit: TransactionAuditRepository;
  quota: TransactionQuotaRepository;
  transaction: TransactionClient;
}>;

export function transactionRepositorySet(tx: TransactionClient): TransactionRepositorySet {
  return Object.freeze({
    audit: createAuditRepository(tx),
    quota: createQuotaRepository(tx),
    transaction: tx,
  });
}

export type SerializableTransactionOptions = Readonly<{
  jitter?: (attempt: number) => number;
  maxAttempts?: number;
  repositoryFactory?: (transaction: TransactionClient) => TransactionRepositorySet;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}>;

export async function runSerializableTransaction<T>(
  client: PrismaClient,
  operation: (repositories: TransactionRepositorySet) => Promise<T>,
  options: SerializableTransactionOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new TypeError("maxAttempts must be between one and three.");
  }
  const jitter = options.jitter ?? ((attempt: number) => Math.min(50, 5 + attempt * 10));
  const repositoryFactory = options.repositoryFactory ?? transactionRepositorySet;
  const sleep = options.sleep ?? delay;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await client.$transaction(
        (tx) => operation(repositoryFactory(tx)),
        { isolationLevel: "Serializable", maxWait: 5_000, timeout: options.timeoutMs ?? 10_000 },
      );
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === maxAttempts) throw mapKnownPersistenceError(error);
      const wait = Math.max(0, Math.min(50, Math.trunc(jitter(attempt))));
      await sleep(wait);
    }
  }
  throw new Error("Unreachable transaction retry state.");
}

export function isSerializationConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  return candidate.code === "P2034" || candidate.code === "40001" || candidate.meta?.code === "40001";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
