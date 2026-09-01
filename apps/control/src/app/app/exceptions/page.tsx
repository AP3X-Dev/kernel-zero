import { loadExceptionsView } from "../../../server/application/governance-view";
import { EmptyState, PageHeading, Status } from "../ui-components";
import { requireWorkspaceRoute } from "../route-context";

export const dynamic = "force-dynamic";

export default async function ExceptionsPage() {
  const { context, runtime } = await requireWorkspaceRoute("exception.read", "/app/exceptions");
  const exceptions = await loadExceptionsView(runtime.prisma, context.workspace.id);
  const now = new Date();
  const expiringBefore = new Date(now.getTime() + 7 * 86_400_000);
  const awaiting = exceptions.filter((request) => request.decisionState === "pending").length;
  const expiring = exceptions.filter((request) => request.decisionState === "approved" && request.revokedAt === null && request.validUntil > now && request.validUntil <= expiringBefore).length;
  return (
    <main className="app-main" id="main-content">
      <PageHeading description="Requests are bound to one policy digest, rule, finding fingerprint, and expiry.">Exceptions</PageHeading>
      <section className="card-grid" aria-label="Exception summary">
        <article className="card"><p className="metric-label">Awaiting decision</p><p className="metric-value">{awaiting}</p><Status tone={awaiting === 0 ? "positive" : "warning"}>{awaiting === 0 ? "No decision backlog" : "Independent review required"}</Status></article>
        <article className="card"><p className="metric-label">Expiring soon</p><p className="metric-value">{expiring}</p><Status tone={expiring === 0 ? "positive" : "warning"}>{expiring === 0 ? "None in seven days" : "Review before expiry"}</Status></article>
      </section>
      {exceptions.length === 0 ? <EmptyState title="No exception requests">Exception requests will appear after a finding is bound to a policy digest and submitted for independent review.</EmptyState> : (
        <ul aria-label="Exception requests" className="row-list">
          {exceptions.map((request) => (
            <li className="row-card" key={request.id}>
              <dl><dt>Rule</dt><dd>{request.ruleId}<br /><span className="muted">{request.findingFingerprint}</span></dd></dl>
              <dl><dt>Decision</dt><dd><Status tone={request.decisionState === "approved" && request.revokedAt === null ? "positive" : request.decisionState === "pending" ? "warning" : "neutral"}>{request.revokedAt === null ? request.decisionState : "revoked"}</Status></dd></dl>
              <dl><dt>Valid until</dt><dd>{request.validUntil.toLocaleString("en-US", { timeZone: "UTC" })} UTC<br /><span className="muted">Policy {request.policyDigest}</span></dd></dl>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
