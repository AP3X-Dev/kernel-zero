import { resolveCorrelationId } from "@kernel-zero/domain";
import { redirect } from "next/navigation";

import { loadPeopleView } from "../../../server/application/workspace-view";
import { requireCapability } from "../../../server/authorization/workspace";
import { InvitationService } from "../../../server/team/invitation-service";
import { FormSubmit } from "../form-submit";
import { PageHeading } from "../ui-components";
import { requireWorkspaceRoute } from "../route-context";

export const dynamic = "force-dynamic";

async function sessionContext() {
  return requireWorkspaceRoute("member.read", "/app/people");
}

async function inviteAction(formData: FormData): Promise<void> {
  "use server";
  const { context, runtime, session } = await sessionContext();
  const email = formData.get("email");
  const roleProfileId = formData.get("roleProfileId");
  if (typeof email !== "string" || typeof roleProfileId !== "string") return;
  const service = new InvitationService(runtime.prisma, runtime.config, runtime.emailSender);
  await service.issue({
    actor: {
      capabilityDocument: context.membership.roleProfile?.capabilityDocument ?? null,
      email: session.user.email, isOwner: context.membership.isOwner, userId: session.user.id,
    },
    correlationId: resolveCorrelationId(undefined).id, email, roleProfileId, seatLimit: 3,
    workspaceId: context.workspace.id,
  });
  redirect("/app/people");
}

export default async function PeoplePage() {
  const { authority, context, runtime } = await sessionContext();
  const { roles, roster } = await loadPeopleView(runtime.prisma, context.workspace.id);
  const canInvite = requireCapability(authority, "member.invite") === null;
  return (
    <main className="app-main" id="main-content">
      <PageHeading description="Active members and pending invitations share one roster and remain inside this workspace.">People</PageHeading>
      <ul className="row-list" aria-label="Workspace people">{roster.map((entry) => (
        <li className="row-card" key={entry.id}>
          <dl><dt>Email</dt><dd>{entry.email}</dd></dl>
          <dl><dt>Role</dt><dd>{entry.role}</dd></dl>
          <dl><dt>Status</dt><dd>{entry.pending ? "Invited" : "Active"}</dd></dl>
        </li>
      ))}</ul>
      {canInvite ? (
        <form action={inviteAction} className="panel">
          <h2>Invite a teammate</h2>
          <label htmlFor="invite-email">Email</label>
          <input id="invite-email" name="email" required type="email" />
          <label htmlFor="invite-role">Role</label>
          <select id="invite-role" name="roleProfileId" required>
            {roles.map((role) => <option key={role.id} value={role.id}>{role.displayLabel}</option>)}
          </select>
          <FormSubmit pendingLabel="Sending invitation…">Send invitation</FormSubmit>
        </form>
      ) : null}
    </main>
  );
}
