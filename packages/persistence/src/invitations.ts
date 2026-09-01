import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { generateUuidV7 } from "@kernel-zero/domain";

import type { TransactionRepositorySet } from "./transaction";
import { runSerializableTransaction } from "./transaction";

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !email.includes("@")) {
    throw new Error("VALIDATION_FAILED:email");
  }
  return email;
}

function issueBearerToken(): Readonly<{ plaintext: string; tokenHash: string }> {
  const plaintext = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(plaintext, "utf8").digest("hex");
  return { plaintext, tokenHash };
}

function hashBearerToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

async function writeInvitationAudit(
  repositories: TransactionRepositorySet,
  input: Readonly<{
    actionCode: string;
    actorUserId: string;
    correlationId: string;
    invitationId: string;
    metadata?: Record<string, boolean | number | string>;
    workspaceId: string;
  }>,
): Promise<void> {
  await repositories.audit.append({
    actionCode: input.actionCode,
    actor: { kind: "user", userId: input.actorUserId },
    correlationId: input.correlationId,
    description: "Workspace invitation changed.",
    metadata: input.metadata ?? {},
    subjectId: input.invitationId,
    subjectType: "invitation",
    workspaceOpaqueId: input.workspaceId,
  });
}

export type IssuedInvitation = Readonly<{
  expiresAt: Date;
  invitationId: string;
  token: string;
}>;

export async function issueInvitation(
  prisma: PrismaClient,
  input: Readonly<{
    actorEmail: string;
    actorUserId: string;
    correlationId: string;
    displayEmail: string;
    roleProfileId: string;
    seatLimit: number | null;
    workspaceId: string;
  }>,
  now = new Date(),
): Promise<IssuedInvitation> {
  const normalizedEmail = normalizeEmail(input.displayEmail);
  if (normalizedEmail === normalizeEmail(input.actorEmail)) throw new Error("CONFLICT:self-invite");
  const token = issueBearerToken();
  const invitationId = generateUuidV7(now.getTime());
  const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);

  return runSerializableTransaction(prisma, async (repositories) => {
    const tx = repositories.transaction;
    const role = await tx.roleProfile.findUnique({
      where: { workspaceId_id: { id: input.roleProfileId, workspaceId: input.workspaceId } },
    });
    if (role?.quarantineState !== "valid") throw new Error("NOT_FOUND");
    const existingMember = await tx.membership.findFirst({
      where: { user: { normalizedEmail }, workspaceId: input.workspaceId },
    });
    if (existingMember !== null) throw new Error("CONFLICT:existing-member");
    const duplicate = await tx.invitation.findFirst({
      where: { normalizedEmail, status: "active", workspaceId: input.workspaceId },
    });
    if (duplicate !== null) throw new Error("CONFLICT:active-invitation");

    await repositories.quota.reserve({
      amount: 1,
      limit: input.seatLimit,
      periodKey: "lifetime",
      quotaKey: "occupied_seats",
      workspaceId: input.workspaceId,
    });
    await tx.invitation.create({ data: {
      createdAt: now, creatorId: input.actorUserId, deliveryState: "pending",
      displayEmail: input.displayEmail.trim(), expiresAt, id: invitationId, normalizedEmail,
      roleProfileId: input.roleProfileId, status: "active", tokenHash: token.tokenHash,
      updatedAt: now, workspaceId: input.workspaceId,
    } });
    await writeInvitationAudit(repositories, {
      actionCode: "invitation.issued", actorUserId: input.actorUserId, correlationId: input.correlationId,
      invitationId, metadata: { normalizedEmail }, workspaceId: input.workspaceId,
    });
    return { expiresAt, invitationId, token: token.plaintext };
  });
}

export async function markInvitationDelivery(
  prisma: PrismaClient,
  workspaceId: string,
  invitationId: string,
  delivered: boolean,
): Promise<void> {
  await prisma.invitation.updateMany({
    data: { deliveryState: delivered ? "sent" : "failed" },
    where: { id: invitationId, status: "active", workspaceId },
  });
}

export async function resendInvitation(
  prisma: PrismaClient,
  input: Readonly<{ actorUserId: string; correlationId: string; invitationId: string; workspaceId: string }>,
  now = new Date(),
): Promise<IssuedInvitation> {
  const token = issueBearerToken();
  const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
  return runSerializableTransaction(prisma, async (repositories) => {
    const tx = repositories.transaction;
    const changed = await tx.invitation.updateMany({
      data: { deliveryState: "pending", expiresAt, tokenHash: token.tokenHash },
      where: { id: input.invitationId, status: "active", workspaceId: input.workspaceId },
    });
    if (changed.count !== 1) throw new Error("NOT_FOUND");
    await writeInvitationAudit(repositories, { actionCode: "invitation.resent", ...input });
    return { expiresAt, invitationId: input.invitationId, token: token.plaintext };
  });
}

export async function cancelInvitation(
  prisma: PrismaClient,
  input: Readonly<{ actorUserId: string; correlationId: string; invitationId: string; workspaceId: string }>,
): Promise<Readonly<{ cancelled: boolean }>> {
  return runSerializableTransaction(prisma, async (repositories) => {
    const tx = repositories.transaction;
    const changed = await tx.invitation.updateMany({
      data: { status: "cancelled" },
      where: { id: input.invitationId, status: "active", workspaceId: input.workspaceId },
    });
    if (changed.count === 0) return { cancelled: false };
    await repositories.quota.release(input.workspaceId, {
      amount: 1,
      periodKey: "lifetime",
      quotaKey: "occupied_seats",
    });
    await writeInvitationAudit(repositories, { actionCode: "invitation.cancelled", ...input });
    return { cancelled: true };
  });
}

export async function acceptInvitation(
  prisma: PrismaClient,
  input: Readonly<{ correlationId: string; email: string; token: string; userId: string }>,
  now = new Date(),
): Promise<Readonly<{ accepted: boolean; workspaceId: string }>> {
  const normalizedEmail = normalizeEmail(input.email);
  const tokenHash = hashBearerToken(input.token);
  return runSerializableTransaction(prisma, async (repositories) => {
    const tx = repositories.transaction;
    const invitation = await tx.invitation.findUnique({ include: { roleProfile: true }, where: { tokenHash } });
    if (invitation === null) throw new Error("NOT_FOUND");
    if (invitation.normalizedEmail !== normalizedEmail) throw new Error("NOT_FOUND");
    if (invitation.expiresAt <= now) throw new Error("NOT_FOUND");
    if (invitation.roleProfile.quarantineState !== "valid") throw new Error("NOT_FOUND");
    const existing = await tx.membership.findUnique({
      where: { workspaceId_userId: { userId: input.userId, workspaceId: invitation.workspaceId } },
    });
    if (invitation.status === "accepted" && existing !== null) {
      return { accepted: true, workspaceId: invitation.workspaceId };
    }
    if (invitation.status !== "active") throw new Error("NOT_FOUND");
    if (existing === null) {
      await tx.membership.create({ data: {
        id: generateUuidV7(), isOwner: false, roleProfileId: invitation.roleProfileId,
        userId: input.userId, workspaceId: invitation.workspaceId,
      } });
      await repositories.quota.commit(invitation.workspaceId, {
        amount: 1,
        periodKey: "lifetime",
        quotaKey: "occupied_seats",
      });
    } else {
      await repositories.quota.release(invitation.workspaceId, {
        amount: 1,
        periodKey: "lifetime",
        quotaKey: "occupied_seats",
      });
    }
    await tx.invitation.update({ where: { id: invitation.id }, data: { status: "accepted" } });
    await writeInvitationAudit(repositories, {
      actionCode: "invitation.accepted", actorUserId: input.userId, correlationId: input.correlationId,
      invitationId: invitation.id, metadata: { idempotent: existing !== null }, workspaceId: invitation.workspaceId,
    });
    return { accepted: true, workspaceId: invitation.workspaceId };
  });
}

export async function listWorkspaceRoster(
  prisma: PrismaClient,
  workspaceId: string,
  take = 25,
) {
  const limit = Math.max(1, Math.min(100, Math.trunc(take)));
  const [memberships, invitations] = await Promise.all([
    prisma.membership.findMany({
      include: { roleProfile: true, user: { select: { displayName: true, email: true, id: true } } },
      orderBy: [{ joinedAt: "asc" }, { id: "asc" }], take: limit, where: { workspaceId },
    }),
    prisma.invitation.findMany({
      include: { roleProfile: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit,
      where: { status: "active", workspaceId },
    }),
  ]);
  return [
    ...memberships.map((membership) => ({
      displayName: membership.user.displayName, email: membership.user.email, id: membership.id,
      pending: false as const, role: membership.isOwner ? "owner" : membership.roleProfile?.normalizedLabel ?? "quarantined",
    })),
    ...invitations.map((invitation) => ({
      deliveryState: invitation.deliveryState, email: invitation.displayEmail, expiresAt: invitation.expiresAt,
      id: invitation.id, pending: true as const, role: invitation.roleProfile.normalizedLabel,
    })),
  ].slice(0, limit);
}
