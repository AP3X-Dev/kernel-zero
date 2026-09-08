/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { describe, expect, it, vi } from "vitest";

import {
  GOVERNED_ACTIONS,
  defineGovernedAction,
  executeGovernedAction,
  validateGovernedActionRegistry,
} from "./governed-actions";

const actor = { kind: "operator" as const };

describe("governed action registry and executor", () => {
  it("accepts the complete registry and rejects missing closed metadata", () => {
    expect(validateGovernedActionRegistry(GOVERNED_ACTIONS)).toEqual({ ok: true });
    expect(() => defineGovernedAction("broken", {
      audit: { actionCode: "broken", description: "Broken.", subjectType: "test" },
      idempotency: "none",
      tenantScope: "workspace",
    } as never)).toThrow("transactionTimeoutMs");
  });

  it("refuses an empty workspace before opening a transaction", async () => {
    const client = { $transaction: vi.fn() };
    await expect(executeGovernedAction({
      action: GOVERNED_ACTIONS["policy.activate"],
      actor,
      client: client as never,
      correlationId: "0195f000-0000-7000-8000-000000000001",
      metadata: {},
      operation: vi.fn(),
      subjectId: "policy-a",
      workspaceId: " ",
    })).rejects.toMatchObject({ code: "WORKSPACE_REQUIRED" });
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("runs the business mutation and audit through one transaction-bound repository set", async () => {
    const calls: string[] = [];
    const repositories = { audit: { append: vi.fn(async () => { calls.push("audit"); }) }, transaction: {} };
    const client = { $transaction: vi.fn(async (callback) => callback({})) };
    const result = await executeGovernedAction({
      action: GOVERNED_ACTIONS["policy.activate"],
      actor,
      client: client as never,
      correlationId: "0195f000-0000-7000-8000-000000000001",
      metadata: {},
      operation: async () => { calls.push("business"); return "done"; },
      repositoryFactory: () => repositories as never,
      subjectId: "policy-a",
      workspaceId: "0195f000-0000-7000-8000-000000000002",
    });
    expect(result).toBe("done");
    expect(calls).toEqual(["business", "audit"]);
  });

  it("surfaces audit failure so the enclosing transaction cannot commit business state", async () => {
    const repositories = { audit: { append: vi.fn().mockRejectedValue(new Error("audit unavailable")) }, transaction: {} };
    const client = { $transaction: vi.fn(async (callback) => callback({})) };
    const business = vi.fn().mockResolvedValue("changed");
    await expect(executeGovernedAction({
      action: GOVERNED_ACTIONS["policy.retire"],
      actor,
      client: client as never,
      correlationId: "0195f000-0000-7000-8000-000000000001",
      metadata: {},
      operation: business,
      repositoryFactory: () => repositories as never,
      subjectId: "pack",
      workspaceId: "0195f000-0000-7000-8000-000000000002",
    })).rejects.toThrow("audit unavailable");
    expect(business).toHaveBeenCalledTimes(1);
  });
});
