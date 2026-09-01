import { ConfirmAction } from "../../confirm-action";
import { PageHeading } from "../../ui-components";
import { requireWorkspaceRoute } from "../../route-context";

export const dynamic = "force-dynamic";

export default async function WorkspaceSettingsPage() {
  const { context } = await requireWorkspaceRoute("workspace.read", "/app/settings/workspace");
  return (
    <main className="app-main" id="main-content">
      <PageHeading description="Workspace identity and ownership-sensitive actions stay inside the active tenant boundary.">Workspace settings</PageHeading>
      <section className="panel">
        <h2>Workspace profile</h2>
        <dl>
          <dt>Name</dt><dd>{context.workspace.name}</dd>
          <dt>Identifier</dt><dd>{context.workspace.id}</dd>
        </dl>
        <p className="muted">Profile mutation is unavailable until its governed server action is connected.</p>
      </section>
      {context.membership.isOwner ? (
        <section className="panel">
          <h2>Destructive actions</h2>
          <p>Deleting a workspace requires explicit confirmation and a separately connected governed server action.</p>
          <ConfirmAction description="This control demonstrates the required confirmation and focus behavior. It does not delete data until the governed action is connected." label="Delete workspace" />
        </section>
      ) : null}
    </main>
  );
}
