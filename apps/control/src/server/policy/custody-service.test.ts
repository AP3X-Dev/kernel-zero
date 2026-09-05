import { describe, expect, it, vi } from "vitest";

import { PolicyCustodyService } from "./custody-service";

const owner = { capabilityDocument: null, isOwner: true, userId: "owner" };
const administrator = { capabilityDocument: { capabilities: ["policy.approve", "policy.read", "workspace.update"] }, isOwner: false, userId: "admin" };
const base = { correlationId: "correlation", workspaceId: "workspace" };

describe("policy custody application service", () => {
  it("lets only the owner register and revoke authority keys", async () => {
    const registerKey = vi.fn().mockResolvedValue({ id: "key-row", keyId: "authority-1" });
    const revokeKey = vi.fn().mockResolvedValue({ revoked: true });
    const service = new PolicyCustodyService({} as never, { registerKey, revokeKey });
    const register = { ...base, keyId: "authority-1", label: "Workspace authority", publicKeyX: "A".repeat(43), validFrom: new Date("2026-01-01T00:00:00.000Z"), validUntil: null };

    await expect(service.registerKey({ ...register, actor: administrator })).rejects.toThrow("FORBIDDEN");
    await expect(service.revokeKey({ ...base, actor: administrator, keyId: "authority-1", revokedFrom: new Date() })).rejects.toThrow("FORBIDDEN");
    expect(registerKey).not.toHaveBeenCalled();
    expect(revokeKey).not.toHaveBeenCalled();

    await expect(service.registerKey({ ...register, actor: owner })).resolves.toEqual({ id: "key-row", keyId: "authority-1" });
    expect(registerKey).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actorUserId: "owner", keyId: "authority-1", publicKeyX: "A".repeat(43), workspaceId: "workspace" }));
    const revokedFrom = new Date("2026-09-05T00:00:00.000Z");
    await expect(service.revokeKey({ ...base, actor: owner, keyId: "authority-1", revokedFrom })).resolves.toEqual({ revoked: true });
    expect(revokeKey).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actorUserId: "owner", keyId: "authority-1", revokedFrom }));
  });
});
