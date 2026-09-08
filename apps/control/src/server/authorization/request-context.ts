import "server-only";

import { timingSafeEqual } from "node:crypto";

import { resolveCorrelationId } from "@kernel-zero/domain";

export type RequestContext = Readonly<{
  correlationId: string;
  workspaceId: string;
}>;

export type RequestContextResolution =
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ context: RequestContext; kind: "ok" }>;

/** One place turns an API request into a workspace context; routes never read configuration themselves. */
export function resolveRequestContext(
  request: Request,
  config: Readonly<{ evidenceToken: string; workspaceId: string }>,
): RequestContextResolution {
  const presented = bearerToken(request.headers.get("authorization"));
  if (presented === null || !tokensMatch(presented, config.evidenceToken)) return { kind: "unauthenticated" };
  return {
    context: {
      correlationId: resolveCorrelationId(request.headers.get("x-correlation-id")).id,
      workspaceId: config.workspaceId,
    },
    kind: "ok",
  };
}

function bearerToken(header: string | null): string | null {
  if (header === null) return null;
  const match = /^Bearer\s+(\S+)$/iu.exec(header.trim());
  return match?.[1] ?? null;
}

function tokensMatch(presented: string, expected: string): boolean {
  const left = Buffer.from(presented, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
