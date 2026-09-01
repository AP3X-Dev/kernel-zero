import "server-only";

import { appError, type AppError } from "@kernel-zero/domain";

export type RateLimitKind = "credential" | "api";

export type RateLimiter = Readonly<{
  limit(input: Readonly<{ key: string; limit: number; windowSeconds: number }>): Promise<Readonly<{
    allowed: boolean;
    remaining: number;
    resetEpoch: number;
  }>>;
}>;

export type RateLimitHealth = Readonly<{
  code: "rate_limit_unavailable" | "rate_limit_unconfigured";
  component: "rate-limit";
  level: "warning";
}>;

export type RateLimitDecision =
  | Readonly<{ allowed: true; health?: RateLimitHealth }>
  | Readonly<{ allowed: false; error: AppError; retryAfter: number }>;

export async function enforceRateLimit(input: Readonly<{
  address: string;
  configured: boolean;
  kind: RateLimitKind;
  limiter: RateLimiter | null;
  nowEpoch: number;
  userId?: string;
}>): Promise<RateLimitDecision> {
  if (!input.configured || input.limiter === null) {
    return { allowed: true, health: health("rate_limit_unconfigured") };
  }
  const policy = input.kind === "credential"
    ? { key: `credential:${input.address}`, limit: 10, windowSeconds: 60 }
    : { key: `api:${input.userId ?? input.address}`, limit: 100, windowSeconds: 10 };
  try {
    const result = await input.limiter.limit(policy);
    if (result.allowed) return { allowed: true };
    const retryAfter = Math.max(1, Math.ceil(result.resetEpoch - input.nowEpoch));
    return {
      allowed: false,
      error: appError("RATE_LIMITED", {
        details: {
          limit: policy.limit,
          remaining: Math.max(0, Math.trunc(result.remaining)),
          resetEpoch: result.resetEpoch,
          retryAfter,
        },
        retryable: true,
      }),
      retryAfter,
    };
  } catch {
    return { allowed: true, health: health("rate_limit_unavailable") };
  }
}

export function addressHint(input: Readonly<{
  forwardedFor?: string | null;
  remoteAddress?: string | null;
  trustProxy: boolean;
}>): string {
  const forwarded = input.trustProxy ? input.forwardedFor?.split(",", 1)[0]?.trim() : undefined;
  return safeAddress(forwarded) ?? safeAddress(input.remoteAddress) ?? "unknown";
}

function safeAddress(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.length < 1 || value.length > 128) return null;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return null;
  }
  return value;
}

function health(code: RateLimitHealth["code"]): RateLimitHealth {
  return Object.freeze({ code, component: "rate-limit" as const, level: "warning" as const });
}
