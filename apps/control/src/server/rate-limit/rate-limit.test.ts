import { describe, expect, it, vi } from "vitest";

import { addressHint, enforceRateLimit } from "./rate-limit";

describe("optional rate limiting", () => {
  it("uses the exact credential and application windows and refusal metadata", async () => {
    const limiter = { limit: vi.fn().mockResolvedValue({ allowed: false, remaining: 0, resetEpoch: 2_000 }) };
    const result = await enforceRateLimit({
      address: "192.0.2.1",
      configured: true,
      kind: "credential",
      limiter,
      nowEpoch: 1_000,
    });
    expect(limiter.limit).toHaveBeenCalledWith({ key: "credential:192.0.2.1", limit: 10, windowSeconds: 60 });
    expect(result).toMatchObject({
      allowed: false,
      error: { code: "RATE_LIMITED", details: { limit: 10, remaining: 0, resetEpoch: 2_000, retryAfter: 1_000 } },
    });
  });

  it("fails open with a structured health event when absent or unavailable", async () => {
    await expect(enforceRateLimit({
      address: "192.0.2.1",
      configured: false,
      kind: "api",
      limiter: null,
      nowEpoch: 1_000,
      userId: "user-a",
    })).resolves.toMatchObject({ allowed: true, health: { code: "rate_limit_unconfigured" } });
    await expect(enforceRateLimit({
      address: "192.0.2.1",
      configured: true,
      kind: "api",
      limiter: { limit: vi.fn().mockRejectedValue(new Error("offline")) },
      nowEpoch: 1_000,
      userId: "user-a",
    })).resolves.toMatchObject({ allowed: true, health: { code: "rate_limit_unavailable" } });
  });

  it("accepts forwarded addresses only when the deployment trusts its proxy", () => {
    expect(addressHint({ forwardedFor: "198.51.100.7, 198.51.100.8", remoteAddress: "10.0.0.2", trustProxy: true })).toBe("198.51.100.7");
    expect(addressHint({ forwardedFor: "198.51.100.7", remoteAddress: "10.0.0.2", trustProxy: false })).toBe("10.0.0.2");
  });
});
