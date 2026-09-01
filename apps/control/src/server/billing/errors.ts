import "server-only";

import type { AppErrorCode } from "@kernel-zero/domain";

export class BillingConfigurationError extends Error {
  readonly code = "FEATURE_UNAVAILABLE" as const satisfies AppErrorCode;
  readonly retryable = false;

  constructor() {
    super("Billing is not configured.");
    this.name = "BillingConfigurationError";
  }
}

export class BillingProviderError extends Error {
  readonly code = "PROVIDER_UNAVAILABLE" as const satisfies AppErrorCode;
  readonly retryable = true;

  constructor(message = "The billing provider is unavailable.") {
    super(message);
    this.name = "BillingProviderError";
  }
}

export class BillingSignatureError extends Error {
  readonly code = "VALIDATION_FAILED" as const satisfies AppErrorCode;
  readonly retryable = false;

  constructor() {
    super("The billing event signature is invalid.");
    this.name = "BillingSignatureError";
  }
}

export function billingFailure(
  code: AppErrorCode,
  reason: string,
  extras: Readonly<{ blockers?: unknown }> = {},
): Error & { blockers?: unknown; code: AppErrorCode; reason: string } {
  return Object.assign(new Error(`${code}:${reason}`), { code, reason, ...extras });
}
