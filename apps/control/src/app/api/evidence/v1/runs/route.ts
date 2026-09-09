import { resolveRequestContext, type RequestContext } from "../../../../../server/authorization/request-context";
import { EvidenceIngressError } from "../../../../../server/evidence/errors";
import { EvidenceService } from "../../../../../server/evidence/evidence-service";
import { createEvidenceRepository } from "../../../../../server/evidence/persistence-adapter";
import { readEvidenceRequest } from "../../../../../server/evidence/transport";
import { getRuntime } from "../../../../../server/runtime";

export async function POST(request: Request): Promise<Response> {
  const dependencies = evidenceDependencies();
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
}

type EvidenceDependencies = Readonly<{
  resolveSubmission: (request: Request) => Promise<RequestContext | null>;
  service: EvidenceService;
}>;

/** Production wiring behind one no-argument accessor, so the exported handler is provable on its own. */
function evidenceDependencies(): EvidenceDependencies {
  const runtime = getRuntime();
  return Object.freeze({
    resolveSubmission(request: Request) {
      const resolution = resolveRequestContext(request, runtime.config);
      return Promise.resolve(resolution.kind === "ok" ? resolution.context : null);
    },
    service: new EvidenceService(createEvidenceRepository(runtime.prisma)),
  });
}

function errorResponse(status: number, code: string, message: string, correlationId: string): Response {
  return Response.json({ error: { code, correlationId, message } }, { status });
}
