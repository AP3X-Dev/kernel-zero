import "server-only";

import type { PersistenceClient } from "@kernel-zero/persistence";

export type DashboardView = Readonly<{
  activePolicy: Readonly<{ digest: string; name: string; revision: number }> | null;
  expiringExceptions: number;
  latestEvidence: Readonly<{ generatedAt: Date; status: "error" | "fail" | "pass" }> | null;
  openExceptionDecisions: number;
}>;

export async function loadDashboardView(
  client: PersistenceClient,
  workspaceId: string,
  now = new Date(),
): Promise<DashboardView> {
  const expiringBefore = new Date(now.getTime() + 7 * 86_400_000);
  const [activePolicy, latestEvidence, openExceptionDecisions, expiringExceptions] = await Promise.all([
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
  ]);
  return Object.freeze({
    activePolicy: activePolicy?.activeRevision?.digest === null || activePolicy?.activeRevision?.digest === undefined
      ? null
      : Object.freeze({ digest: activePolicy.activeRevision.digest, name: activePolicy.displayName, revision: activePolicy.activeRevision.revision }),
    expiringExceptions,
    latestEvidence,
    openExceptionDecisions,
  });
}
