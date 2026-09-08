import { loadAuditView } from "../../../../server/application/governance-view";
import { EmptyState, PageHeading } from "../../ui-components";
import { workspaceRoute } from "../../route-context";

type AuditPageProps = Readonly<{ searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>> }>;

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const { runtime, workspaceId } = workspaceRoute();
  const search = await searchParams;
  const query = typeof search.query === "string" ? search.query.slice(0, 200) : undefined;
  const records = await loadAuditView(runtime.prisma, workspaceId, query);
  return (
    <main className="app-main" id="main-content">
      <PageHeading description="Safe audit projections omit forensic address and user-agent fields.">Audit history</PageHeading>
      <section className="panel">
        <form method="get">
          <label htmlFor="audit-search">Search audit history</label>
          <input defaultValue={query} id="audit-search" maxLength={200} name="query" placeholder="Action or subject" type="search" />
          <button type="submit">Search</button>
        </form>
      </section>
      {records.length === 0 ? <EmptyState title="No matching audit history">Governed mutations create immutable audit records. Change the search or complete a governed action.</EmptyState> : (
        <ul aria-label="Audit history" className="row-list">
          {records.map((record) => (
            <li className="row-card" key={record.id}>
              <dl><dt>Action</dt><dd>{record.actionCode}<br /><span className="muted">{record.description}</span></dd></dl>
              <dl><dt>Subject</dt><dd>{record.subjectType}<br /><span className="muted">{record.subjectId}</span></dd></dl>
              <dl><dt>Recorded</dt><dd>{record.createdAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC<br /><span className="muted">{record.actorKind === "system" ? record.systemActorRef ?? "system" : "operator"}</span></dd></dl>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
