import "server-only";

import { appError, type AppError } from "@kernel-zero/domain";

export type IdentityOperation =
  | "account"
  | "oauth"
  | "password-reset"
  | "session"
  | "verification";

type IdentityFailure = Readonly<{ code?: unknown; status?: unknown; statusCode?: unknown }>;

export function mapIdentityFailure(
  operation: IdentityOperation,
  failure: unknown,
): AppError {
  const safe = typeof failure === "object" && failure !== null
    ? failure as IdentityFailure
    : {};
  const status = typeof safe.statusCode === "number"
    ? safe.statusCode
    : typeof safe.status === "number" ? safe.status : undefined;
  const providerCode = typeof safe.code === "string" ? safe.code.toUpperCase() : "";

  if (status === 429) return appError("RATE_LIMITED", { retryable: true });
  if (status === 401 || providerCode.includes("INVALID_PASSWORD") || providerCode.includes("INVALID_TOKEN")) {
    return appError("UNAUTHENTICATED", { details: { operation } });
  }
  if (status === 403 || providerCode.includes("SIGNUP_DISABLED")) {
    return appError("FORBIDDEN", { details: { operation } });
  }
  if (status === 400 || providerCode.includes("INVALID") || providerCode.includes("EXPIRED")) {
    return appError("VALIDATION_FAILED", { details: { operation } });
  }
  if (status === 409 || providerCode.includes("EXISTS")) {
    return appError("CONFLICT", { details: { operation } });
  }
  return appError("PROVIDER_UNAVAILABLE", { details: { operation }, retryable: true });
}
