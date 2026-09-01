import { describe, expect, it, vi } from "vitest";

import { ExceptionService } from "./exception-service";

const actor = (capabilities: string[], userId: string) => ({ capabilityDocument: { capabilities }, isOwner: false, userId });

describe("exception application service", () => {
  it("separates request, decision, revoke, and key-management capabilities", async () => {
    const operations = { decide: vi.fn(), registerKey: vi.fn(), request: vi.fn(), revoke: vi.fn() };
    const service = new ExceptionService({} as never, operations as never);
    const base = { correlationId: "correlation", workspaceId: "workspace" };
    await expect(service.decide({ ...base, actor: actor(["exception.request"], "reviewer"), decision: "approved", decisionNote: "note", exceptionId: "exception" })).rejects.toThrow("FORBIDDEN");
    await expect(service.registerKey({ ...base, actor: actor(["exception.decide"], "reviewer"), keyId: "key", label: "key", publicKey: "pem" })).rejects.toThrow("FORBIDDEN");
    expect(operations.decide).not.toHaveBeenCalled();
    expect(operations.registerKey).not.toHaveBeenCalled();
  });
});
