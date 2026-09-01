import { resolveCorrelationId } from "@kernel-zero/domain";

import {
  BillingConfigurationError,
  BillingSignatureError,
  createRuntimeBillingEventDependencies,
  type BillingEventIngressDependencies,
} from "../../../../server/billing";

export type BillingEventRouteDependencies = BillingEventIngressDependencies;

export function createBillingEventPostHandler(
  dependencies: BillingEventRouteDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const correlation = resolveCorrelationId(request.headers.get("x-correlation-id"));
    if (!dependencies.configured()) return errorResponse(503, "FEATURE_UNAVAILABLE", "Billing is not configured.", correlation.id);
    const signature = request.headers.get("stripe-signature");
    if (signature === null || signature.length === 0) {
      return errorResponse(400, "VALIDATION_FAILED", "The billing event signature is invalid.", correlation.id);
    }
    try {
      const rawBody = new Uint8Array(await request.arrayBuffer());
      const parsed = await dependencies.parseSignedEvent(rawBody, signature);
      const result = await dependencies.persist({ ...parsed, correlationId: correlation.id });
      return Response.json(result, { headers: { "x-correlation-id": correlation.id }, status: 200 });
    } catch (error) {
      if (error instanceof BillingConfigurationError) {
        return errorResponse(503, error.code, error.message, correlation.id);
      }
      if (error instanceof BillingSignatureError) {
        return errorResponse(400, error.code, error.message, correlation.id);
      }
      return errorResponse(500, "INTERNAL_ERROR", "The billing event could not be persisted.", correlation.id);
    }
  };
}

export const POST = createBillingEventPostHandler(createRuntimeBillingEventDependencies());

function errorResponse(status: number, code: string, message: string, correlationId: string): Response {
  return Response.json(
    { error: { code, correlationId, message } },
    { headers: { "x-correlation-id": correlationId }, status },
  );
}
