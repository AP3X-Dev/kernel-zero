/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { describe, expect, it, vi } from "vitest";

import { acceptInvitation, cancelInvitation, issueInvitation, resendInvitation } from "./invitations";

const ACTOR_ID = "0195f000-0000-7000-8000-000000000003";
const CORRELATION_ID = "0195f000-0000-7000-8000-000000000001";
const WORKSPACE_ID = "0195f000-0000-7000-8000-000000000002";

function transactionClient(tx: object) {
  return { $transaction: vi.fn(async (operation) => operation(tx)) } as never;
}

describe("invitation lifecycle persistence", () => {
  it("issues within the six-round-trip budget while holding one pending seat", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      auditRecord: { create: vi.fn() },
      invitation: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
      membership: { findFirst: vi.fn().mockResolvedValue(null) },
      roleProfile: { findUnique: vi.fn().mockResolvedValue({ quarantineState: "valid" }) },
    };
    await expect(issueInvitation(transactionClient(tx), {
      actorEmail: "actor@example.test",
      actorUserId: ACTOR_ID,
      correlationId: CORRELATION_ID,
      displayEmail: "recipient@example.test",
      roleProfileId: "0195f000-0000-7000-8000-000000000004",
      seatLimit: 3,
      workspaceId: WORKSPACE_ID,
    }, new Date("2026-08-31T00:00:00Z"))).resolves.toMatchObject({
      expiresAt: new Date("2026-09-07T00:00:00Z"),
    });
    const roundTrips = [
      tx.roleProfile.findUnique,
      tx.membership.findFirst,
      tx.invitation.findFirst,
      tx.$executeRaw,
      tx.invitation.create,
      tx.auditRecord.create,
    ].reduce((total, method) => total + method.mock.calls.length, 0);
    expect(roundTrips).toBe(6);
  });

  it("resend rotates the hash, resets expiry, and does not touch quota", async () => {
    const updates: unknown[] = [];
    const tx = {
      auditRecord: { create: vi.fn() },
      invitation: { updateMany: vi.fn((input) => { updates.push(input); return { count: 1 }; }) },
      quotaCounter: { updateMany: vi.fn() },
    };
    const prisma = transactionClient(tx);
    const input = { actorUserId: ACTOR_ID, correlationId: CORRELATION_ID, invitationId: "invite", workspaceId: WORKSPACE_ID };
    const first = await resendInvitation(prisma, input, new Date("2026-08-31T00:00:00Z"));
    const second = await resendInvitation(prisma, input, new Date("2026-09-01T00:00:00Z"));
    expect(first.token).not.toBe(second.token);
    expect(updates[0]).not.toEqual(updates[1]);
    expect(first.expiresAt.toISOString()).toBe("2026-09-07T00:00:00.000Z");
    expect(second.expiresAt.toISOString()).toBe("2026-09-08T00:00:00.000Z");
    expect(tx.quotaCounter.updateMany).not.toHaveBeenCalled();
  });

  it("cancellation releases exactly one reservation and repeated cancellation is a no-op", async () => {
    const tx = {
      auditRecord: { create: vi.fn() },
      invitation: { updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }) },
      quotaCounter: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = transactionClient(tx);
    const input = { actorUserId: ACTOR_ID, correlationId: CORRELATION_ID, invitationId: "invite", workspaceId: WORKSPACE_ID };
    await expect(cancelInvitation(prisma, input)).resolves.toEqual({ cancelled: true });
    await expect(cancelInvitation(prisma, input)).resolves.toEqual({ cancelled: false });
    expect(tx.quotaCounter.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.auditRecord.create).toHaveBeenCalledTimes(1);
  });

  it("rejects recipient mismatch without exposing invitation state or changing seats", async () => {
    const tx = {
      invitation: { findUnique: vi.fn().mockResolvedValue({
        expiresAt: new Date("2026-09-07T00:00:00Z"), normalizedEmail: "recipient@example.test",
        roleProfile: { quarantineState: "valid" }, status: "active", workspaceId: "workspace",
      }) },
      membership: { findUnique: vi.fn() }, quotaCounter: { updateMany: vi.fn() },
    };
    await expect(acceptInvitation(transactionClient(tx), {
      correlationId: CORRELATION_ID, email: "sibling@example.test", token: "token", userId: ACTOR_ID,
    }, new Date("2026-08-31T00:00:00Z"))).rejects.toThrow("NOT_FOUND");
    expect(tx.membership.findUnique).not.toHaveBeenCalled();
    expect(tx.quotaCounter.updateMany).not.toHaveBeenCalled();
  });

  it("converts reserved to used once and repeated acceptance is idempotent", async () => {
    const invitation = {
      expiresAt: new Date("2026-09-07T00:00:00Z"), id: "invite", normalizedEmail: "recipient@example.test",
      roleProfile: { quarantineState: "valid" }, roleProfileId: "role", status: "active", workspaceId: WORKSPACE_ID,
    };
    const tx = {
      auditRecord: { create: vi.fn() }, invitation: {
        findUnique: vi.fn().mockImplementation(() => invitation),
        update: vi.fn().mockImplementation(() => { invitation.status = "accepted"; }),
      },
      membership: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "member" }),
      },
      quotaCounter: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = transactionClient(tx);
    const input = { correlationId: CORRELATION_ID, email: "RECIPIENT@example.test", token: "token", userId: ACTOR_ID };
    await expect(acceptInvitation(prisma, input, new Date("2026-08-31T00:00:00Z"))).resolves.toEqual({ accepted: true, workspaceId: WORKSPACE_ID });
    await expect(acceptInvitation(prisma, input, new Date("2026-08-31T00:00:00Z"))).resolves.toEqual({ accepted: true, workspaceId: WORKSPACE_ID });
    expect(tx.membership.create).toHaveBeenCalledTimes(1);
    expect(tx.quotaCounter.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.quotaCounter.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { reserved: { decrement: 1 }, used: { increment: 1 } },
    }));
  });
});
