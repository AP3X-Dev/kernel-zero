import "server-only";

import type { Prisma } from "@prisma/client";
import { RepositoryEvidenceSchema, type RepositoryEvidence } from "@kernel-zero/contracts";
import {
  PLAN_CATALOGUE,
  generateUuidV7,
  isCorrelationId,
  isSha256Digest,
  isUuidV7,
  parsePagination,
  type PlanName,
} from "@kernel-zero/domain";

import { createAuditRepository } from "./audit";
import type { PersistenceClient, TransactionClient } from "./client";

export type EvidenceAttestationState = "attested" | "recorded";
export type EvidenceResultStatus = "error" | "fail" | "pass";
export type FindingExceptionState = "excepted" | "unexcepted";

export type StoreEvidenceRunInput = Readonly<{
  attestationState: EvidenceAttestationState;
  correlationId: string;
  document: RepositoryEvidence;
  submitterId: string;
  workspaceId: string;
}>;

export type StoreEvidenceRunResult = Readonly<{
  created: boolean;
  integrityDigest: string;
  runId: string;
}>;

export type EvidenceRunReview = Readonly<{
  attestationState: EvidenceAttestationState;
  correlationId: string;
  createdAt: Date;
  durationMs: number;
  errorCount: number;
  evidenceKind: "local";
  exceptedCount: number;
  exceptionBundleDigest: string | null;
  filesScanned: number;
  generatedAt: Date;
  integrityDigest: string;
  manifestDigest: string;
  policyDigest: string;
  qualification: "not-release-qualified";
  repositoryLabel: string;
  revisionLabel: string;
  runId: string;
  signatureKeyId: string | null;
  status: EvidenceResultStatus;
  submitterId: string;
  toolVersion: string;
  warningCount: number;
}>;

export type EvidenceFindingReview = Readonly<{
  createdAt: Date;
  exceptionId: string | null;
  exceptionState: FindingExceptionState;
  findingId: string;
  fingerprint: string;
  level: "error" | "warning";
  location: Readonly<{
    endColumn: number;
    endLine: number;
    startColumn: number;
    startLine: number;
  }>;
  message: string;
  messageCode: string;
  path: string;
  ruleId: string;
  runId: string;
  subject: string;
}>;

export type EvidenceRunFilters = Readonly<{
  attestationState?: EvidenceAttestationState;
  cursor?: string;
  generatedFrom?: Date;
  generatedTo?: Date;
  limit?: number;
  policyDigest?: string;
  repositoryLabel?: string;
  status?: EvidenceResultStatus;
  submitterId?: string;
  workspaceId: string;
}>;

export type EvidenceFindingFilters = Readonly<{
  cursor?: string;
  exceptionState?: FindingExceptionState;
  level?: "error" | "warning";
  limit?: number;
  path?: string;
  ruleId?: string;
  runId?: string;
  workspaceId: string;
}>;

export type EvidencePage<T> = Readonly<{
  items: readonly T[];
  nextCursor: string | null;
}>;

export type EvidenceRetentionInput = Readonly<{
  batchSize?: number;
  correlationId: string;
  plan: PlanName;
  workspaceId: string;
}>;

export type EvidenceRetentionSummary = Readonly<{
  cutoff: Date;
  findingsDeleted: number;
  runsDeleted: number;
}>;

const RUN_REVIEW_SELECT = Object.freeze({
  attestationState: true,
  correlationId: true,
  createdAt: true,
  durationMs: true,
  errorCount: true,
  exceptedCount: true,
  exceptionBundleDigest: true,
  filesScanned: true,
  generatedAt: true,
  id: true,
  integrityDigest: true,
  manifestDigest: true,
  policyDigest: true,
  repositoryLabel: true,
  revisionLabel: true,
  runId: true,
  signatureKeyId: true,
  status: true,
  submitterId: true,
  toolVersion: true,
  warningCount: true,
} as const satisfies Prisma.EvidenceRunSelect);

const FINDING_REVIEW_SELECT = Object.freeze({
  createdAt: true,
  endColumn: true,
  endLine: true,
  evidenceRun: { select: { runId: true } },
  exceptionRequestId: true,
  findingId: true,
  fingerprint: true,
  id: true,
  level: true,
  message: true,
  messageCode: true,
  path: true,
  ruleId: true,
  startColumn: true,
  startLine: true,
  subject: true,
} as const satisfies Prisma.FindingSelect);

type RunReviewRow = Prisma.EvidenceRunGetPayload<{ select: typeof RUN_REVIEW_SELECT }>;
type FindingReviewRow = Prisma.FindingGetPayload<{ select: typeof FINDING_REVIEW_SELECT }>;
type StoredDuplicate = Readonly<{ integrityDigest: string }>;
type TimestampCursor = Readonly<{ id: string; timestamp: Date }>;
const EVIDENCE_ATTESTATION_STATES = new Set<string>(["attested", "recorded"]);

export async function storeEvidenceRun(
  client: PersistenceClient,
  input: StoreEvidenceRunInput,
): Promise<StoreEvidenceRunResult> {
  validateActorContext(input);
  if (!EVIDENCE_ATTESTATION_STATES.has(input.attestationState)) {
    throw failure("VALIDATION_FAILED", "attestationState");
  }
  const parsed = RepositoryEvidenceSchema.safeParse(input.document);
  if (!parsed.success) throw failure("INVALID_EVIDENCE", "document");
  const document = parsed.data;
  if (document.workspace !== input.workspaceId) throw failure("NOT_FOUND", "workspace");

  try {
    return await client.$transaction(async (tx) => storeInTransaction(tx, input, document));
  } catch (error) {
    if (!isEvidenceRunUniqueConflict(error)) throw error;
    const existing = await client.evidenceRun.findUnique({
      where: { workspaceId_runId: { runId: document.runId, workspaceId: input.workspaceId } },
    });
    if (existing === null) throw error;
    return resolveDuplicate(existing, document);
  }
}

export async function listEvidenceRuns(
  client: PersistenceClient,
  input: EvidenceRunFilters,
): Promise<EvidencePage<EvidenceRunReview>> {
  ensureWorkspace(input.workspaceId);
  validateRunFilters(input);
  const pagination = requiredPagination(input.limit, input.cursor);
  const cursor = pagination.cursor === undefined ? null : decodeCursor(pagination.cursor);
  const rows = await client.evidenceRun.findMany({
    orderBy: [{ generatedAt: "desc" }, { id: "desc" }],
    select: RUN_REVIEW_SELECT,
    take: pagination.limit + 1,
    where: {
      workspaceId: input.workspaceId,
      ...(input.attestationState === undefined ? {} : { attestationState: input.attestationState }),
      ...(input.policyDigest === undefined ? {} : { policyDigest: input.policyDigest }),
      ...(input.repositoryLabel === undefined ? {} : { repositoryLabel: input.repositoryLabel }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.submitterId === undefined ? {} : { submitterId: input.submitterId }),
      ...(input.generatedFrom === undefined && input.generatedTo === undefined ? {} : {
        generatedAt: {
          ...(input.generatedFrom === undefined ? {} : { gte: input.generatedFrom }),
          ...(input.generatedTo === undefined ? {} : { lte: input.generatedTo }),
        },
      }),
      ...(cursor === null ? {} : { OR: [
        { generatedAt: { lt: cursor.timestamp } },
        { generatedAt: cursor.timestamp, id: { lt: cursor.id } },
      ] }),
    },
  });
  return pageFromRows(rows, pagination.limit, (row) => row.generatedAt, toRunReview);
}

export async function listEvidenceFindings(
  client: PersistenceClient,
  input: EvidenceFindingFilters,
): Promise<EvidencePage<EvidenceFindingReview>> {
  ensureWorkspace(input.workspaceId);
  validateFindingFilters(input);
  const pagination = requiredPagination(input.limit, input.cursor);
  const cursor = pagination.cursor === undefined ? null : decodeCursor(pagination.cursor);
  const rows = await client.finding.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: FINDING_REVIEW_SELECT,
    take: pagination.limit + 1,
    where: {
      workspaceId: input.workspaceId,
      ...(input.exceptionState === undefined ? {} : {
        exceptionRequestId: input.exceptionState === "excepted" ? { not: null } : null,
      }),
      ...(input.level === undefined ? {} : { level: input.level }),
      ...(input.path === undefined ? {} : { path: input.path }),
      ...(input.ruleId === undefined ? {} : { ruleId: input.ruleId }),
      ...(input.runId === undefined ? {} : { evidenceRun: { runId: input.runId, workspaceId: input.workspaceId } }),
      ...(cursor === null ? {} : { OR: [
        { createdAt: { lt: cursor.timestamp } },
        { createdAt: cursor.timestamp, id: { lt: cursor.id } },
      ] }),
    },
  });
  return pageFromRows(rows, pagination.limit, (row) => row.createdAt, toFindingReview);
}

export async function deleteExpiredEvidence(
  client: PersistenceClient,
  input: EvidenceRetentionInput,
  now = new Date(),
): Promise<EvidenceRetentionSummary> {
  ensureWorkspace(input.workspaceId);
  if (!isCorrelationId(input.correlationId)) throw failure("VALIDATION_FAILED", "correlationId");
  if (!Number.isFinite(now.getTime())) throw failure("VALIDATION_FAILED", "now");
  const batchSize = input.batchSize ?? 500;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw failure("VALIDATION_FAILED", "batchSize");
  }
  if (!Object.hasOwn(PLAN_CATALOGUE, input.plan)) throw failure("VALIDATION_FAILED", "plan");
  const retentionDays = PLAN_CATALOGUE[input.plan].limits.evidenceRetentionDays;
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);

  return client.$transaction(async (tx) => {
    const candidates = await tx.evidenceRun.findMany({
      orderBy: [{ generatedAt: "asc" }, { id: "asc" }],
      select: { id: true, runId: true },
      take: batchSize,
      where: { generatedAt: { lt: cutoff }, workspaceId: input.workspaceId },
    });
    const ids = candidates.map(({ id }) => id);
    const findingsDeleted = ids.length === 0 ? 0 : await tx.finding.count({
      where: { evidenceRunId: { in: ids }, workspaceId: input.workspaceId },
    });
    const runsDeleted = ids.length === 0 ? 0 : (await tx.evidenceRun.deleteMany({
      where: { id: { in: ids }, workspaceId: input.workspaceId },
    })).count;
    if (runsDeleted !== ids.length) throw failure("CONFLICT", "retention_race");
    await createAuditRepository(tx).append({
      actionCode: "evidence.retention.completed",
      actor: { kind: "system", reference: "evidence-retention" },
      correlationId: input.correlationId,
      description: "Expired evidence retention batch completed.",
      metadata: {
        batchSize,
        cutoff: cutoff.toISOString(),
        findingsDeleted,
        retentionDays,
        runsDeleted,
      },
      subjectId: input.workspaceId,
      subjectType: "evidence-retention",
      workspaceOpaqueId: input.workspaceId,
    });
    return Object.freeze({ cutoff, findingsDeleted, runsDeleted });
  }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 10_000 });
}

async function storeInTransaction(
  tx: TransactionClient,
  input: StoreEvidenceRunInput,
  document: RepositoryEvidence,
): Promise<StoreEvidenceRunResult> {
  const existing = await tx.evidenceRun.findUnique({
    select: { integrityDigest: true },
    where: { workspaceId_runId: { runId: document.runId, workspaceId: input.workspaceId } },
  });
  if (existing !== null) return resolveDuplicate(existing, document);

  const run = await tx.evidenceRun.create({
    data: {
      attestationState: input.attestationState,
      correlationId: input.correlationId,
      durationMs: document.result.durationMs,
      errorCount: document.result.errors,
      exceptedCount: document.result.excepted,
      exceptionBundleDigest: document.exceptionBundleDigest,
      filesScanned: document.result.filesScanned,
      generatedAt: new Date(document.generatedAt),
      id: generateUuidV7(),
      integrityDigest: document.integrity.digest,
      manifestDigest: document.subject.manifestDigest,
      policyDigest: document.policy.digest,
      repositoryLabel: document.subject.repository,
      revisionLabel: document.subject.revision,
      runId: document.runId,
      signatureKeyId: document.signature?.keyId ?? null,
      signatureValue: document.signature?.value ?? null,
      status: document.result.status,
      submitterId: input.submitterId,
      toolVersion: document.tool.version,
      warningCount: document.result.warnings,
      workspaceId: input.workspaceId,
    },
    select: { id: true },
  });
  if (document.findings.length > 0) {
    await tx.finding.createMany({
      data: document.findings.map((finding) => ({
        endColumn: finding.location.endColumn,
        endLine: finding.location.endLine,
        evidenceRunId: run.id,
        exceptionRequestId: finding.exceptionId,
        findingId: finding.id,
        fingerprint: finding.fingerprint,
        id: generateUuidV7(),
        level: finding.level,
        message: finding.message,
        messageCode: finding.messageCode,
        path: finding.path,
        ruleId: finding.ruleId,
        startColumn: finding.location.startColumn,
        startLine: finding.location.startLine,
        subject: finding.subject,
        workspaceId: input.workspaceId,
      })),
    });
  }
  await createAuditRepository(tx).append({
    actionCode: "evidence.recorded",
    actor: { kind: "user", userId: input.submitterId },
    correlationId: input.correlationId,
    description: "Repository evidence recorded.",
    metadata: {
      attestationState: input.attestationState,
      findingCount: document.findings.length,
      integrityDigest: document.integrity.digest,
      status: document.result.status,
    },
    subjectId: document.runId,
    subjectType: "evidence-run",
    workspaceOpaqueId: input.workspaceId,
  });
  return storedResult(true, document);
}

function resolveDuplicate(existing: StoredDuplicate, document: RepositoryEvidence): StoreEvidenceRunResult {
  if (existing.integrityDigest !== document.integrity.digest) throw failure("CONFLICT", "run_digest");
  return storedResult(false, document);
}

function storedResult(created: boolean, document: RepositoryEvidence): StoreEvidenceRunResult {
  return Object.freeze({ created, integrityDigest: document.integrity.digest, runId: document.runId });
}

function toRunReview(row: RunReviewRow): EvidenceRunReview {
  return Object.freeze({
    attestationState: row.attestationState,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
    durationMs: row.durationMs,
    errorCount: row.errorCount,
    evidenceKind: "local",
    exceptedCount: row.exceptedCount,
    exceptionBundleDigest: row.exceptionBundleDigest,
    filesScanned: row.filesScanned,
    generatedAt: row.generatedAt,
    integrityDigest: row.integrityDigest,
    manifestDigest: row.manifestDigest,
    policyDigest: row.policyDigest,
    qualification: "not-release-qualified",
    repositoryLabel: row.repositoryLabel,
    revisionLabel: row.revisionLabel,
    runId: row.runId,
    signatureKeyId: row.signatureKeyId,
    status: row.status,
    submitterId: row.submitterId,
    toolVersion: row.toolVersion,
    warningCount: row.warningCount,
  });
}

function toFindingReview(row: FindingReviewRow): EvidenceFindingReview {
  return Object.freeze({
    createdAt: row.createdAt,
    exceptionId: row.exceptionRequestId,
    exceptionState: row.exceptionRequestId === null ? "unexcepted" : "excepted",
    findingId: row.findingId,
    fingerprint: row.fingerprint,
    level: row.level,
    location: Object.freeze({
      endColumn: row.endColumn,
      endLine: row.endLine,
      startColumn: row.startColumn,
      startLine: row.startLine,
    }),
    message: row.message,
    messageCode: row.messageCode,
    path: row.path,
    ruleId: row.ruleId,
    runId: row.evidenceRun.runId,
    subject: row.subject,
  });
}

function pageFromRows<Row extends Readonly<{ id: string }>, Value>(
  rows: readonly Row[],
  limit: number,
  timestamp: (row: Row) => Date,
  transform: (row: Row) => Value,
): EvidencePage<Value> {
  const included = rows.slice(0, limit);
  const last = rows.length > limit ? included.at(-1) : undefined;
  return Object.freeze({
    items: Object.freeze(included.map(transform)),
    nextCursor: last === undefined ? null : encodeCursor({ id: last.id, timestamp: timestamp(last) }),
  });
}

function requiredPagination(limit: number | undefined, cursor: string | undefined): Readonly<{ cursor?: string; limit: number }> {
  const parsed = parsePagination({ limit, cursor });
  if (!parsed.ok) throw failure("VALIDATION_FAILED", String(parsed.error.details?.field ?? "pagination"));
  return parsed.value;
}

function encodeCursor(cursor: TimestampCursor): string {
  return Buffer.from(JSON.stringify([cursor.timestamp.toISOString(), cursor.id]), "utf8").toString("base64url");
}

function decodeCursor(value: string): TimestampCursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== "string" || !isUuidV7(decoded[1])) {
      throw new TypeError("invalid cursor shape");
    }
    const timestamp = new Date(decoded[0]);
    if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== decoded[0]) throw new TypeError("invalid cursor time");
    return Object.freeze({ id: decoded[1], timestamp });
  } catch {
    throw failure("VALIDATION_FAILED", "cursor");
  }
}

function validateActorContext(input: StoreEvidenceRunInput): void {
  ensureWorkspace(input.workspaceId);
  if (!isUuidV7(input.submitterId)) throw failure("VALIDATION_FAILED", "submitterId");
  if (!isCorrelationId(input.correlationId)) throw failure("VALIDATION_FAILED", "correlationId");
}

function validateRunFilters(input: EvidenceRunFilters): void {
  if (input.policyDigest !== undefined && !isSha256Digest(input.policyDigest)) throw failure("VALIDATION_FAILED", "policyDigest");
  if (input.repositoryLabel !== undefined && (input.repositoryLabel.length < 1 || input.repositoryLabel.length > 200)) throw failure("VALIDATION_FAILED", "repositoryLabel");
  if (input.submitterId !== undefined && !isUuidV7(input.submitterId)) throw failure("VALIDATION_FAILED", "submitterId");
  if (input.generatedFrom !== undefined && !Number.isFinite(input.generatedFrom.getTime())) throw failure("VALIDATION_FAILED", "generatedFrom");
  if (input.generatedTo !== undefined && !Number.isFinite(input.generatedTo.getTime())) throw failure("VALIDATION_FAILED", "generatedTo");
  if (input.generatedFrom !== undefined && input.generatedTo !== undefined && input.generatedFrom > input.generatedTo) {
    throw failure("VALIDATION_FAILED", "generatedRange");
  }
}

function validateFindingFilters(input: EvidenceFindingFilters): void {
  if (input.runId !== undefined && !isUuidV7(input.runId)) throw failure("VALIDATION_FAILED", "runId");
  if (input.ruleId !== undefined && (input.ruleId.length < 3 || input.ruleId.length > 80)) throw failure("VALIDATION_FAILED", "ruleId");
  if (input.path !== undefined && (input.path.length < 1 || input.path.length > 1_000)) throw failure("VALIDATION_FAILED", "path");
}

function ensureWorkspace(workspaceId: string): void {
  if (!isUuidV7(workspaceId)) throw failure("VALIDATION_FAILED", "workspaceId");
}

function isEvidenceRunUniqueConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; constraint?: unknown; meta?: { constraint?: unknown; target?: unknown } };
  if (candidate.code !== "P2002") return false;
  const target = candidate.meta?.target ?? candidate.meta?.constraint ?? candidate.constraint;
  if (target === "evidence_run_workspace_run_key") return true;
  return Array.isArray(target) && target.includes("workspaceId") && target.includes("runId");
}

function failure(code: string, reason: string): Error {
  return new Error(`${code}:${reason}`);
}
