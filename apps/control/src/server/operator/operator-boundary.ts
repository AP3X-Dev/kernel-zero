import "server-only";

import { generateUuidV7 } from "@kernel-zero/domain";
import type { PersistenceClient } from "@kernel-zero/persistence";

export type OperatorSession = Readonly<{
  normalizedEmail: string;
  userId: string;
}>;

export async function resolveSystemOperator(
  prisma: PersistenceClient,
  input: Readonly<{
    configuredEmail: string;
    normalizedEmail: string;
    userId: string;
  }>,
): Promise<boolean> {
  const existing = await prisma.systemOperatorGrant.findUnique({ where: { userId: input.userId } });
  if (existing !== null) return existing.revokedAt === null;
  if (input.normalizedEmail !== input.configuredEmail) return false;
  const grant = await prisma.systemOperatorGrant.upsert({
    create: {
      id: generateUuidV7(),
      source: "bootstrap",
      userId: input.userId,
    },
    update: {},
    where: { userId: input.userId },
  });
  return grant.revokedAt === null;
}

export type OperatorRouteDecision = Readonly<{
  decision: "allow" | "application" | "not-found" | "sign-in";
}>;

export async function authorizeOperatorRoute(input: Readonly<{
  configuredEmail: string | null;
  prisma?: PersistenceClient;
  session: OperatorSession | null;
}>): Promise<OperatorRouteDecision> {
  if (input.configuredEmail === null) return { decision: "not-found" };
  if (input.session === null) return { decision: "sign-in" };
  if (input.prisma === undefined) throw new TypeError("Operator persistence is required.");
  const allowed = await resolveSystemOperator(input.prisma, {
    configuredEmail: input.configuredEmail,
    normalizedEmail: input.session.normalizedEmail,
    userId: input.session.userId,
  });
  return { decision: allowed ? "allow" : "application" };
}
