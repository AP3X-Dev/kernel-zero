import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@kernel-zero/domain";
import {
  approvePolicyRevision,
  createPersistenceClient,
  createPolicyPack,
  runSerializableTransaction,
  type PersistenceClient,
} from "@kernel-zero/persistence";

import { isolatedTestDatabaseUrl } from "./environment";

const correlationId = "0195f000-0000-7000-8000-000000000001";

const document = {
  apiVersion: "kernel-zero.dev/v1" as const, kind: "RepositoryPolicy",
  metadata: { description: "Gate 3 database policy", name: "gate-three-policy", revision: 1 },
  scope: { exclude: [], include: ["packages/**/*.ts"], languages: ["typescript"] },
  rules: [{ check: { allowTypeOnly: false, files: ["packages/**"], kind: "require-import", module: "server-only" }, id: "server-only-rule", level: "error" as const, remediation: "Add the server-only marker.", title: "Server-only marker" }],
};

describe("Gate 3 isolated PostgreSQL concurrency", () => {
  let prisma: PersistenceClient;
  let workspaceId: string;
  let revisionId: string;

  beforeAll(async () => {
    prisma = createPersistenceClient(isolatedTestDatabaseUrl());
    workspaceId = generateUuidV7();
    ({ revisionId } = await createPolicyPack(prisma, {
      correlationId, description: "Gate 3 database policy", displayName: "Gate Three Policy", document, slug: "gate-three-policy", workspaceId,
    }));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lets exactly one of twenty concurrent approvals freeze the draft and records only its audit", async () => {
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () =>
      approvePolicyRevision(prisma, { correlationId, revisionId, workspaceId })));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    await expect(prisma.policyRevision.findUniqueOrThrow({ where: { id: revisionId } })).resolves.toMatchObject({ state: "approved" });
    await expect(prisma.auditRecord.count({ where: { actionCode: "policy.revision-approved", subjectId: revisionId, workspaceOpaqueId: workspaceId } })).resolves.toBe(1);
  });

  it("rolls the business write back together with its audit record when the transaction fails", async () => {
    const packId = generateUuidV7();
    await expect(runSerializableTransaction(prisma, async (repositories) => {
      await repositories.transaction.policyPack.create({ data: {
        description: "Must not persist.", displayName: "Rollback", id: packId, lifecycleState: "draft", slug: "rollback-pack", workspaceId,
      } });
      await repositories.audit.append({
        actionCode: "test.rollback",
        actor: { kind: "operator" },
        correlationId,
        description: "This record must roll back with the pack.",
        metadata: {},
        subjectId: packId,
        subjectType: "test",
        workspaceOpaqueId: workspaceId,
      });
      throw new Error("forced failure after the write");
    })).rejects.toThrow("forced failure");
    await expect(prisma.policyPack.count({ where: { id: packId } })).resolves.toBe(0);
    await expect(prisma.auditRecord.count({ where: { actionCode: "test.rollback", workspaceOpaqueId: workspaceId } })).resolves.toBe(0);
  });
});
