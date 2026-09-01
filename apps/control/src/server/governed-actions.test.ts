/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { describe, expect, it, vi } from "vitest";

import {
  GOVERNED_ACTIONS,
  defineGovernedAction,
  executeGovernedAction,
  validateGovernedActionRegistry,
} from "./governed-actions";

const actor = {
  actor: { kind: "user" as const, userId: "0195f000-0000-7000-8000-000000000003" },
  authority: { capabilityDocument: { capabilities: ["policy.activate"] }, isOwner: false },
};

describe("governed action registry and executor", () => {
  it("accepts the complete registry and rejects missing closed metadata", () => {
    expect(validateGovernedActionRegistry(GOVERNED_ACTIONS)).toEqual({ ok: true });
    expect(() => defineGovernedAction("broken", {
      audit: { actionCode: "broken", description: "Broken.", subjectType: "test" },
      capability: "policy.activate",
      idempotency: "none",
      quota: null,
      tenantScope: "workspace",
    } as never)).toThrow("transactionTimeoutMs");
  });

  it("authorizes before opening a transaction", async () => {
    const client = { $transaction: vi.fn() };
    await expect(executeGovernedAction({
      action: defineGovernedAction("policy.activate-test", {
        audit: { actionCode: "policy.activated", description: "Policy activated.", subjectType: "policy" },
        capability: "policy.activate",
        idempotency: "none",
        quota: null,
        tenantScope: "workspace",
        transactionTimeoutMs: 5_000,
      }),
      actor: { actor: actor.actor, authority: { capabilityDocument: { capabilities: [] }, isOwner: false } },
      client: client as never,
      correlationId: "0195f000-0000-7000-8000-000000000001",
      metadata: {},
      operation: vi.fn(),
      subjectId: "policy-a",
      workspaceId: "0195f000-0000-7000-8000-000000000002",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("runs quota, business mutation, and audit through one transaction-bound repository set", async () => {
    const calls: string[] = [];
    const repositories = {
      audit: { append: vi.fn(async () => { calls.push("audit"); }) },
      quota: {
        commit: vi.fn(async () => { calls.push("commit"); }),
        reserve: vi.fn(async () => { calls.push("reserve"); return { amount: 1, periodKey: "lifetime", quotaKey: "active_policy_packs" }; }),
      },
      transaction: {},
    };
    const client = { $transaction: vi.fn(async (callback) => callback({})) };
    const result = await executeGovernedAction({
      action: defineGovernedAction("policy.activate-test", {
        audit: { actionCode: "policy.activated", description: "Policy activated.", subjectType: "policy" },
        capability: "policy.activate",
        idempotency: "none",
        quota: { amount: 1, finalize: "commit", quotaKey: "active_policy_packs" },
        tenantScope: "workspace",
        transactionTimeoutMs: 5_000,
      }),
      actor,
      client: client as never,
      correlationId: "0195f000-0000-7000-8000-000000000001",
      metadata: {},
      operation: async () => { calls.push("business"); return "done"; },
      quota: { limit: 3, periodKey: "lifetime" },
      repositoryFactory: () => repositories as never,
      subjectId: "policy-a",
      workspaceId: "0195f000-0000-7000-8000-000000000002",
    });
    expect(result).toBe("done");
    expect(calls).toEqual(["reserve", "business", "commit", "audit"]);
  });

  it("surfaces audit failure so the enclosing transaction cannot commit business or quota state", async () => {
    const repositories = {
      audit: { append: vi.fn().mockRejectedValue(new Error("audit unavailable")) },
      quota: { reserve: vi.fn() },
      transaction: {},
    };
    const client = { $transaction: vi.fn(async (callback) => callback({})) };
    const business = vi.fn().mockResolvedValue("changed");
    await expect(executeGovernedAction({
      action: GOVERNED_ACTIONS["workspace.delete"],
      actor: { actor: actor.actor, authority: { capabilityDocument: { capabilities: ["workspace.delete"] }, isOwner: true } },
      client: client as never,
      correlationId: "0195f000-0000-7000-8000-000000000001",
      metadata: {},
      operation: business,
      repositoryFactory: () => repositories as never,
      subjectId: "workspace",
      workspaceId: "0195f000-0000-7000-8000-000000000002",
    })).rejects.toThrow("audit unavailable");
    expect(business).toHaveBeenCalledTimes(1);
  });
});
