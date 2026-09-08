import { notFound } from "next/navigation";

import { loadRunDetailView } from "../../../../server/application/governance-view";
import { PageHeading, Status } from "../../ui-components";
import { workspaceRoute } from "../../route-context";

type RunPageProps = Readonly<{
  params: Promise<Readonly<{ runId: string }>>;
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

export const dynamic = "force-dynamic";

export default async function RunPage({ params, searchParams }: RunPageProps) {
  const { runId } = await params;
  const search = await searchParams;
  const query = typeof search.query === "string" ? search.query.trim().toLowerCase().slice(0, 200) : "";
  const { runtime, workspaceId } = workspaceRoute();
  const detail = await loadRunDetailView(runtime.prisma, workspaceId, runId);
  if (detail === null) notFound();
  const { findings, run } = detail;
  const visibleFindings = query === "" ? findings : findings.filter((finding) =>
    [finding.path, finding.ruleId, finding.message, finding.messageCode].some((value) => value.toLowerCase().includes(query)),
  );
  return (
    <main className="app-main" id="main-content">
      <PageHeading description="Summary first, findings second, integrity and attestation metadata last.">Verification run</PageHeading>
      <section className="card-grid" aria-label="Run summary">
        <article className="card"><p className="metric-label">Run</p><p className="metric-value">{runId}</p></article>
        <article className="card"><p className="metric-label">Result</p><Status tone={run.status === "pass" ? "positive" : "danger"}>{run.status}</Status></article>
        <article className="card"><p className="metric-label">Evidence label</p><Status tone={run.attestationState === "attested" ? "positive" : "neutral"}>{run.attestationState}</Status></article>
      </section>
      <section className="panel">
        <h2>Findings</h2>
        <form method="get">
          <label htmlFor="finding-search">Filter findings</label>
          <input defaultValue={query} id="finding-search" maxLength={200} name="query" placeholder="Path, rule, or message" type="search" />
          <button type="submit">Apply filter</button>
        </form>
        {visibleFindings.length === 0 ? <p className="muted">No findings match this filter.</p> : (
          <ul className="row-list">
            {visibleFindings.map((finding) => (
              <li className="row-card" key={finding.findingId}>
                <dl><dt>Location</dt><dd>{finding.path}:{String(finding.location.startLine)}:{String(finding.location.startColumn)}</dd></dl>
                <dl><dt>Rule</dt><dd>{finding.ruleId}<br /><span className="muted">{finding.messageCode}</span></dd></dl>
                <dl><dt>Finding</dt><dd><Status tone={finding.level === "error" ? "danger" : "warning"}>{finding.level}</Status><br />{finding.message}</dd></dl>
              </li>
            ))}
          </ul>
        )}
        <details>
          <summary>Integrity and attestation metadata</summary>
          <dl>
            <dt>Policy digest</dt><dd>{run.policyDigest}</dd>
            <dt>Manifest digest</dt><dd>{run.manifestDigest}</dd>
            <dt>Evidence digest</dt><dd>{run.integrityDigest}</dd>
            <dt>Qualification</dt><dd>{run.qualification}</dd>
          </dl>
        </details>
      </section>
    </main>
  );
}
