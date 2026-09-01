import { beforeEach, describe, expect, it, vi } from "vitest";

const persistence = vi.hoisted(() => ({
  issueInvitation: vi.fn(),
  markInvitationDelivery: vi.fn(),
  resendInvitation: vi.fn(),
}));

vi.mock("@kernel-zero/persistence", () => persistence);

import type { KernelZeroConfig } from "../config/config";
import { InvitationService } from "./invitation-service";

const config: KernelZeroConfig = {
  appUrl: new URL("http://localhost:3000"), databaseUrl: "postgresql://local/test",
  email: { kind: "local-outbox" }, environment: "test", google: { enabled: false },
  identitySecret: "test-only-identity-secret-32-characters", rateLimit: { enabled: false },
  registrationOpen: true, stripe: { enabled: false },
};

const administrator = {
  capabilityDocument: { capabilities: ["member.invite"] },
  email: "admin@example.test", isOwner: false, userId: "actor-id",
} as const;

describe("InvitationService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("authorizes before persistence and never discloses tokens to an observer", async () => {
    const service = new InvitationService({} as never, config, { send: vi.fn() });
    await expect(service.issue({
      actor: { capabilityDocument: { capabilities: ["workspace.read"] }, email: "a@b.test", isOwner: false, userId: "observer" },
      correlationId: "correlation", email: "invitee@example.test", roleProfileId: "role", seatLimit: 3,
      workspaceId: "workspace",
    })).rejects.toThrow("FORBIDDEN");
    expect(persistence.issueInvitation).not.toHaveBeenCalled();
  });

  it("delivers only after persistence and records retryable failure without rolling back", async () => {
    persistence.issueInvitation.mockResolvedValue({
      expiresAt: new Date("2026-09-07T00:00:00Z"), invitationId: "invite", token: "bearer-token",
    });
    const send = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const service = new InvitationService({} as never, config, { send });
    const result = await service.issue({ actor: administrator, correlationId: "correlation",
      email: "invitee@example.test", roleProfileId: "role", seatLimit: 3, workspaceId: "workspace" });
    expect(result.token).toBe("bearer-token");
    expect(persistence.issueInvitation.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0] ?? 0);
    expect(persistence.markInvitationDelivery).toHaveBeenCalledWith({}, "workspace", "invite", false);
  });
});
