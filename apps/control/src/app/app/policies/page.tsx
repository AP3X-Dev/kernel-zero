import { loadPoliciesView } from "../../../server/application/governance-view";
import { EmptyState, PageHeading, Status } from "../ui-components";
import { workspaceRoute } from "../route-context";

export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  const { runtime, workspaceId } = workspaceRoute();
  const policies = await loadPoliciesView(runtime.prisma, workspaceId);
  return (
    <main className="app-main" id="main-content">
      <PageHeading
        description="Author ordered deterministic checks, approve them, and activate immutable revisions."
      >Policies</PageHeading>
      {policies.length === 0 ? (
        <EmptyState title="No policies yet">Create the first policy through the governed policy service to begin repository verification.</EmptyState>
      ) : (
        <ul aria-label="Policy packs" className="row-list">
          {policies.map((policy) => (
            <li className="row-card" key={policy.slug}>
              <dl><dt>Policy</dt><dd><a href={`/app/policies/${policy.slug}`}>{policy.displayName}</a><br /><span className="muted">{policy.description}</span></dd></dl>
              <dl><dt>Lifecycle</dt><dd><Status tone={policy.lifecycleState === "active" ? "positive" : "neutral"}>{policy.lifecycleState}</Status></dd></dl>
              <dl><dt>Active revision</dt><dd>{policy.activeRevision === null ? "None" : `${String(policy.activeRevision)} · ${policy.activeDigest ?? "digest unavailable"}`}</dd></dl>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
