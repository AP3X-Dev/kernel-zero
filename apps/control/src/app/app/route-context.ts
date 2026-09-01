import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import type { Capability } from "@kernel-zero/domain";

import { loadApplicationWorkspace } from "../../server/application/workspace-view";
import { requireCapability } from "../../server/authorization/workspace";
import { getRuntime } from "../../server/identity/runtime";

export async function requireWorkspaceRoute(capability: Capability, callback: string) {
  const runtime = getRuntime();
  const session = await runtime.auth.api.getSession({ headers: await headers() });
  if (session === null) redirect(`/access/sign-in?callback=${encodeURIComponent(callback)}`);
  const selectedWorkspaceId = "selectedWorkspaceId" in session.session
    && typeof session.session.selectedWorkspaceId === "string"
    ? session.session.selectedWorkspaceId
    : null;
  const context = await loadApplicationWorkspace(runtime.prisma, session.user.id, selectedWorkspaceId);
  if (context === null) redirect("/setup/workspace");
  const authority = {
    capabilityDocument: context.membership.roleProfile?.capabilityDocument ?? null,
    isOwner: context.membership.isOwner,
  };
  if (requireCapability(authority, capability) !== null) notFound();
  return { authority, context, runtime, session };
}
