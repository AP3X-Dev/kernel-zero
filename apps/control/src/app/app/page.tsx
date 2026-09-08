import { loadDashboardView } from "../../server/application/dashboard-view";
import { PageHeading, Status } from "./ui-components";
import { workspaceRoute } from "./route-context";

export const dynamic = "force-dynamic";

export default async function ApplicationHomePage() {
  const { runtime, workspaceId } = workspaceRoute();
  const dashboard = await loadDashboardView(runtime.prisma, workspaceId);
  const nextAction = dashboard.activePolicy === null
    ? { href: "/app/policies", label: "Review policies", message: "Create, approve, and activate a policy before validating a repository." }
    : dashboard.latestEvidence === null
      ? { href: "/app/runs", label: "Review verification runs", message: "Run the local deterministic validator and submit its evidence." }
      : dashboard.latestEvidence.status !== "pass"
        ? { href: "/app/runs", label: "Review verification runs", message: "Review the latest non-passing run and decide the next governed action." }
        : dashboard.openExceptionDecisions > 0
          ? { href: "/app/exceptions", label: "Review exceptions", message: "Resolve exception requests that are awaiting a decision." }
          : { href: "/app/runs", label: "Review verification runs", message: "The latest run passed. Review its evidence and attestation details." };
  return (
    <main className="app-main" id="main-content">
      <PageHeading description="A concise view of policy readiness, verification evidence, and exceptions.">
        Overview
      </PageHeading>
      <section aria-label="Workspace status" className="card-grid">
        <article className="card">
          <p className="metric-label">Active policy digest</p>
          <p className="metric-value">{dashboard.activePolicy?.digest ?? "None"}</p>
          {dashboard.activePolicy === null
            ? <Status tone="warning">No active policy</Status>
            : <Status tone="positive">{dashboard.activePolicy.name}, revision {dashboard.activePolicy.revision}</Status>}
        </article>
        <article className="card">
          <p className="metric-label">Latest evidence</p>
          <p className="metric-value">{dashboard.latestEvidence?.status.toUpperCase() ?? "None"}</p>
          {dashboard.latestEvidence === null
            ? <Status>No run recorded</Status>
            : <Status tone={dashboard.latestEvidence.status === "pass" ? "positive" : "danger"}>
                Generated {dashboard.latestEvidence.generatedAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC
              </Status>}
        </article>
        <article className="card">
          <p className="metric-label">Open decisions</p>
          <p className="metric-value">{dashboard.openExceptionDecisions}</p>
          <Status tone={dashboard.openExceptionDecisions === 0 ? "positive" : "warning"}>
            {dashboard.openExceptionDecisions === 0 ? "No decision backlog" : "Decision required"}
          </Status>
        </article>
        <article className="card">
          <p className="metric-label">Expiring exceptions</p>
          <p className="metric-value">{dashboard.expiringExceptions}</p>
          <Status tone={dashboard.expiringExceptions === 0 ? "positive" : "warning"}>
            {dashboard.expiringExceptions === 0 ? "None in the next seven days" : "Review before expiry"}
          </Status>
        </article>
      </section>
      <section className="panel">
        <h2>Next action</h2>
        <p className="next-action">{nextAction.message}</p>
        <a className="button-link" href={nextAction.href}>{nextAction.label}</a>
      </section>
    </main>
  );
}
