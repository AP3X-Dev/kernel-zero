import "server-only";

import { PLAN_NAMES, quotaLimit, type PlanName, type QuotaKey } from "@kernel-zero/domain";
import {
  acceptInvitation,
  createWorkspace,
  listWorkspaceRoster,
  resolveWorkspaceContext,
  type PersistenceClient,
} from "@kernel-zero/persistence";

export type DashboardView = Readonly<{
  activePolicy: Readonly<{ digest: string; name: string; revision: number }> | null;
  expiringExceptions: number;
  latestEvidence: Readonly<{ generatedAt: Date; status: "error" | "fail" | "pass" }> | null;
  openExceptionDecisions: number;
  plan: PlanName;
  quotas: readonly Readonly<{ key: QuotaKey; limit: number | null; reserved: number; used: number }>[];
}>;

export async function acceptWorkspaceInvitation(client: PersistenceClient, input: Readonly<{
  correlationId: string;
  email: string;
  token: string;
  userId: string;
}>) {
  return acceptInvitation(client, input);
}

export async function createApplicationWorkspace(client: PersistenceClient, input: Readonly<{
  correlationId: string;
  logoUrl?: string;
  name: string;
  userId: string;
}>) {
  return createWorkspace(client, input);
}

export async function loadApplicationWorkspace(
  client: PersistenceClient,
  userId: string,
  selectedWorkspaceId: string | null,
) {
  return resolveWorkspaceContext(client, userId, selectedWorkspaceId);
}

export async function loadPeopleView(client: PersistenceClient, workspaceId: string) {
  const [roster, roles] = await Promise.all([
    listWorkspaceRoster(client, workspaceId),
    client.roleProfile.findMany({
      orderBy: { normalizedLabel: "asc" },
      select: { displayLabel: true, id: true },
      where: { quarantineState: "valid", workspaceId },
    }),
  ]);
  return Object.freeze({ roles, roster });
}

export async function loadDashboardView(
  client: PersistenceClient,
  workspaceId: string,
  now = new Date(),
): Promise<DashboardView> {
  const month = now.toISOString().slice(0, 7);
  const expiringBefore = new Date(now.getTime() + 7 * 86_400_000);
  const [activePolicy, latestEvidence, openExceptionDecisions, expiringExceptions, counters, subscription] = await Promise.all([
    client.policyPack.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { activeRevision: { select: { digest: true, revision: true } }, displayName: true },
      where: { activeRevisionId: { not: null }, lifecycleState: "active", workspaceId },
    }),
    client.evidenceRun.findFirst({
      orderBy: [{ generatedAt: "desc" }, { id: "desc" }],
      select: { generatedAt: true, status: true },
      where: { workspaceId },
    }),
    client.exceptionRequest.count({ where: { decisionState: "pending", workspaceId } }),
    client.exceptionRequest.count({
      where: {
        decisionState: "approved",
        revokedAt: null,
        validUntil: { gt: now, lte: expiringBefore },
        workspaceId,
      },
    }),
    client.quotaCounter.findMany({
      orderBy: { quotaKey: "asc" },
      select: { quotaKey: true, reserved: true, used: true },
      where: { OR: [{ periodKey: "lifetime" }, { periodKey: month }], workspaceId },
    }),
    client.subscriptionProjection.findUnique({ select: { plan: true }, where: { workspaceId } }),
  ]);
  const plan = subscription !== null && PLAN_NAMES.some((candidate) => candidate === subscription.plan)
    ? subscription.plan as PlanName
    : "Open";
  const quotaKeys: readonly QuotaKey[] = ["active_policy_packs", "evidence_runs", "occupied_seats"];
  const byKey = new Map(counters.map((counter) => [counter.quotaKey, counter]));
  return Object.freeze({
    activePolicy: activePolicy?.activeRevision?.digest === null || activePolicy?.activeRevision?.digest === undefined
      ? null
      : Object.freeze({ digest: activePolicy.activeRevision.digest, name: activePolicy.displayName, revision: activePolicy.activeRevision.revision }),
    expiringExceptions,
    latestEvidence,
    openExceptionDecisions,
    plan,
    quotas: Object.freeze(quotaKeys.map((key) => Object.freeze({
      key,
      limit: quotaLimit(plan, key),
      reserved: byKey.get(key)?.reserved ?? 0,
      used: byKey.get(key)?.used ?? 0,
    }))),
  });
}
