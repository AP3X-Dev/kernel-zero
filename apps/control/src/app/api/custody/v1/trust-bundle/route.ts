import { WORKSPACE_TRUST_BUNDLE_MEDIA_TYPE, type WorkspaceTrustBundle } from "@kernel-zero/contracts";
import { canonicalJson } from "@kernel-zero/domain";

import { loadPolicyCustodyView } from "../../../../../server/application/governance-view";
import { resolveRequestContext, type RequestActor, type RequestContextResolution } from "../../../../../server/authorization/request-context";
import { requireCapability } from "../../../../../server/authorization/workspace";
import { getRuntime } from "../../../../../server/identity/runtime";

export type TrustBundleRouteDependencies = Readonly<{
  loadBundle: (workspaceId: string) => Promise<WorkspaceTrustBundle | null>;
  resolveContext: (request: Request) => Promise<RequestContextResolution>;
}>;

/**
 * Read-only export of the workspace trust bundle for CI orchestration. The validator itself never
 * calls this: orchestration fetches the bundle before entering the offline validation boundary and
 * hands it over as `--workspace-trust`.
 */
export function createTrustBundleGetHandler(dependencies: TrustBundleRouteDependencies): (request: Request) => Promise<Response> {
  return async (request) => {
    let correlationId = "unavailable";
    try {
      const resolution = await dependencies.resolveContext(request);
      if (resolution.kind === "unauthenticated") return errorResponse(401, "UNAUTHENTICATED", "Authentication is required.", correlationId);
      if (resolution.kind === "workspace-required") return errorResponse(403, "FORBIDDEN", "A workspace membership is required.", correlationId);
      correlationId = resolution.context.correlationId;
      if (requireCapability(resolution.context.actor, "policy.read") !== null) {
        return errorResponse(403, "FORBIDDEN", "You are not allowed to read the trust bundle.", correlationId);
      }
      const bundle = await dependencies.loadBundle(resolution.context.workspaceId);
      if (bundle === null) return errorResponse(404, "NOT_FOUND", "This workspace has no policy authority keys.", correlationId);
      return new Response(`${canonicalJson(bundle)}\n`, {
        headers: { "cache-control": "no-store", "content-type": WORKSPACE_TRUST_BUNDLE_MEDIA_TYPE, "x-correlation-id": correlationId },
        status: 200,
      });
    } catch {
      return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.", correlationId);
    }
  };
}

const productionDependencies: TrustBundleRouteDependencies = Object.freeze({
  async loadBundle(workspaceId: string) {
    return (await loadPolicyCustodyView(getRuntime().prisma, workspaceId)).bundle;
  },
  resolveContext: resolveRequestContext,
});

export const GET = createTrustBundleGetHandler(productionDependencies);

export type { RequestActor };

function errorResponse(status: number, code: string, message: string, correlationId: string): Response {
  return Response.json({ error: { code, correlationId, message } }, { status });
}
