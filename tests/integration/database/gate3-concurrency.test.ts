import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@kernel-zero/domain";
import {
  createPersistenceClient,
  createWorkspace,
  QuotaExceededError,
  runSerializableTransaction,
  type PersistenceClient,
} from "@kernel-zero/persistence";

import { isolatedTestDatabaseUrl } from "./environment";

describe("Gate 3 isolated PostgreSQL concurrency", () => {
  let prisma: PersistenceClient;
  let actorUserId: string;
  let workspaceId: string;
  const correlationId = "0195f000-0000-7000-8000-000000000001";

  beforeAll(async () => {
    prisma = createPersistenceClient(isolatedTestDatabaseUrl());
    actorUserId = generateUuidV7();
    await prisma.user.create({
      data: {
        displayName: "Gate 3 actor",
        email: `gate3-${actorUserId}@example.test`,
        id: actorUserId,
        normalizedEmail: `gate3-${actorUserId}@example.test`,
      },
    });
    const context = await createWorkspace(prisma, {
      correlationId,
      name: `Gate 3 ${actorUserId}`,
      userId: actorUserId,
    });
    workspaceId = context.workspace.id;
    await prisma.quotaCounter.update({
      data: { reserved: 0, used: 2 },
      where: {
        workspaceId_quotaKey_periodKey: {
          periodKey: "lifetime",
          quotaKey: "active_policy_packs",
          workspaceId,
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("allows exactly one of twenty final-unit operations and records only its audit", async () => {
    const outcomes = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
      try {
        await runSerializableTransaction(prisma, async (repositories) => {
          const reservation = await repositories.quota.reserve({
            amount: 1,
            limit: 3,
            periodKey: "lifetime",
            quotaKey: "active_policy_packs",
            workspaceId,
          });
          await repositories.quota.commit(workspaceId, reservation);
          await repositories.audit.append({
            actionCode: "test.final-unit",
            actor: { kind: "user", userId: actorUserId },
            correlationId,
            description: "Final quota unit committed.",
            metadata: { contender: index },
            subjectId: `contender-${String(index)}`,
            subjectType: "test",
            workspaceOpaqueId: workspaceId,
          });
        });
        return "committed" as const;
      } catch (error) {
        if (error instanceof QuotaExceededError) return "quota" as const;
        throw error;
      }
    }));
    expect(outcomes.filter((outcome) => outcome === "committed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "quota")).toHaveLength(19);
    await expect(prisma.quotaCounter.findUniqueOrThrow({
      where: { workspaceId_quotaKey_periodKey: { periodKey: "lifetime", quotaKey: "active_policy_packs", workspaceId } },
    })).resolves.toMatchObject({ reserved: 0, used: 3 });
    await expect(prisma.auditRecord.count({ where: { actionCode: "test.final-unit", workspaceOpaqueId: workspaceId } })).resolves.toBe(1);
  });

  it("rolls quota back when immutable audit persistence fails", async () => {
    const before = await prisma.quotaCounter.findUniqueOrThrow({
      where: { workspaceId_quotaKey_periodKey: { periodKey: "lifetime", quotaKey: "occupied_seats", workspaceId } },
    });
    await expect(runSerializableTransaction(prisma, async (repositories) => {
      const reservation = await repositories.quota.reserve({
        amount: 1,
        limit: 3,
        periodKey: "lifetime",
        quotaKey: "occupied_seats",
        workspaceId,
      });
      await repositories.quota.commit(workspaceId, reservation);
      await repositories.audit.append({
        actionCode: "test.audit-failure",
        actor: { kind: "user", userId: "0195f000-0000-7000-8000-999999999999" },
        correlationId,
        description: "This insert must fail its user foreign key.",
        metadata: {},
        subjectId: "failure",
        subjectType: "test",
        workspaceOpaqueId: workspaceId,
      });
    })).rejects.toBeDefined();
    await expect(prisma.quotaCounter.findUniqueOrThrow({
      where: { workspaceId_quotaKey_periodKey: { periodKey: "lifetime", quotaKey: "occupied_seats", workspaceId } },
    })).resolves.toMatchObject({ reserved: before.reserved, used: before.used });
  });
});
