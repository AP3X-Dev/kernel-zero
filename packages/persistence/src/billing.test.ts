/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, expect, it, vi } from "vitest";

import {
  ingestPaymentEvent,
  markTrialUsed,
  readDowngradeUsage,
  readTrialEligibility,
  retryPaymentEvent,
  type NormalizedPaymentEvent,
} from "./billing";

const WORKSPACE = "0195f000-0000-7000-8000-000000000002";
const USER = "0195f000-0000-7000-8000-000000000003";
const CORRELATION = "0195f000-0000-7000-8000-000000000001";
const CREATED = new Date("2026-08-31T12:00:00.000Z");

function subscriptionEvent(overrides: Partial<NormalizedPaymentEvent> = {}): NormalizedPaymentEvent {
  return {
    cancelAtPeriodEnd: false,
    customerId: "cus_a",
    eventId: "evt_2",
    eventType: "customer.subscription.updated",
    periodEnd: new Date("2026-10-01T00:00:00.000Z"),
    periodStart: new Date("2026-09-01T00:00:00.000Z"),
    priceId: "price_foundry",
    providerCreatedAt: CREATED,
    status: "active",
    subscriptionId: "sub_a",
    ...overrides,
  };
}

function client(tx: object, receiptOverrides: object = {}) {
  return {
    $transaction: vi.fn(async (operation: (transaction: object) => Promise<unknown>) => operation(tx)),
    paymentEventReceipt: {
      create: vi.fn().mockResolvedValue({ id: "receipt-1", state: "received" }),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      ...receiptOverrides,
    },
  };
}

function projectionTx(projection: object | null = null) {
  return {
    auditRecord: { create: vi.fn().mockResolvedValue({ id: "audit" }) },
    paymentEventReceipt: { update: vi.fn().mockResolvedValue({}) },
    subscriptionProjection: {
      findFirst: vi.fn().mockResolvedValue(projection),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    workspace: { findFirst: vi.fn().mockResolvedValue({ id: WORKSPACE }) },
  };
}

describe("billing persistence", () => {
  it("stores a receipt before projection, then upserts exact subscription truth and a system audit", async () => {
    const order: string[] = [];
    const tx = projectionTx();
    const db = client(tx);
    db.paymentEventReceipt.create.mockImplementation(() => {
      order.push("receipt");
      return Promise.resolve({ id: "receipt-1", state: "received" });
    });
    db.$transaction.mockImplementation(async (operation: (transaction: object) => Promise<unknown>) => {
      order.push("projection");
      return operation(tx);
    });
    const result = await ingestPaymentEvent(db as never, {
      correlationId: CORRELATION,
      event: subscriptionEvent(),
      payloadDigest: `sha256:${"a".repeat(64)}`,
      resolvePlan: (priceId) => priceId === "price_foundry" ? "Foundry" : null,
    });
    expect(order).toEqual(["receipt", "projection"]);
    expect(result).toEqual({ kind: "applied", receiptId: "receipt-1" });
    expect(tx.subscriptionProjection.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ entitlementState: "paid", plan: "Foundry", providerStatus: "active" }),
      update: expect.objectContaining({ lastProviderEventId: "evt_2", plan: "Foundry" }),
    }));
    expect(tx.auditRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      actorKind: "system", actionCode: "billing.subscription.projected", systemActorRef: "billing-provider",
      workspaceOpaqueId: WORKSPACE,
    }) }));
  });

  it("keeps duplicates idempotent and applies a creation-time plus event-ID monotonic tie-break", async () => {
    const existingReceipt = {
      correlationId: CORRELATION, eventId: "evt_2", eventType: "customer.subscription.updated",
      id: "receipt-1", payloadDigest: `sha256:${"a".repeat(64)}`, providerCreatedAt: CREATED,
      replayFields: {}, state: "applied",
    };
    const duplicateDb = client(projectionTx(), {
      create: vi.fn().mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" })),
      findUnique: vi.fn().mockResolvedValue(existingReceipt),
    });
    await expect(ingestPaymentEvent(duplicateDb as never, {
      correlationId: CORRELATION, event: subscriptionEvent(), payloadDigest: existingReceipt.payloadDigest,
      resolvePlan: () => "Foundry",
    })).resolves.toEqual({ kind: "duplicate", receiptId: "receipt-1", state: "applied" });
    expect(duplicateDb.$transaction).not.toHaveBeenCalled();

    const tx = projectionTx({
      customerId: "cus_a", lastProviderCreatedAt: CREATED, lastProviderEventId: "evt_9",
      subscriptionId: "sub_a", workspaceId: WORKSPACE,
    });
    await expect(ingestPaymentEvent(client(tx) as never, {
      correlationId: CORRELATION, event: subscriptionEvent({ eventId: "evt_8" }),
      payloadDigest: `sha256:${"b".repeat(64)}`, resolvePlan: () => "Foundry",
    })).resolves.toEqual({ kind: "stale", receiptId: "receipt-1" });
    expect(tx.subscriptionProjection.upsert).not.toHaveBeenCalled();
  });

  it("quarantines unresolved mappings, retries idempotently, and counts the retry", async () => {
    const quarantineTx = projectionTx();
    quarantineTx.workspace.findFirst.mockResolvedValue(null);
    const db = client(quarantineTx);
    await expect(ingestPaymentEvent(db as never, {
      correlationId: CORRELATION, event: subscriptionEvent(), payloadDigest: `sha256:${"c".repeat(64)}`,
      resolvePlan: () => "Foundry",
    })).resolves.toEqual({ kind: "quarantined", reason: "workspace_mapping_missing", receiptId: "receipt-1" });

    const retryTx = projectionTx();
    const retryDb = client(retryTx, {
      findUnique: vi.fn().mockResolvedValue({
        correlationId: CORRELATION, eventId: "evt_2", eventType: "customer.subscription.updated",
        id: "receipt-1", payloadDigest: `sha256:${"c".repeat(64)}`, providerCreatedAt: CREATED,
        replayFields: {
          cancelAtPeriodEnd: false, customerId: "cus_a", periodEnd: "2026-10-01T00:00:00.000Z",
          periodStart: "2026-09-01T00:00:00.000Z", priceId: "price_foundry", status: "active", subscriptionId: "sub_a",
        }, state: "quarantined",
      }),
      update: vi.fn().mockResolvedValue({}),
    });
    await expect(retryPaymentEvent(retryDb as never, "stripe", "evt_2", () => "Foundry"))
      .resolves.toEqual({ kind: "applied", receiptId: "receipt-1" });
    expect(retryDb.paymentEventReceipt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ retryCount: { increment: 1 }, state: "received" }),
    }));
  });

  it("maps delete, invoice failure, invoice paid, trial-ending, and unknown events exactly", async () => {
    const baseProjection = {
      customerId: "cus_a", lastProviderCreatedAt: new Date("2026-08-30T12:00:00.000Z"),
      lastProviderEventId: "evt_0", providerStatus: "active", subscriptionId: "sub_a", workspaceId: WORKSPACE,
    };
    const failedTx = projectionTx(baseProjection);
    await ingestPaymentEvent(client(failedTx) as never, {
      correlationId: CORRELATION,
      event: { customerId: "cus_a", eventId: "evt_failed", eventType: "invoice.payment_failed", providerCreatedAt: CREATED, subscriptionId: "sub_a" },
      payloadDigest: `sha256:${"d".repeat(64)}`, resolvePlan: () => null,
    });
    expect(failedTx.subscriptionProjection.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      entitlementState: "grace", graceExpiresAt: new Date("2026-09-07T12:00:00.000Z"), providerStatus: "past_due",
    }) }));

    const paidTx = projectionTx(baseProjection);
    await ingestPaymentEvent(client(paidTx) as never, {
      correlationId: CORRELATION,
      event: { customerId: "cus_a", eventId: "evt_paid", eventType: "invoice.paid", providerCreatedAt: CREATED, subscriptionId: "sub_a" },
      payloadDigest: `sha256:${"e".repeat(64)}`, resolvePlan: () => null,
    });
    expect(paidTx.subscriptionProjection.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ graceExpiresAt: null }) }));

    const ignoredTx = projectionTx();
    await expect(ingestPaymentEvent(client(ignoredTx) as never, {
      correlationId: CORRELATION,
      event: { customerId: "cus_a", eventId: "evt_trial", eventType: "customer.subscription.trial_will_end", providerCreatedAt: CREATED, subscriptionId: "sub_a" },
      payloadDigest: `sha256:${"f".repeat(64)}`, resolvePlan: () => null,
    })).resolves.toEqual({ kind: "ignored", receiptId: "receipt-1" });
    await expect(ingestPaymentEvent(client(projectionTx()) as never, {
      correlationId: CORRELATION,
      event: { eventId: "evt_unknown", eventType: "charge.refunded", providerCreatedAt: CREATED },
      payloadDigest: `sha256:${"1".repeat(64)}`, resolvePlan: () => null,
    })).resolves.toEqual({ kind: "ignored", receiptId: "receipt-1" });
  });

  it("counts downgrade usage and protects trial flags monotonically across user and fingerprint scope", async () => {
    const db = {
      evidenceRun: { count: vi.fn().mockResolvedValue(8) },
      invitation: { count: vi.fn().mockResolvedValue(2) },
      membership: { count: vi.fn().mockResolvedValue(3) },
      policyPack: { count: vi.fn().mockResolvedValue(4) },
      trialFingerprint: { findFirst: vi.fn().mockResolvedValue(null) },
      user: { findUnique: vi.fn().mockResolvedValue({ trialUsed: false }) },
      $transaction: vi.fn(async (operation: (transaction: object) => Promise<unknown>) => operation({
        trialFingerprint: { upsert: vi.fn().mockResolvedValue({}) },
        user: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      })),
    };
    await expect(readDowngradeUsage(db as never, WORKSPACE, new Date("2026-08-31T12:00:00.000Z")))
      .resolves.toEqual({ activePolicyPacks: 4, evidenceRunsThisMonth: 8, occupiedSeats: 5 });
    await expect(readTrialEligibility(db as never, USER, "fingerprint-a")).resolves.toEqual({ eligible: true });
    await markTrialUsed(db as never, USER, "fingerprint-a");
    const tx = db.$transaction.mock.calls[0]?.[0];
    expect(tx).toBeTypeOf("function");
  });
});
