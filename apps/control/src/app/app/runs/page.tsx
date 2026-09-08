import { loadRunsView } from "../../../server/application/governance-view";
import { EmptyState, PageHeading, Status } from "../ui-components";
import { workspaceRoute } from "../route-context";

type RunsPageProps = Readonly<{ searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>> }>;

export const dynamic = "force-dynamic";

export default async function RunsPage({ searchParams }: RunsPageProps) {
  const { runtime, workspaceId } = workspaceRoute();
  const query = await searchParams;
  const rawStatus = typeof query.status === "string" ? query.status : undefined;
  const status = rawStatus === "error" || rawStatus === "fail" || rawStatus === "pass" ? rawStatus : undefined;
  const runs = await loadRunsView(runtime.prisma, workspaceId, status);
  return (
    <main className="app-main" id="main-content">
      <PageHeading description="Review deterministic repository results without uploading repository source.">Verification runs</PageHeading>
      <section className="panel">
        <form method="get">
          <label htmlFor="run-status">Filter by result</label>
          <select id="run-status" name="status">
            <option value="">All results</option>
            <option value="pass">Passed</option>
            <option value="fail">Failed</option>
          </select>
          <button type="submit">Apply filter</button>
        </form>
      </section>
      {runs.length === 0 ? (
        <EmptyState title="No matching verification runs">Submit validator evidence through the token-protected API, or change the result filter.</EmptyState>
      ) : (
        <ul aria-label="Verification runs" className="row-list">
          {runs.map((run) => (
            <li className="row-card" key={run.runId}>
              <dl><dt>Repository</dt><dd><a href={`/app/runs/${run.runId}`}>{run.repositoryLabel}</a><br /><span className="muted">{run.revisionLabel}</span></dd></dl>
              <dl><dt>Result</dt><dd><Status tone={run.status === "pass" ? "positive" : "danger"}>{run.status}</Status><br />{String(run.errorCount)} errors · {String(run.warningCount)} warnings</dd></dl>
              <dl><dt>Evidence</dt><dd>{run.attestationState}<br /><span className="muted">{run.generatedAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC</span></dd></dl>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
