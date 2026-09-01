import "server-only";

import type { Prisma } from "@prisma/client";
import {
  generateUuidV7,
  isCorrelationId,
  isSha256Digest,
  sha256,
  type DowngradeUsage,
  type PlanName,
} from "@kernel-zero/domain";

import { createAuditRepository } from "./audit";
import type { PersistenceClient, TransactionClient } from "./client";

const PROVIDER = "stripe";
const GRACE_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

export type NormalizedPaymentEvent = Readonly<{
  cancelAtPeriodEnd?: boolean;
  customerId?: string;
  eventId: string;
  eventType: string;
  periodEnd?: Date;
  periodStart?: Date;
  priceId?: string;
  providerCreatedAt: Date;
  status?: string;
  subscriptionId?: string;
}>;

export type PaymentProjectionResult =
  | Readonly<{ kind: "applied" | "ignored" | "stale"; receiptId: string }>
  | Readonly<{ kind: "duplicate"; receiptId: string; state: string }>
  | Readonly<{ kind: "quarantined"; reason: string; receiptId: string }>;

export type IngestPaymentEventInput = Readonly<{
  correlationId: string;
  event: NormalizedPaymentEvent;
  payloadDigest: string;
  resolvePlan: (priceId: string) => PlanName | null;
}>;

export type WorkspaceBillingState = Readonly<{
  customerId: string | null;
  subscriptionId: string | null;
}>;

export type TrialEligibility = Readonly<{ eligible: boolean }>;

type StoredReceipt = Readonly<{
  correlationId: string;
  eventId: string;
  eventType: string;
  id: string;
  payloadDigest: string;
  providerCreatedAt: Date;
  replayFields: Prisma.JsonValue;
  state: string;
}>;

export async function readWorkspaceBilling(client: PersistenceClient, workspaceId: string): Promise<WorkspaceBillingState> {
  const workspace = await client.workspace.findUnique({
    select: { stripeCustomerId: true, subscription: { select: { subscriptionId: true } } },
    where: { id: workspaceId },
  });
  return Object.freeze({
    customerId: workspace?.stripeCustomerId ?? null,
    subscriptionId: workspace?.subscription?.subscriptionId ?? null,
  });
}

export async function readDowngradeUsage(
  client: PersistenceClient,
  workspaceId: string,
  now = new Date(),
): Promise<DowngradeUsage> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const [memberships, pendingInvitations, activePolicyPacks, evidenceRunsThisMonth] = await Promise.all([
    client.membership.count({ where: { workspaceId } }),
    client.invitation.count({ where: { status: "active", workspaceId } }),
    client.policyPack.count({ where: { lifecycleState: "active", workspaceId } }),
    client.evidenceRun.count({ where: { createdAt: { gte: monthStart, lt: nextMonth }, workspaceId } }),
  ]);
  return Object.freeze({
    activePolicyPacks,
    evidenceRunsThisMonth,
    occupiedSeats: memberships + pendingInvitations,
  });
}

export async function readTrialEligibility(
  client: PersistenceClient,
  userId: string,
  providerFingerprint: string,
): Promise<TrialEligibility> {
  const fingerprintHash = sha256(providerFingerprint);
  const [user, usedFingerprint] = await Promise.all([
    client.user.findUnique({ select: { trialUsed: true }, where: { id: userId } }),
    client.trialFingerprint.findFirst({ select: { id: true }, where: { fingerprintHash, used: true } }),
  ]);
  return Object.freeze({ eligible: user?.trialUsed === false && usedFingerprint === null });
}

export async function markTrialUsed(
  client: PersistenceClient,
  userId: string,
  providerFingerprint: string | null,
): Promise<void> {
  const fingerprintHash = providerFingerprint === null ? null : sha256(providerFingerprint);
  await client.$transaction(async (tx) => {
    await tx.user.updateMany({ data: { trialUsed: true }, where: { id: userId, trialUsed: false } });
    if (fingerprintHash !== null) {
      await tx.trialFingerprint.upsert({
        create: { fingerprintHash, id: generateUuidV7(), used: true, userId },
        update: { used: true },
        where: { userId_fingerprintHash: { fingerprintHash, userId } },
      });
    }
  });
}

export async function ingestPaymentEvent(
  client: PersistenceClient,
  input: IngestPaymentEventInput,
): Promise<PaymentProjectionResult> {
  validateIngress(input);
  const stored = await storeReceipt(client, input);
  if (stored.kind === "duplicate") return stored.result;
  return projectStoredReceipt(client, stored.receipt, input.event, input.resolvePlan);
}

export async function retryPaymentEvent(
  client: PersistenceClient,
  provider: string,
  eventId: string,
  resolvePlan: (priceId: string) => PlanName | null,
): Promise<PaymentProjectionResult> {
  const receipt = await client.paymentEventReceipt.findUnique({ where: { provider_eventId: { eventId, provider } } });
  if (receipt === null) throw failure("NOT_FOUND", "payment_event");
  if (receipt.state !== "quarantined" && receipt.state !== "received") {
    return { kind: "duplicate", receiptId: receipt.id, state: receipt.state };
  }
  const event = replayEvent(receipt);
  await client.paymentEventReceipt.update({
    data: { quarantineReason: null, retryCount: { increment: 1 }, state: "received" },
    where: { id: receipt.id },
  });
  return projectStoredReceipt(client, receipt, event, resolvePlan);
}

async function storeReceipt(
  client: PersistenceClient,
  input: IngestPaymentEventInput,
): Promise<Readonly<{ kind: "created"; receipt: StoredReceipt }> | Readonly<{ kind: "duplicate"; result: PaymentProjectionResult }>> {
  try {
    const receipt = await client.paymentEventReceipt.create({
      data: {
        correlationId: input.correlationId,
        eventId: input.event.eventId,
        eventType: safeBounded(input.event.eventType, 120),
        id: generateUuidV7(),
        payloadDigest: input.payloadDigest,
        provider: PROVIDER,
        providerCreatedAt: input.event.providerCreatedAt,
        replayFields: replayFields(input.event),
      },
    });
    return {
      kind: "created",
      receipt: {
        correlationId: input.correlationId,
        eventId: input.event.eventId,
        eventType: input.event.eventType,
        id: receipt.id,
        payloadDigest: input.payloadDigest,
        providerCreatedAt: input.event.providerCreatedAt,
        replayFields: replayFields(input.event) as Prisma.JsonValue,
        state: receipt.state,
      },
    };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const existing = await client.paymentEventReceipt.findUnique({
      where: { provider_eventId: { eventId: input.event.eventId, provider: PROVIDER } },
    });
    if (existing === null) throw error;
    if (!sameReceipt(existing, input)) {
      await client.paymentEventReceipt.update({
        data: { projectionResult: "event_identity_conflict", quarantineReason: "event_identity_conflict", state: "quarantined" },
        where: { id: existing.id },
      });
      return { kind: "duplicate", result: { kind: "quarantined", reason: "event_identity_conflict", receiptId: existing.id } };
    }
    if (existing.state === "received") return { kind: "created", receipt: existing };
    return { kind: "duplicate", result: { kind: "duplicate", receiptId: existing.id, state: existing.state } };
  }
}

async function projectStoredReceipt(
  client: PersistenceClient,
  receipt: StoredReceipt,
  event: NormalizedPaymentEvent,
  resolvePlan: (priceId: string) => PlanName | null,
): Promise<PaymentProjectionResult> {
  if (event.eventType === "customer.subscription.trial_will_end" || !isProjectedType(event.eventType)) {
    await client.paymentEventReceipt.update({
      data: { projectionResult: event.eventType === "customer.subscription.trial_will_end" ? "notification_only" : "event_type_ignored", state: "ignored" },
      where: { id: receipt.id },
    });
    return { kind: "ignored", receiptId: receipt.id };
  }
  return client.$transaction(async (tx) => {
    const resolved = await resolveProjection(tx, event, resolvePlan);
    if (resolved.kind === "quarantined") {
      await finishReceipt(tx, receipt.id, "quarantined", resolved.reason, resolved.reason);
      return { kind: "quarantined", reason: resolved.reason, receiptId: receipt.id };
    }
    if (isStale(resolved.projection, event)) {
      await finishReceipt(tx, receipt.id, "stale", "event_precedes_projection_cursor", null);
      return { kind: "stale", receiptId: receipt.id };
    }
    const actionCode = await applyProjection(tx, resolved.workspaceId, resolved.projection, event, resolved.plan);
    await finishReceipt(tx, receipt.id, "applied", actionCode, null, resolved.workspaceId);
    await createAuditRepository(tx).append({
      actionCode,
      actor: { kind: "system", reference: "billing-provider" },
      correlationId: receipt.correlationId,
      description: "A signed billing event updated the subscription projection.",
      metadata: { eventId: event.eventId, eventType: event.eventType, provider: PROVIDER },
      subjectId: event.subscriptionId ?? event.eventId,
      subjectType: "subscription-projection",
      workspaceOpaqueId: resolved.workspaceId,
    });
    return { kind: "applied", receiptId: receipt.id };
  });
}

type ProjectionRow = Readonly<{
  customerId: string | null;
  lastProviderCreatedAt: Date | null;
  lastProviderEventId: string | null;
  providerStatus?: string;
  subscriptionId: string | null;
  workspaceId: string;
}>;

type ProjectionResolution =
  | Readonly<{ kind: "quarantined"; reason: string }>
  | Readonly<{ kind: "resolved"; plan: PlanName | null; projection: ProjectionRow | null; workspaceId: string }>;

async function resolveProjection(
  tx: TransactionClient,
  event: NormalizedPaymentEvent,
  resolvePlan: (priceId: string) => PlanName | null,
): Promise<ProjectionResolution> {
  if (event.customerId === undefined) return { kind: "quarantined", reason: "customer_mapping_missing" };
  if (event.subscriptionId === undefined) return { kind: "quarantined", reason: "subscription_mapping_missing" };
  const projection = await tx.subscriptionProjection.findFirst({
    where: { OR: [{ subscriptionId: event.subscriptionId }, { customerId: event.customerId }] },
  }) as ProjectionRow | null;
  if (isSubscriptionChange(event.eventType)) {
    if (event.priceId === undefined) return { kind: "quarantined", reason: "price_mapping_missing" };
    const plan = resolvePlan(event.priceId);
    if (plan === null) return { kind: "quarantined", reason: "price_mapping_missing" };
    const workspace = await tx.workspace.findFirst({ select: { id: true }, where: { stripeCustomerId: event.customerId } });
    const workspaceId = workspace?.id ?? projection?.workspaceId;
    if (workspaceId === undefined) return { kind: "quarantined", reason: "workspace_mapping_missing" };
    return { kind: "resolved", plan, projection, workspaceId };
  }
  if (projection === null) return { kind: "quarantined", reason: "subscription_mapping_missing" };
  return { kind: "resolved", plan: null, projection, workspaceId: projection.workspaceId };
}

async function applyProjection(
  tx: TransactionClient,
  workspaceId: string,
  projection: ProjectionRow | null,
  event: NormalizedPaymentEvent,
  plan: PlanName | null,
): Promise<string> {
  const cursor = { lastProviderCreatedAt: event.providerCreatedAt, lastProviderEventId: event.eventId };
  if (isSubscriptionChange(event.eventType)) {
    if (plan === null || event.customerId === undefined || event.subscriptionId === undefined || event.priceId === undefined || event.status === undefined) {
      throw failure("VALIDATION_FAILED", "subscription_event");
    }
    const deleted = event.eventType === "customer.subscription.deleted";
    const providerStatus = deleted ? "canceled" : event.status;
    const entitlementState: "open" | "paid" = providerStatus === "active" || providerStatus === "trialing" ? "paid" : "open";
    const data = {
      cancelAtPeriodEnd: event.cancelAtPeriodEnd ?? false,
      currentPeriodEnd: event.periodEnd ?? null,
      currentPeriodStart: event.periodStart ?? null,
      customerId: event.customerId,
      entitlementState,
      graceExpiresAt: null,
      plan,
      priceId: event.priceId,
      providerStatus,
      subscriptionId: event.subscriptionId,
      ...cursor,
    };
    await tx.subscriptionProjection.upsert({
      create: { id: generateUuidV7(), provider: PROVIDER, workspaceId, ...data },
      update: data,
      where: { workspaceId },
    });
    return deleted ? "billing.subscription.canceled" : "billing.subscription.projected";
  }
  if (projection === null) throw failure("CONFLICT", "subscription_projection");
  if (event.eventType === "invoice.payment_failed") {
    await tx.subscriptionProjection.update({
      data: {
        entitlementState: "grace",
        graceExpiresAt: new Date(event.providerCreatedAt.getTime() + GRACE_MILLISECONDS),
        providerStatus: "past_due",
        ...cursor,
      },
      where: { workspaceId },
    });
    return "billing.invoice.payment_failed";
  }
  const clearGrace = projection.providerStatus === "active" || projection.providerStatus === "trialing";
  await tx.subscriptionProjection.update({
    data: { ...(clearGrace ? { entitlementState: "paid" as const, graceExpiresAt: null } : {}), ...cursor },
    where: { workspaceId },
  });
  return "billing.invoice.paid";
}

async function finishReceipt(
  tx: TransactionClient,
  receiptId: string,
  state: "applied" | "quarantined" | "stale",
  projectionResult: string,
  quarantineReason: string | null,
  workspaceId?: string,
): Promise<void> {
  await tx.paymentEventReceipt.update({
    data: { projectionResult, quarantineReason, state, ...(workspaceId === undefined ? {} : { workspaceId }) },
    where: { id: receiptId },
  });
}

function isStale(projection: ProjectionRow | null, event: NormalizedPaymentEvent): boolean {
  if (projection?.lastProviderCreatedAt === null || projection?.lastProviderCreatedAt === undefined) return false;
  const current = projection.lastProviderCreatedAt.getTime();
  const incoming = event.providerCreatedAt.getTime();
  return incoming < current || (incoming === current && event.eventId <= (projection.lastProviderEventId ?? ""));
}

function replayFields(event: NormalizedPaymentEvent): Prisma.InputJsonValue {
  return {
    ...(event.cancelAtPeriodEnd === undefined ? {} : { cancelAtPeriodEnd: event.cancelAtPeriodEnd }),
    ...(event.customerId === undefined ? {} : { customerId: event.customerId }),
    ...(event.periodEnd === undefined ? {} : { periodEnd: event.periodEnd.toISOString() }),
    ...(event.periodStart === undefined ? {} : { periodStart: event.periodStart.toISOString() }),
    ...(event.priceId === undefined ? {} : { priceId: event.priceId }),
    ...(event.status === undefined ? {} : { status: event.status }),
    ...(event.subscriptionId === undefined ? {} : { subscriptionId: event.subscriptionId }),
  };
}

function replayEvent(receipt: StoredReceipt): NormalizedPaymentEvent {
  if (!plainObject(receipt.replayFields)) throw failure("VALIDATION_FAILED", "replay_fields");
  const fields = receipt.replayFields;
  return {
    eventId: receipt.eventId,
    eventType: receipt.eventType,
    providerCreatedAt: receipt.providerCreatedAt,
    ...(typeof fields.cancelAtPeriodEnd === "boolean" ? { cancelAtPeriodEnd: fields.cancelAtPeriodEnd } : {}),
    ...(typeof fields.customerId === "string" ? { customerId: fields.customerId } : {}),
    ...(typeof fields.periodEnd === "string" ? { periodEnd: validDate(fields.periodEnd) } : {}),
    ...(typeof fields.periodStart === "string" ? { periodStart: validDate(fields.periodStart) } : {}),
    ...(typeof fields.priceId === "string" ? { priceId: fields.priceId } : {}),
    ...(typeof fields.status === "string" ? { status: fields.status } : {}),
    ...(typeof fields.subscriptionId === "string" ? { subscriptionId: fields.subscriptionId } : {}),
  };
}

function validDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw failure("VALIDATION_FAILED", "replay_date");
  return parsed;
}

function validateIngress(input: IngestPaymentEventInput): void {
  if (!isCorrelationId(input.correlationId)) throw failure("VALIDATION_FAILED", "correlationId");
  if (!isSha256Digest(input.payloadDigest)) throw failure("VALIDATION_FAILED", "payloadDigest");
  if (!bounded(input.event.eventId, 255) || !bounded(input.event.eventType, 120)) throw failure("VALIDATION_FAILED", "event_identity");
  if (Number.isNaN(input.event.providerCreatedAt.getTime())) throw failure("VALIDATION_FAILED", "providerCreatedAt");
}

function sameReceipt(receipt: StoredReceipt, input: IngestPaymentEventInput): boolean {
  return receipt.payloadDigest === input.payloadDigest &&
    receipt.eventType === input.event.eventType &&
    receipt.providerCreatedAt.getTime() === input.event.providerCreatedAt.getTime();
}

function isProjectedType(eventType: string): boolean {
  return isSubscriptionChange(eventType) || eventType === "invoice.payment_failed" || eventType === "invoice.paid";
}

function isSubscriptionChange(eventType: string): boolean {
  return eventType === "customer.subscription.created" ||
    eventType === "customer.subscription.updated" ||
    eventType === "customer.subscription.deleted";
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function plainObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bounded(value: string, maximum: number): boolean {
  return value.length >= 1 && value.length <= maximum;
}

function safeBounded(value: string, maximum: number): string {
  return bounded(value, maximum) ? value : value.slice(0, maximum);
}

function failure(code: string, reason: string): Error & { code: string; reason: string } {
  return Object.assign(new Error(`${code}:${reason}`), { code, reason });
}
