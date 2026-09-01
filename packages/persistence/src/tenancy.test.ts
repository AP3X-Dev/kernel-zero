/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { describe, expect, it, vi } from "vitest";

import { createWorkspace, resolveWorkspaceContext, tenantSelector } from "./tenancy";

describe("tenant-scoped persistence", () => {
  it("always composes workspaceId into owned selectors", () => {
    expect(tenantSelector("workspace-a", { id: "object-a" })).toEqual({
      id: "object-a", workspaceId: "workspace-a",
    });
  });

  it("uses a still-valid session workspace then owner/newest fallback per request", async () => {
    const selected = { id: "membership-a", roleProfile: null, workspace: { id: "selected" } };
    const fallback = { id: "membership-b", roleProfile: null, workspace: { id: "fallback" } };
    const prisma = { membership: {
      findFirst: vi.fn().mockResolvedValue(fallback),
      findUnique: vi.fn().mockResolvedValueOnce(selected).mockResolvedValueOnce(null),
    } } as never;
    await expect(resolveWorkspaceContext(prisma, "user", "selected")).resolves.toMatchObject({ workspace: { id: "selected" } });
    await expect(resolveWorkspaceContext(prisma, "user", "removed")).resolves.toMatchObject({ workspace: { id: "fallback" } });
    expect((prisma as { membership: { findFirst: ReturnType<typeof vi.fn> } }).membership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ isOwner: "desc" }, { joinedAt: "desc" }, { id: "desc" }], where: { userId: "user" },
    }));
  });

  it("creates workspace, default profiles, counters, onboarding, and audit in one transaction", async () => {
    const tx = {
      auditRecord: { create: vi.fn() },
      membership: { create: vi.fn(), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "membership", roleProfile: null }) },
      quotaCounter: { createMany: vi.fn() },
      roleProfile: { createMany: vi.fn() },
      user: { update: vi.fn() },
      workspace: { create: vi.fn(), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "workspace", slug: "policy-team" }) },
    };
    const prisma = { $transaction: vi.fn(async (operation) => operation(tx)) } as never;
    const result = await createWorkspace(prisma, {
      correlationId: "018f0000-0000-7000-8000-000000000001", name: " Policy Team ",
      userId: "018f0000-0000-7000-8000-000000000002",
    }, new Date("2026-08-31T12:00:00Z"));
    expect(result.workspace.slug).toBe("policy-team");
    expect(tx.roleProfile.createMany.mock.calls[0]?.[0].data).toHaveLength(4);
    expect(tx.quotaCounter.createMany.mock.calls[0]?.[0].data).toEqual(expect.arrayContaining([
      expect.objectContaining({ quotaKey: "occupied_seats", reserved: 0, used: 1 }),
      expect.objectContaining({ periodKey: "2026-08", quotaKey: "evidence_runs" }),
    ]));
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { onboardingState: "complete" } }));
    expect(tx.auditRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actionCode: "workspace.created" }) }));
  });
});
