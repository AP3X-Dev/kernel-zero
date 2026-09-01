import { describe, expect, it } from "vitest";

import {
  PLAN_CATALOGUE,
  allowsEntitlementAction,
  downgradeBlockers,
  resolveEntitlement,
} from "./entitlements";

describe("typed plan catalogue", () => {
  it("defines the exact plans and quota limits from the requirements", () => {
    expect(Object.keys(PLAN_CATALOGUE)).toEqual(["Open", "Workshop", "Foundry", "Enterprise"]);
    expect(PLAN_CATALOGUE.Open.limits).toEqual({
      activePolicyPacks: 3,
      evidenceRetentionDays: 30,
      evidenceRunsPerMonth: 100,
      occupiedSeats: 3,
    });
    expect(PLAN_CATALOGUE.Workshop.limits).toEqual({
      activePolicyPacks: 20,
      evidenceRetentionDays: 180,
      evidenceRunsPerMonth: 2_000,
      occupiedSeats: 10,
    });
    expect(PLAN_CATALOGUE.Foundry.limits).toEqual({
      activePolicyPacks: 100,
      evidenceRetentionDays: 365,
      evidenceRunsPerMonth: 20_000,
      occupiedSeats: 50,
    });
    expect(PLAN_CATALOGUE.Enterprise.limits).toEqual({
      activePolicyPacks: null,
      evidenceRetentionDays: 730,
      evidenceRunsPerMonth: null,
      occupiedSeats: null,
    });
  });

  it("grants paid access only to active and trialing projections", () => {
    expect(resolveEntitlement({ plan: "Foundry", providerStatus: "active" })).toMatchObject({
      mode: "paid",
      plan: "Foundry",
    });
    expect(resolveEntitlement({ plan: "Workshop", providerStatus: "trialing" })).toMatchObject({
      mode: "paid",
      plan: "Workshop",
    });
    expect(resolveEntitlement({ plan: "Enterprise", providerStatus: "canceled" })).toMatchObject({
      mode: "open",
      plan: "Open",
    });
  });

  it("uses a bounded grace mode that permits reads and evidence but blocks expansion", () => {
    const grace = resolveEntitlement({
      graceExpiresAt: new Date("2026-09-07T00:00:00.000Z"),
      plan: "Foundry",
      providerStatus: "past_due",
    }, new Date("2026-09-01T00:00:00.000Z"));
    expect(grace.mode).toBe("grace");
    expect(allowsEntitlementAction(grace, "read")).toBe(true);
    expect(allowsEntitlementAction(grace, "evidence.submit")).toBe(true);
    for (const action of ["invitation.create", "policy.activate", "exception.approve", "plan.expand"] as const) {
      expect(allowsEntitlementAction(grace, action)).toBe(false);
    }
    expect(resolveEntitlement({
      graceExpiresAt: new Date("2026-09-01T00:00:00.000Z"),
      plan: "Foundry",
      providerStatus: "past_due",
    }, new Date("2026-09-01T00:00:00.001Z")).mode).toBe("open");
  });

  it("reports each concrete downgrade blocker without treating unlimited as a cap", () => {
    expect(downgradeBlockers("Open", {
      activePolicyPacks: 4,
      evidenceRunsThisMonth: 101,
      occupiedSeats: 5,
    })).toEqual([
      { current: 5, limit: 3, quota: "occupied_seats", requiredReduction: 2 },
      { current: 4, limit: 3, quota: "active_policy_packs", requiredReduction: 1 },
      { current: 101, limit: 100, quota: "evidence_runs", requiredReduction: 1 },
    ]);
    expect(downgradeBlockers("Enterprise", {
      activePolicyPacks: 1_000,
      evidenceRunsThisMonth: 1_000_000,
      occupiedSeats: 10_000,
    })).toEqual([]);
  });
});
