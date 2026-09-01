import "server-only";

import {
  issueInvitation,
  markInvitationDelivery,
  resendInvitation,
  type IssuedInvitation,
  type PersistenceClient,
} from "@kernel-zero/persistence";

import type { KernelZeroConfig } from "../config/config";
import type { IdentityEmailSender } from "../identity/email";
import { requireCapability, type WorkspaceAuthoritySource } from "../authorization/workspace";

export type InvitationActor = WorkspaceAuthoritySource & Readonly<{
  email: string;
  userId: string;
}>;

export class InvitationService {
  readonly #config: KernelZeroConfig;
  readonly #emailSender: IdentityEmailSender;
  readonly #prisma: PersistenceClient;

  constructor(prisma: PersistenceClient, config: KernelZeroConfig, emailSender: IdentityEmailSender) {
    this.#config = config;
    this.#emailSender = emailSender;
    this.#prisma = prisma;
  }

  async issue(input: Readonly<{
    actor: InvitationActor;
    correlationId: string;
    email: string;
    roleProfileId: string;
    seatLimit: number | null;
    workspaceId: string;
  }>): Promise<IssuedInvitation> {
    const denied = requireCapability(input.actor, "member.invite");
    if (denied !== null) throw new Error(denied.code);
    const invitation = await issueInvitation(this.#prisma, {
      actorEmail: input.actor.email,
      actorUserId: input.actor.userId,
      correlationId: input.correlationId,
      displayEmail: input.email,
      roleProfileId: input.roleProfileId,
      seatLimit: input.seatLimit,
      workspaceId: input.workspaceId,
    });
    await this.#deliver(input.email, input.workspaceId, invitation);
    return invitation;
  }

  async resend(input: Readonly<{
    actor: InvitationActor;
    correlationId: string;
    email: string;
    invitationId: string;
    workspaceId: string;
  }>): Promise<IssuedInvitation> {
    const denied = requireCapability(input.actor, "member.invite");
    if (denied !== null) throw new Error(denied.code);
    const invitation = await resendInvitation(this.#prisma, {
      actorUserId: input.actor.userId,
      correlationId: input.correlationId,
      invitationId: input.invitationId,
      workspaceId: input.workspaceId,
    });
    await this.#deliver(input.email, input.workspaceId, invitation);
    return invitation;
  }

  async #deliver(email: string, workspaceId: string, invitation: IssuedInvitation): Promise<void> {
    const actionUrl = new URL(`/join/${encodeURIComponent(invitation.token)}`, this.#config.appUrl).toString();
    try {
      await this.#emailSender.send({ actionUrl, kind: "invitation", recipient: email });
      await markInvitationDelivery(this.#prisma, workspaceId, invitation.invitationId, true);
    } catch {
      await markInvitationDelivery(this.#prisma, workspaceId, invitation.invitationId, false);
    }
  }
}
