export const APP_ERROR_CODES = [
  "UNAUTHENTICATED",
  "WORKSPACE_REQUIRED",
  "NOT_FOUND",
  "FORBIDDEN",
  "VALIDATION_FAILED",
  "CONFLICT",
  "QUOTA_EXCEEDED",
  "FEATURE_UNAVAILABLE",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "INVALID_EVIDENCE",
  "INTERNAL_ERROR",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];
export type AppErrorDetailValue = boolean | number | string | null;

export type AppError = Readonly<{
  code: AppErrorCode;
  message: string;
  retryable: boolean;
  details?: Readonly<Record<string, AppErrorDetailValue>>;
}>;

const defaultMessages: Readonly<Record<AppErrorCode, string>> = Object.freeze({
  CONFLICT: "The requested change conflicts with current state.",
  FEATURE_UNAVAILABLE: "This feature is not available.",
  FORBIDDEN: "You are not allowed to perform this action.",
  INTERNAL_ERROR: "The request could not be completed.",
  INVALID_EVIDENCE: "The evidence document is invalid.",
  NOT_FOUND: "The requested resource was not found.",
  PROVIDER_UNAVAILABLE: "A required provider is unavailable.",
  QUOTA_EXCEEDED: "The workspace limit has been reached.",
  RATE_LIMITED: "Too many requests were received.",
  UNAUTHENTICATED: "Authentication is required.",
  VALIDATION_FAILED: "The submitted value is invalid.",
  WORKSPACE_REQUIRED: "An active workspace is required.",
});

export function appError(
  code: AppErrorCode,
  options: Readonly<{
    details?: Readonly<Record<string, AppErrorDetailValue>>;
    message?: string;
    retryable?: boolean;
  }> = {},
): AppError {
  const base = {
    code,
    message: options.message ?? defaultMessages[code],
    retryable: options.retryable ?? false,
  };
  return Object.freeze(
    options.details === undefined
      ? base
      : { ...base, details: Object.freeze({ ...options.details }) },
  );
}

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === "string" && (APP_ERROR_CODES as readonly string[]).includes(value);
}
