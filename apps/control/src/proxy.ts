import { NextResponse, type NextRequest } from "next/server";

import { resolveCorrelationId } from "@kernel-zero/domain";

export function proxy(request: NextRequest): NextResponse {
  const correlation = resolveCorrelationId(request.headers.get("x-correlation-id"));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-correlation-id", correlation.id);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-correlation-id", correlation.id);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
