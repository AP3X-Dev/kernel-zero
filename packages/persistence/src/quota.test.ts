/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, expect, it, vi } from "vitest";

import { createQuotaRepository } from "./quota";

describe("transaction-bound quota repository", () => {
  it("conditionally reserves finite capacity and reports a machine-readable refusal", async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0) };
    const quota = createQuotaRepository(tx as never);
    await expect(quota.reserve({
      amount: 1,
      limit: 3,
      periodKey: "lifetime",
      quotaKey: "occupied_seats",
      workspaceId: "workspace",
    })).resolves.toEqual({ amount: 1, periodKey: "lifetime", quotaKey: "occupied_seats" });
    await expect(quota.reserve({
      amount: 1,
      limit: 3,
      periodKey: "lifetime",
      quotaKey: "occupied_seats",
      workspaceId: "workspace",
    })).rejects.toMatchObject({ code: "QUOTA_EXCEEDED", quotaKey: "occupied_seats" });
  });

  it("keeps counters for unlimited plans", async () => {
    const tx = { quotaCounter: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const quota = createQuotaRepository(tx as never);
    await quota.reserve({
      amount: 2,
      limit: null,
      periodKey: "lifetime",
      quotaKey: "active_policy_packs",
      workspaceId: "workspace",
    });
    expect(tx.quotaCounter.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { reserved: { increment: 2 } },
    }));
  });

  it("commits, releases, and decrements only validated actual counts", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const quota = createQuotaRepository({ quotaCounter: { updateMany } } as never);
    const scope = { amount: 2, periodKey: "month", quotaKey: "evidence_runs" as const };
    await quota.commit("workspace", scope);
    await quota.release("workspace", scope);
    await quota.decrementUsed({ actualCount: 2, periodKey: "month", quotaKey: "evidence_runs", workspaceId: "workspace" });
    await quota.decrementUsed({ actualCount: 0, periodKey: "month", quotaKey: "evidence_runs", workspaceId: "workspace" });
    expect(updateMany).toHaveBeenCalledTimes(3);
    expect(updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: { reserved: { decrement: 2 }, used: { increment: 2 } },
      where: expect.objectContaining({ reserved: { gte: 2 } }),
    }));
    expect(updateMany).toHaveBeenNthCalledWith(3, expect.objectContaining({
      data: { used: { decrement: 2 } },
      where: expect.objectContaining({ used: { gte: 2 } }),
    }));
  });
});
