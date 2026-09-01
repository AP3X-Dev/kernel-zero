/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { describe, expect, it, vi } from "vitest";

import {
  canonicalEvidenceDigest,
  deriveEvidenceSummary,
  findingIdentity,
  findingMessage,
  type RepositoryEvidence,
} from "@kernel-zero/contracts";

import {
  deleteExpiredEvidence,
  listEvidenceFindings,
  listEvidenceRuns,
  storeEvidenceRun,
} from "./evidence";

const WORKSPACE = "0195f000-0000-7000-8000-000000000002";
const SUBMITTER = "0195f000-0000-7000-8000-000000000003";
const CORRELATION = "0195f000-0000-7000-8000-000000000001";
const RUN_ID = "0195f000-0000-7000-8000-000000000004";
const digest = (digit: string) => `sha256:${digit.repeat(64)}` as const;

function evidence(runId = RUN_ID): RepositoryEvidence {
  const policyDigest = digest("1");
  const location = { endColumn: 10, endLine: 4, startColumn: 2, startLine: 4 };
  const identity = findingIdentity({
    location,
    messageCode: "DENIED_IMPORT",
    path: "apps/control/src/app/page.tsx",
    policyDigest,
    ruleId: "layers-no-ui-db",
    subject: "@prisma/client",
  });
  const finding = {
    ...identity,
    exceptionId: null,
    level: "error" as const,
    location,
    message: findingMessage("DENIED_IMPORT"),
    messageCode: "DENIED_IMPORT" as const,
    path: "apps/control/src/app/page.tsx",
    ruleId: "layers-no-ui-db",
    subject: "@prisma/client",
  };
  const base = {
    apiVersion: "kernel-zero.dev/evidence/v1" as const,
    exceptionBundleDigest: null,
    findings: [finding],
    generatedAt: "2026-08-31T12:00:00.000Z",
    kind: "RepositoryEvidence" as const,
    policy: { digest: policyDigest, name: "service-boundaries", revision: 1 },
    result: { ...deriveEvidenceSummary([finding], 4), durationMs: 125 },
    runId,
    signature: null,
    subject: { manifestDigest: digest("2"), repository: "example/service", revision: "git:abc123" },
    tool: { name: "kernel-zero-validator" as const, version: "1.0.0" },
    workspace: WORKSPACE,
  };
  return { ...base, integrity: { algorithm: "sha256", digest: canonicalEvidenceDigest(base) } };
}

function client(tx: object, evidenceRunFindUnique = vi.fn().mockResolvedValue(null)) {
  return {
    $transaction: vi.fn(async (operation: (transaction: object) => Promise<unknown>) => operation(tx)),
    evidenceRun: { findUnique: evidenceRunFindUnique },
  } as never;
}

describe("evidence persistence", () => {
  it("atomically stores an immutable tenant run, normalized finding subjects, and its audit", async () => {
    const tx = {
      auditRecord: { create: vi.fn().mockResolvedValue({ id: "audit" }) },
      evidenceRun: {
        create: vi.fn().mockResolvedValue({ id: "internal-run" }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      finding: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    const result = await storeEvidenceRun(client(tx), {
      attestationState: "recorded",
      correlationId: CORRELATION,
      document: evidence(),
      submitterId: SUBMITTER,
      workspaceId: WORKSPACE,
    });

    expect(result).toEqual({ created: true, integrityDigest: evidence().integrity.digest, runId: RUN_ID });
    expect(tx.evidenceRun.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      attestationState: "recorded",
      integrityDigest: evidence().integrity.digest,
      runId: RUN_ID,
      workspaceId: WORKSPACE,
    }) }));
    expect(tx.finding.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      evidenceRunId: "internal-run",
      subject: "@prisma/client",
      workspaceId: WORKSPACE,
    })] });
    expect(tx.auditRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      actionCode: "evidence.recorded",
      correlationId: CORRELATION,
      workspaceOpaqueId: WORKSPACE,
    }) }));
  });

  it("returns an idempotent result for the same tenant/run digest and conflicts for changed content", async () => {
    const sameTx = {
      evidenceRun: { findUnique: vi.fn().mockResolvedValue({ integrityDigest: evidence().integrity.digest }) },
    };
    await expect(storeEvidenceRun(client(sameTx), {
      attestationState: "recorded", correlationId: CORRELATION, document: evidence(), submitterId: SUBMITTER, workspaceId: WORKSPACE,
    })).resolves.toEqual({ created: false, integrityDigest: evidence().integrity.digest, runId: RUN_ID });

    const conflictTx = {
      evidenceRun: { findUnique: vi.fn().mockResolvedValue({ integrityDigest: digest("9") }) },
    };
    await expect(storeEvidenceRun(client(conflictTx), {
      attestationState: "recorded", correlationId: CORRELATION, document: evidence(), submitterId: SUBMITTER, workspaceId: WORKSPACE,
    })).rejects.toThrow("CONFLICT:run_digest");
  });

  it("resolves a concurrent unique race through the stored canonical digest", async () => {
    const uniqueRace = Object.assign(new Error("unique"), { code: "P2002", meta: { target: ["workspaceId", "runId"] } });
    const tx = {
      evidenceRun: { create: vi.fn().mockRejectedValue(uniqueRace), findUnique: vi.fn().mockResolvedValue(null) },
    };
    const findUnique = vi.fn().mockResolvedValue({ integrityDigest: evidence().integrity.digest });
    const result = await storeEvidenceRun(client(tx, findUnique), {
      attestationState: "recorded", correlationId: CORRELATION, document: evidence(), submitterId: SUBMITTER, workspaceId: WORKSPACE,
    });
    expect(result.created).toBe(false);
    expect(findUnique).toHaveBeenCalledWith({ where: { workspaceId_runId: { runId: RUN_ID, workspaceId: WORKSPACE } } });
  });

  it("uses tenant-scoped run filters and omits internal and signature data from review DTOs", async () => {
    const row = {
      attestationState: "recorded", correlationId: CORRELATION, createdAt: new Date("2026-08-31T12:01:00.000Z"),
      errorCount: 1, exceptedCount: 0, filesScanned: 4, generatedAt: new Date("2026-08-31T12:00:00.000Z"),
      id: "0195f000-0000-7000-8000-000000000010", integrityDigest: digest("3"), manifestDigest: digest("2"),
      policyDigest: digest("1"), repositoryLabel: "example/service", revisionLabel: "git:abc123", runId: RUN_ID,
      signatureKeyId: null, status: "fail", submitterId: SUBMITTER, toolVersion: "1.0.0", warningCount: 0,
    };
    const findMany = vi.fn().mockResolvedValue([row]);
    const page = await listEvidenceRuns({ evidenceRun: { findMany } } as never, {
      attestationState: "recorded", limit: 25, policyDigest: digest("1"), repositoryLabel: "example/service",
      status: "fail", submitterId: SUBMITTER, workspaceId: WORKSPACE,
    });

    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
      attestationState: "recorded", policyDigest: digest("1"), repositoryLabel: "example/service",
      status: "fail", submitterId: SUBMITTER, workspaceId: WORKSPACE,
    });
    expect(page.items[0]).not.toHaveProperty("id");
    expect(page.items[0]).not.toHaveProperty("signatureValue");
    expect(page.items[0]).toMatchObject({ attestationState: "recorded", runId: RUN_ID, status: "fail" });
    await expect(listEvidenceRuns({ evidenceRun: { findMany } } as never, { limit: 101, workspaceId: WORKSPACE })).rejects.toThrow("VALIDATION_FAILED:limit");
  });

  it("uses tenant-scoped finding filters and returns bounded safe pages", async () => {
    const row = {
      createdAt: new Date("2026-08-31T12:01:00.000Z"), endColumn: 10, endLine: 4,
      evidenceRun: { runId: RUN_ID }, exceptionRequestId: null, findingId: digest("4"), fingerprint: digest("5"),
      id: "0195f000-0000-7000-8000-000000000011", level: "error", message: findingMessage("DENIED_IMPORT"),
      messageCode: "DENIED_IMPORT", path: "apps/control/src/app/page.tsx", ruleId: "layers-no-ui-db",
      startColumn: 2, startLine: 4, subject: "@prisma/client",
    };
    const findMany = vi.fn().mockResolvedValue([row]);
    const page = await listEvidenceFindings({ finding: { findMany } } as never, {
      exceptionState: "unexcepted", level: "error", limit: 25, path: row.path, ruleId: row.ruleId,
      runId: RUN_ID, workspaceId: WORKSPACE,
    });
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
      evidenceRun: { runId: RUN_ID, workspaceId: WORKSPACE }, exceptionRequestId: null,
      level: "error", path: row.path, ruleId: row.ruleId, workspaceId: WORKSPACE,
    });
    expect(page.items[0]).not.toHaveProperty("id");
    expect(page.items[0]).not.toHaveProperty("evidenceRunId");
    expect(page.items[0]).toMatchObject({ exceptionState: "unexcepted", runId: RUN_ID, subject: "@prisma/client" });
  });

  it("deletes only the deterministic expired batch and writes its summary in the same transaction", async () => {
    const tx = {
      auditRecord: { create: vi.fn().mockResolvedValue({ id: "audit" }) },
      evidenceRun: {
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
        findMany: vi.fn().mockResolvedValue([
          { id: "0195f000-0000-7000-8000-000000000020", runId: "0195f000-0000-7000-8000-000000000030" },
          { id: "0195f000-0000-7000-8000-000000000021", runId: "0195f000-0000-7000-8000-000000000031" },
        ]),
      },
      finding: { count: vi.fn().mockResolvedValue(7) },
    };
    const result = await deleteExpiredEvidence(client(tx), {
      batchSize: 100, correlationId: CORRELATION, plan: "Open", workspaceId: WORKSPACE,
    }, new Date("2026-08-31T00:00:00.000Z"));

    expect(tx.evidenceRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ generatedAt: "asc" }, { id: "asc" }], take: 100,
      where: { generatedAt: { lt: new Date("2026-08-01T00:00:00.000Z") }, workspaceId: WORKSPACE },
    }));
    expect(tx.evidenceRun.deleteMany).toHaveBeenCalledWith({ where: {
      id: { in: ["0195f000-0000-7000-8000-000000000020", "0195f000-0000-7000-8000-000000000021"] },
      workspaceId: WORKSPACE,
    } });
    expect(tx.auditRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      actionCode: "evidence.retention.completed",
      actorKind: "system",
      metadata: expect.objectContaining({ findingsDeleted: 7, retentionDays: 30, runsDeleted: 2 }),
      systemActorRef: "evidence-retention",
      workspaceOpaqueId: WORKSPACE,
    }) }));
    expect(result).toEqual({ cutoff: new Date("2026-08-01T00:00:00.000Z"), findingsDeleted: 7, runsDeleted: 2 });
  });
});
