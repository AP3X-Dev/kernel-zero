import { resolveRequestContext } from "../../../../../server/authorization/request-context";
import { EvidenceIngressError } from "../../../../../server/evidence/errors";
import type { EvidenceSubmissionResult } from "../../../../../server/evidence/evidence-service";
import { EvidenceService } from "../../../../../server/evidence/evidence-service";
import { createEvidenceRepository } from "../../../../../server/evidence/persistence-adapter";
import { readEvidenceRequest } from "../../../../../server/evidence/transport";
import { getRuntime } from "../../../../../server/runtime";

export type EvidenceRouteContext = Readonly<{
  correlationId: string;
  workspaceId: string;
}>;

export type EvidenceRouteDependencies = Readonly<{
  resolveSubmission: (request: Request) => Promise<EvidenceRouteContext | null>;
  service: Readonly<{
    submit: (input: Readonly<{
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
  resolveSubmission(request) {
    const resolution = resolveRequestContext(request, getRuntime().config);
    return Promise.resolve(resolution.kind === "ok" ? resolution.context : null);
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
