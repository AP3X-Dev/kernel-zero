import "server-only";

import type { Membership, Prisma, PrismaClient, RoleProfile, Workspace } from "@prisma/client";
import {
  BUILT_IN_ROLE_CAPABILITIES,
  DEFAULT_ROLE_PROFILE_LABELS,
  generateUuidV7,
  workspaceSlug,
  withCollisionSuffix,
  type DefaultRoleProfileLabel,
} from "@kernel-zero/domain";

import type { TransactionRepositorySet } from "./transaction";
import { runSerializableTransaction } from "./transaction";

export type WorkspaceContext = Readonly<{
  membership: Membership & { roleProfile: RoleProfile | null };
  workspace: Workspace;
}>;

export type CreateWorkspaceInput = Readonly<{
  correlationId: string;
  logoUrl?: string;
  name: string;
  userId: string;
}>;

function normalizeWorkspaceInput(input: CreateWorkspaceInput): Readonly<{
  logoUrl: string | null;
  name: string;
}> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new Error("VALIDATION_FAILED:name");
  if (input.logoUrl === undefined || input.logoUrl.trim() === "") return { logoUrl: null, name };
  const logo = new URL(input.logoUrl);
  if (logo.protocol !== "https:" || logo.username !== "" || logo.password !== "") {
    throw new Error("VALIDATION_FAILED:logoUrl");
  }
  return { logoUrl: logo.toString(), name };
}

function defaultRoleRows(workspaceId: string): Prisma.RoleProfileCreateManyInput[] {
  return DEFAULT_ROLE_PROFILE_LABELS.map((label: DefaultRoleProfileLabel) => ({
    builtIn: true,
    capabilityDocument: { capabilities: BUILT_IN_ROLE_CAPABILITIES[label] },
    displayLabel: label === "policy_author"
      ? "Policy author"
      : `${label[0]?.toUpperCase() ?? ""}${label.slice(1)}`,
    id: generateUuidV7(),
    normalizedLabel: label,
    quarantineState: "valid",
    schemaVersion: 1,
    workspaceId,
  }));
}

function currentMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

async function insertWorkspace(
  repositories: TransactionRepositorySet,
  input: CreateWorkspaceInput,
  slug: string,
  now: Date,
): Promise<WorkspaceContext> {
  const tx = repositories.transaction;
  const normalized = normalizeWorkspaceInput(input);
  const workspaceId = generateUuidV7(now.getTime());
  const membershipId = generateUuidV7(now.getTime());

  await tx.workspace.create({
    data: {
      createdAt: now,
      id: workspaceId,
      logoUrl: normalized.logoUrl,
      name: normalized.name,
      ownerMembershipId: membershipId,
      slug,
      updatedAt: now,
    },
  });
  await tx.roleProfile.createMany({ data: defaultRoleRows(workspaceId) });
  await tx.membership.create({
    data: { id: membershipId, isOwner: true, joinedAt: now, userId: input.userId, workspaceId },
  });
  await tx.quotaCounter.createMany({
    data: [
      { id: generateUuidV7(), periodKey: "lifetime", quotaKey: "occupied_seats", reserved: 0, used: 1, workspaceId },
      { id: generateUuidV7(), periodKey: "lifetime", quotaKey: "active_policy_packs", reserved: 0, used: 0, workspaceId },
      { id: generateUuidV7(), periodKey: currentMonth(now), quotaKey: "evidence_runs", reserved: 0, used: 0, workspaceId },
    ],
  });
  await tx.user.update({ where: { id: input.userId }, data: { onboardingState: "complete" } });
  await repositories.audit.append({
    actionCode: "workspace.created",
    actor: { kind: "user", userId: input.userId },
    correlationId: input.correlationId,
    description: "Workspace created.",
    metadata: {},
    subjectId: workspaceId,
    subjectType: "workspace",
    workspaceOpaqueId: workspaceId,
  });
  const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const membership = await tx.membership.findUniqueOrThrow({
    include: { roleProfile: true },
    where: { id: membershipId },
  });
  return { membership, workspace };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function createWorkspace(
  prisma: PrismaClient,
  input: CreateWorkspaceInput,
  now = new Date(),
): Promise<WorkspaceContext> {
  const base = workspaceSlug(input.name);
  if (!base.ok) throw new Error("VALIDATION_FAILED:name");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const slug = attempt === 0 ? base.value : withCollisionSuffix(base.value);
    try {
      return await runSerializableTransaction(
        prisma,
        (repositories) => insertWorkspace(repositories, input, slug, now),
      );
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 3) throw error;
    }
  }
  throw new Error("CONFLICT:slug");
}

export async function resolveWorkspaceContext(
  prisma: PrismaClient,
  userId: string,
  selectedWorkspaceId?: string | null,
): Promise<WorkspaceContext | null> {
  if (selectedWorkspaceId !== undefined && selectedWorkspaceId !== null) {
    const selected = await prisma.membership.findUnique({
      include: { roleProfile: true, workspace: true },
      where: { workspaceId_userId: { userId, workspaceId: selectedWorkspaceId } },
    });
    if (selected !== null) return { membership: selected, workspace: selected.workspace };
  }
  const fallback = await prisma.membership.findFirst({
    include: { roleProfile: true, workspace: true },
    orderBy: [{ isOwner: "desc" }, { joinedAt: "desc" }, { id: "desc" }],
    where: { userId },
  });
  return fallback === null ? null : { membership: fallback, workspace: fallback.workspace };
}

export function tenantSelector<T extends object>(workspaceId: string, selector: T): T & { workspaceId: string } {
  return { ...selector, workspaceId };
}

export async function transferWorkspaceOwnership(
  prisma: PrismaClient,
  input: Readonly<{
    actorUserId: string;
    correlationId: string;
    recipientUserId: string;
    workspaceId: string;
  }>,
): Promise<void> {
  await runSerializableTransaction(prisma, async (repositories) => {
    const tx = repositories.transaction;
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${input.workspaceId}::uuid FOR UPDATE`;
    const members = await tx.$queryRaw<{ id: string; isOwner: boolean; userId: string }[]>`
      SELECT id, "isOwner", "userId" FROM "Membership"
      WHERE "workspaceId" = ${input.workspaceId}::uuid
        AND "userId" IN (${input.actorUserId}::uuid, ${input.recipientUserId}::uuid)
      FOR UPDATE
    `;
    const actor = members.find((member) => member.userId === input.actorUserId);
    const recipient = members.find((member) => member.userId === input.recipientUserId);
    if (actor?.isOwner !== true) throw new Error("NOT_FOUND");
    if (recipient === undefined) throw new Error("NOT_FOUND");
    const administrator = await tx.roleProfile.findUniqueOrThrow({
      where: { workspaceId_normalizedLabel: { normalizedLabel: "administrator", workspaceId: input.workspaceId } },
    });
    await tx.membership.update({ where: { id: actor.id }, data: { isOwner: false, roleProfileId: administrator.id } });
    await tx.membership.update({ where: { id: recipient.id }, data: { isOwner: true, roleProfileId: null } });
    await tx.workspace.update({ where: { id: input.workspaceId }, data: { ownerMembershipId: recipient.id } });
    await repositories.audit.append({
      actionCode: "workspace.owner-transferred",
      actor: { kind: "user", userId: input.actorUserId },
      correlationId: input.correlationId,
      description: "Workspace ownership transferred.",
      metadata: { recipientUserId: input.recipientUserId },
      subjectId: input.workspaceId,
      subjectType: "workspace",
      workspaceOpaqueId: input.workspaceId,
    });
  });
}

export async function deleteWorkspace(
  prisma: PrismaClient,
  input: Readonly<{ actorUserId: string; confirmationSlug: string; correlationId: string; workspaceId: string }>,
): Promise<boolean> {
  return runSerializableTransaction(prisma, async (repositories) => {
    const tx = repositories.transaction;
    const membership = await tx.membership.findUnique({
      include: { workspace: true },
      where: { workspaceId_userId: { userId: input.actorUserId, workspaceId: input.workspaceId } },
    });
    if (membership?.isOwner !== true) return false;
    if (membership.workspace.slug !== input.confirmationSlug) throw new Error("VALIDATION_FAILED:confirmationSlug");
    await repositories.audit.append({
      actionCode: "workspace.deleted",
      actor: { kind: "user", userId: input.actorUserId },
      correlationId: input.correlationId,
      description: "Workspace deleted.",
      metadata: {},
      subjectId: input.workspaceId,
      subjectType: "workspace",
      workspaceOpaqueId: input.workspaceId,
    });
    await tx.workspace.delete({ where: { id: input.workspaceId } });
    return true;
  });
}
