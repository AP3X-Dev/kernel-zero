import { notFound } from "next/navigation";

import { loadPolicyDetailView } from "../../../../server/application/governance-view";
import { PageHeading, Status } from "../../ui-components";
import { workspaceRoute } from "../../route-context";

type PolicyPageProps = Readonly<{ params: Promise<Readonly<{ pack: string }>> }>;

export const dynamic = "force-dynamic";

export default async function PolicyPage({ params }: PolicyPageProps) {
  const { pack } = await params;
  const { runtime, workspaceId } = workspaceRoute();
  const policy = await loadPolicyDetailView(runtime.prisma, workspaceId, pack);
  if (policy === null) notFound();
  return (
    <main className="app-main" id="main-content">
      <PageHeading description={policy.description}>{policy.displayName}</PageHeading>
      <section className="panel stack">
        <div><p className="metric-label">Pack identifier</p><p className="metric-value">{policy.slug}</p></div>
        <Status tone={policy.lifecycleState === "active" ? "positive" : "neutral"}>{policy.lifecycleState}</Status>
        <ol className="row-list" aria-label="Policy rules">
          {policy.document === null ? <li>No valid repository policy document is available for the latest revision.</li> : policy.rules.map((rule) => (
            <li className="row-card" key={rule.id}>
              <dl><dt>Rule</dt><dd>{rule.title}<br /><span className="muted">{rule.remediation}</span></dd></dl>
              <dl><dt>Check</dt><dd>{rule.checkKind} · {rule.level}</dd></dl>
              <dl><dt>Action</dt><dd>Read only</dd></dl>
            </li>
          ))}
        </ol>
        <details>
          <summary>Advanced JSON and canonical digest</summary>
          <pre>{policy.document === null ? "Policy document failed strict validation." : JSON.stringify(policy.document, null, 2)}</pre>
        </details>
      </section>
      <section className="panel">
        <h2>Revision history</h2>
        <ul className="row-list">
          {policy.revisions.map((revision) => (
            <li className="row-card" key={revision.revision}>
              <dl><dt>Revision</dt><dd>{revision.revision}</dd></dl>
              <dl><dt>State</dt><dd>{revision.state}</dd></dl>
              <dl><dt>Digest</dt><dd>{revision.digest ?? "Not approved"}</dd></dl>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
