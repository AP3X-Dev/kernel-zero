import "server-only";

import type { PolicyEnvelope } from "@kernel-zero/contracts";
import {
  listEvidenceFindings,
  listEvidenceRuns,
  SAFE_AUDIT_SELECT,
  type EvidenceFindingReview,
  type EvidenceRunReview,
  type PersistenceClient,
  type SafeAuditRecord,
} from "@kernel-zero/persistence";
import { parsePolicyDocument } from "@kernel-zero/profiles";

export type PolicyListItem = Readonly<{
  activeDigest: string | null;
  activeRevision: number | null;
  description: string;
  displayName: string;
  lifecycleState: string;
  slug: string;
  updatedAt: Date;
}>;

export type PolicyDetailRule = Readonly<{
  check: Readonly<{ kind: string }>;
  id: string;
  level: string;
  remediation: string;
  title: string;
}>;

export type PolicyDetailView = Readonly<{
  description: string;
  displayName: string;
  document: PolicyEnvelope | null;
  rules: readonly PolicyDetailRule[];
  lifecycleState: string;
  revisions: readonly Readonly<{
    approvedAt: Date | null;
    createdAt: Date;
    digest: string | null;
    revision: number;
    state: string;
  }>[];
  slug: string;
}>;

export type ExceptionListItem = Readonly<{
  createdAt: Date;
  decidedAt: Date | null;
  decisionState: string;
  findingFingerprint: string;
  id: string;
  policyDigest: string;
  revokedAt: Date | null;
  ruleId: string;
  validUntil: Date;
}>;

export type SubscriptionView = Readonly<{
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  entitlementState: string;
  graceExpiresAt: Date | null;
  plan: string;
  providerStatus: string;
}>;

export type PaymentEventListItem = Readonly<{
  createdAt: Date;
  eventId: string;
  eventType: string;
  projectionResult: string | null;
  provider: string;
  providerCreatedAt: Date;
  quarantineReason: string | null;
  retryCount: number;
  state: string;
}>;

export async function loadPoliciesView(client: PersistenceClient, workspaceId: string): Promise<readonly PolicyListItem[]> {
  const rows = await client.policyPack.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: {
      activeRevision: { select: { digest: true, revision: true } },
      description: true,
      displayName: true,
      lifecycleState: true,
      slug: true,
      updatedAt: true,
    },
    take: 25,
    where: { workspaceId },
  });
  return Object.freeze(rows.map((row) => Object.freeze({
    activeDigest: row.activeRevision?.digest ?? null,
    activeRevision: row.activeRevision?.revision ?? null,
    description: row.description,
    displayName: row.displayName,
    lifecycleState: row.lifecycleState,
    slug: row.slug,
    updatedAt: row.updatedAt,
  })));
}

export async function loadPolicyDetailView(
  client: PersistenceClient,
  workspaceId: string,
  slug: string,
): Promise<PolicyDetailView | null> {
  const row = await client.policyPack.findFirst({
    select: {
      description: true,
      displayName: true,
      lifecycleState: true,
      revisions: {
        orderBy: { revision: "desc" },
        select: { approvedAt: true, canonicalJson: true, createdAt: true, digest: true, revision: true, state: true },
        take: 25,
      },
      slug: true,
    },
    where: { slug, workspaceId },
  });
  if (row === null) return null;
  const latest = row.revisions[0];
  const policy = latest === undefined ? null : parsePolicy(latest.canonicalJson);
  return Object.freeze({
    description: row.description,
    displayName: row.displayName,
    document: policy,
    rules: policy === null ? [] : policyRules(policy),
    lifecycleState: row.lifecycleState,
    revisions: Object.freeze(row.revisions.map((revision) => Object.freeze({
      approvedAt: revision.approvedAt,
      createdAt: revision.createdAt,
      digest: revision.digest,
      revision: revision.revision,
      state: revision.state,
    }))),
    slug: row.slug,
  });
}

export async function loadRunsView(
  client: PersistenceClient,
  workspaceId: string,
  status?: "error" | "fail" | "pass",
): Promise<readonly EvidenceRunReview[]> {
  return (await listEvidenceRuns(client, { limit: 25, ...(status === undefined ? {} : { status }), workspaceId })).items;
}

export async function loadRunDetailView(
  client: PersistenceClient,
  workspaceId: string,
  runId: string,
): Promise<Readonly<{ findings: readonly EvidenceFindingReview[]; run: EvidenceRunReview }> | null> {
  const row = await client.evidenceRun.findFirst({
    select: {
      attestationState: true,
      correlationId: true,
      createdAt: true,
      durationMs: true,
      errorCount: true,
      exceptedCount: true,
      exceptionBundleDigest: true,
      filesScanned: true,
      generatedAt: true,
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
    },
    where: { runId, workspaceId },
  });
  if (row === null) return null;
  const run: EvidenceRunReview = Object.freeze({
    ...row,
    evidenceKind: "local",
    qualification: "not-release-qualified",
  });
  const findings = await listEvidenceFindings(client, { limit: 100, runId, workspaceId });
  return Object.freeze({ findings: findings.items, run });
}

export async function loadExceptionsView(client: PersistenceClient, workspaceId: string): Promise<readonly ExceptionListItem[]> {
  const rows = await client.exceptionRequest.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      createdAt: true,
      decidedAt: true,
      decisionState: true,
      findingFingerprint: true,
      id: true,
      policyDigest: true,
      revokedAt: true,
      ruleId: true,
      validUntil: true,
    },
    take: 50,
    where: { workspaceId },
  });
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

export async function loadSubscriptionView(client: PersistenceClient, workspaceId: string): Promise<SubscriptionView | null> {
  const row = await client.subscriptionProjection.findUnique({
    select: {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: true,
      entitlementState: true,
      graceExpiresAt: true,
      plan: true,
      providerStatus: true,
    },
    where: { workspaceId },
  });
  return row === null ? null : Object.freeze(row);
}

export async function loadAuditView(
  client: PersistenceClient,
  workspaceId: string,
  query?: string,
): Promise<readonly SafeAuditRecord[]> {
  const normalized = query?.trim().slice(0, 200);
  return client.auditRecord.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: SAFE_AUDIT_SELECT,
    take: 50,
    where: {
      workspaceOpaqueId: workspaceId,
      ...(normalized === undefined || normalized === "" ? {} : { OR: [
        { actionCode: { contains: normalized, mode: "insensitive" } },
        { description: { contains: normalized, mode: "insensitive" } },
        { subjectType: { contains: normalized, mode: "insensitive" } },
      ] }),
    },
  });
}

export async function loadPaymentEventsView(
  client: PersistenceClient,
  state?: "applied" | "ignored" | "quarantined" | "received" | "stale",
): Promise<readonly PaymentEventListItem[]> {
  const rows = await client.paymentEventReceipt.findMany({
    orderBy: [{ providerCreatedAt: "desc" }, { id: "desc" }],
    select: {
      createdAt: true,
      eventId: true,
      eventType: true,
      projectionResult: true,
      provider: true,
      providerCreatedAt: true,
      quarantineReason: true,
      retryCount: true,
      state: true,
    },
    take: 50,
    ...(state === undefined ? {} : { where: { state } }),
  });
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

function parsePolicy(value: string): PolicyEnvelope | null {
  try {
    return parsePolicyDocument(JSON.parse(value) as unknown)?.policy ?? null;
  } catch {
    return null;
  }
}

function policyRules(policy: PolicyEnvelope): readonly PolicyDetailRule[] {
  const rules = (policy as { rules?: readonly PolicyDetailRule[] }).rules ?? [];
  return Object.freeze(rules.map((rule) => Object.freeze(rule)));
}
