import "server-only";

import { PrismaClient, type Prisma } from "@prisma/client";

export type TransactionClient = Prisma.TransactionClient;
export type PersistenceClient = PrismaClient;

export function createPersistenceClient(databaseUrl?: string): PrismaClient {
  return new PrismaClient(
    databaseUrl === undefined
      ? undefined
      : { datasources: { db: { url: databaseUrl } } },
  );
}

export async function inTransaction<T>(
  client: PrismaClient,
  operation: (transaction: TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(operation);
}
