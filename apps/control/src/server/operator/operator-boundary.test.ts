/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, expect, it, vi } from "vitest";

import { authorizeOperatorRoute, resolveSystemOperator } from "./operator-boundary";

describe("separate system operator boundary", () => {
  it("hides disabled and unauthorized operations without exposing the bootstrap email", async () => {
    expect(await authorizeOperatorRoute({ configuredEmail: null, session: null })).toEqual({ decision: "not-found" });
    expect(await authorizeOperatorRoute({ configuredEmail: "ops@example.test", session: null })).toEqual({ decision: "sign-in" });
    const prisma = { systemOperatorGrant: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() } };
    expect(await authorizeOperatorRoute({
      configuredEmail: "ops@example.test",
      prisma: prisma as never,
      session: { normalizedEmail: "member@example.test", userId: "user-a" },
    })).toEqual({ decision: "application" });
    expect(prisma.systemOperatorGrant.upsert).not.toHaveBeenCalled();
  });

  it("bootstraps the exact normalized email once through an idempotent unique upsert", async () => {
    const prisma = { systemOperatorGrant: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ revokedAt: null }),
    } };
    await expect(resolveSystemOperator(prisma as never, {
      configuredEmail: "ops@example.test",
      normalizedEmail: "ops@example.test",
      userId: "0195f000-0000-7000-8000-000000000003",
    })).resolves.toBe(true);
    expect(prisma.systemOperatorGrant.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ source: "bootstrap", userId: "0195f000-0000-7000-8000-000000000003" }),
      where: { userId: "0195f000-0000-7000-8000-000000000003" },
    }));
  });

  it("never lets workspace membership substitute for an operator grant", async () => {
    const prisma = { systemOperatorGrant: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() } };
    await expect(resolveSystemOperator(prisma as never, {
      configuredEmail: "ops@example.test",
      normalizedEmail: "owner@example.test",
      userId: "workspace-owner",
    })).resolves.toBe(false);
  });
});
