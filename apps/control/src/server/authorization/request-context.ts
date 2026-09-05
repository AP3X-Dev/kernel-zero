import "server-only";

import { resolveCorrelationId } from "@kernel-zero/domain";

import { loadApplicationWorkspace } from "../application/workspace-view";
import { getRuntime } from "../identity/runtime";
import type { WorkspaceAuthoritySource } from "./workspace";

export type RequestActor = WorkspaceAuthoritySource & Readonly<{ userId: string }>;

export type RequestContext = Readonly<{
  actor: RequestActor;
  correlationId: string;
  workspaceId: string;
}>;

export type RequestContextResolution =
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "workspace-required" }>
  | Readonly<{ context: RequestContext; kind: "ok" }>;

/** One place turns an API request into an actor and workspace; routes never touch sessions or persistence themselves. */
export async function resolveRequestContext(request: Request): Promise<RequestContextResolution> {
  const runtime = getRuntime();
  const session = await runtime.auth.api.getSession({ headers: request.headers });
  if (session === null) return { kind: "unauthenticated" };
  const selected = "selectedWorkspaceId" in session.session && typeof session.session.selectedWorkspaceId === "string"
    ? session.session.selectedWorkspaceId
    : null;
  const context = await loadApplicationWorkspace(runtime.prisma, session.user.id, selected);
  if (context === null) return { kind: "workspace-required" };
  return {
    context: {
      actor: {
        capabilityDocument: context.membership.roleProfile?.capabilityDocument ?? null,
        isOwner: context.membership.isOwner,
        userId: session.user.id,
      },
      correlationId: resolveCorrelationId(request.headers.get("x-correlation-id")).id,
      workspaceId: context.workspace.id,
    },
    kind: "ok",
  };
}
