import { resolveCorrelationId } from "@kernel-zero/domain";

import { loadApplicationWorkspace } from "../../../../../server/application/workspace-view";
import { EvidenceIngressError } from "../../../../../server/evidence/errors";
import type { EvidenceActor, EvidenceSubmissionResult } from "../../../../../server/evidence/evidence-service";
import { EvidenceService } from "../../../../../server/evidence/evidence-service";
import { createEvidenceRepository } from "../../../../../server/evidence/persistence-adapter";
import { readEvidenceRequest } from "../../../../../server/evidence/transport";
import { getRuntime } from "../../../../../server/identity/runtime";

export type EvidenceRouteContext = Readonly<{
  actor: EvidenceActor;
  correlationId: string;
  workspaceId: string;
}>;

export type EvidenceRouteDependencies = Readonly<{
  resolveSubmission: (request: Request) => Promise<EvidenceRouteContext | null>;
  service: Readonly<{
    submit: (input: Readonly<{
      actor: EvidenceActor;
      correlationId: string;
      document: unknown;
      workspaceId: string;
    }>) => Promise<EvidenceSubmissionResult>;
  }>;
}>;

export function createEvidencePostHandler(dependencies: EvidenceRouteDependencies): (request: Request) => Promise<Response> {
  return async (request) => {
    let correlationId = "unavailable";
    try {
      const context = await dependencies.resolveSubmission(request);
      if (context === null) return errorResponse(401, "UNAUTHENTICATED", "Authentication is required.", correlationId);
      correlationId = context.correlationId;
      const document = await readEvidenceRequest(request);
      const result = await dependencies.service.submit({
        actor: context.actor,
        correlationId: context.correlationId,
        document,
        workspaceId: context.workspaceId,
      });
      return Response.json(result, { status: result.kind === "created" ? 201 : 200 });
    } catch (error) {
      if (error instanceof EvidenceIngressError) return errorResponse(error.status, error.code, error.message, correlationId);
      return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.", correlationId);
    }
  };
}

const productionDependencies: EvidenceRouteDependencies = Object.freeze({
  async resolveSubmission(request) {
    const runtime = getRuntime();
    const session = await runtime.auth.api.getSession({ headers: request.headers });
    if (session === null) return null;
    const selected = "selectedWorkspaceId" in session.session && typeof session.session.selectedWorkspaceId === "string"
      ? session.session.selectedWorkspaceId
      : null;
    const context = await loadApplicationWorkspace(runtime.prisma, session.user.id, selected);
    if (context === null) throw new EvidenceIngressError(403, "WORKSPACE_REQUIRED", "workspace_required");
    return {
      actor: {
        capabilityDocument: context.membership.roleProfile?.capabilityDocument ?? null,
        isOwner: context.membership.isOwner,
        userId: session.user.id,
      },
      correlationId: resolveCorrelationId(request.headers.get("x-correlation-id")).id,
      workspaceId: context.workspace.id,
    };
  },
  service: Object.freeze({
    submit(input: Parameters<EvidenceRouteDependencies["service"]["submit"]>[0]) {
      const runtime = getRuntime();
      return new EvidenceService(createEvidenceRepository(runtime.prisma)).submit(input);
    },
  }),
});

export const POST = createEvidencePostHandler(productionDependencies);

function errorResponse(status: number, code: string, message: string, correlationId: string): Response {
  return Response.json({ error: { code, correlationId, message } }, { status });
}
