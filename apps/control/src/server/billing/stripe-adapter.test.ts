import { beforeEach, describe, expect, it, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({
  customers: { update: vi.fn() },
  paymentMethods: { detach: vi.fn(), list: vi.fn(), retrieve: vi.fn() },
  prices: { list: vi.fn() },
  subscriptions: { create: vi.fn(), retrieve: vi.fn(), update: vi.fn() },
  webhooks: { constructEvent: vi.fn() },
}));

vi.mock("stripe", () => ({ default: vi.fn(() => stripeMock) }));

import { BillingProviderError, BillingSignatureError } from "./errors";
import { createStripeBillingAdapter } from "./stripe-adapter";

const WORKSPACE = "0195f000-0000-7000-8000-000000000002";
const price = { active: true, currency: "usd", id: "price_workshop_month", recurring: { interval: "month" }, unit_amount: 2_500 };

function adapter() {
  return createStripeBillingAdapter({ enabled: true, secretKey: "sk_test_fixture", webhookSecret: "whsec_fixture" });
}

function command(overrides: Partial<Parameters<ReturnType<typeof adapter>["changeSubscription"]>[0]> = {}) {
  return {
    customerId: "cus_a", idempotencyKey: `${WORKSPACE}:op-1`, interval: "month" as const, paymentMethodId: "pm_a",
    plan: "Workshop" as const, promisedTrial: false, subscriptionId: null, workspaceId: WORKSPACE, ...overrides,
  };
}

beforeEach(() => {
  for (const group of Object.values(stripeMock)) for (const fn of Object.values(group)) fn.mockReset();
  stripeMock.prices.list.mockResolvedValue({ data: [price] });
});

describe("Stripe adapter subscription commands", () => {
  it("cancels at period end for Open with a subscription and issues a local command id without one", async () => {
    stripeMock.subscriptions.update.mockResolvedValue({ id: "sub_a" });
    await expect(adapter().changeSubscription(command({ plan: "Open", subscriptionId: "sub_a" }))).resolves.toEqual({ commandId: "sub_a" });
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith("sub_a", { cancel_at_period_end: true }, { idempotencyKey: `${WORKSPACE}:op-1` });
    await expect(adapter().changeSubscription(command({ plan: "Open" }))).resolves.toEqual({ commandId: `open:${WORKSPACE}` });
    expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
  });

  it("creates a paid subscription by lookup key, carrying the trial only when promised", async () => {
    stripeMock.subscriptions.create.mockResolvedValue({ id: "sub_new" });
    await expect(adapter().changeSubscription(command({ promisedTrial: true }))).resolves.toEqual({ commandId: "sub_new" });
    expect(stripeMock.prices.list).toHaveBeenCalledWith({ active: true, limit: 1, lookup_keys: ["kernel-zero-workshop-month"] });
    expect(stripeMock.subscriptions.create).toHaveBeenCalledWith({
      customer: "cus_a", default_payment_method: "pm_a", items: [{ price: "price_workshop_month" }], metadata: { workspace_id: WORKSPACE }, trial_period_days: 14,
    }, { idempotencyKey: `${WORKSPACE}:op-1` });
    await adapter().changeSubscription(command());
    expect(stripeMock.subscriptions.create).toHaveBeenLastCalledWith(expect.not.objectContaining({ trial_period_days: 14 }), expect.anything());
  });

  it("updates an existing subscription in place with prorations and clears a pending cancellation", async () => {
    stripeMock.prices.list.mockResolvedValue({ data: [{ ...price, id: "price_workshop_year", recurring: { interval: "year" } }] });
    stripeMock.subscriptions.retrieve.mockResolvedValue({ items: { data: [{ id: "si_1" }] } });
    stripeMock.subscriptions.update.mockResolvedValue({ id: "sub_a" });
    await expect(adapter().changeSubscription(command({ interval: "year", subscriptionId: "sub_a" }))).resolves.toEqual({ commandId: "sub_a" });
    expect(stripeMock.prices.list).toHaveBeenCalledWith({ active: true, limit: 1, lookup_keys: ["kernel-zero-workshop-year"] });
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith("sub_a", {
      cancel_at_period_end: false, default_payment_method: "pm_a", items: [{ id: "si_1", price: "price_workshop_year" }], proration_behavior: "create_prorations",
    }, { idempotencyKey: `${WORKSPACE}:op-1` });
  });

  it("surfaces missing prices, empty subscriptions, and provider failures as retryable provider errors", async () => {
    stripeMock.prices.list.mockResolvedValue({ data: [] });
    await expect(adapter().changeSubscription(command())).rejects.toThrow(BillingProviderError);
    stripeMock.prices.list.mockResolvedValue({ data: [{ ...price, recurring: { interval: "year" } }] });
    await expect(adapter().changeSubscription(command())).rejects.toThrow("The requested billing price is unavailable.");
    stripeMock.prices.list.mockResolvedValue({ data: [price] });
    stripeMock.subscriptions.retrieve.mockResolvedValue({ items: { data: [] } });
    await expect(adapter().changeSubscription(command({ subscriptionId: "sub_a" }))).rejects.toThrow("The subscription has no billable item.");
    stripeMock.subscriptions.create.mockRejectedValue(new Error("stripe down"));
    const failure = await adapter().changeSubscription(command()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BillingProviderError);
    expect(failure).toMatchObject({ code: "PROVIDER_UNAVAILABLE", message: "stripe down", retryable: true });
  });
});

describe("Stripe adapter payment methods and prices", () => {
  it("lists only card methods with a resolvable customer and maps both customer shapes", async () => {
    stripeMock.paymentMethods.list.mockResolvedValue({ data: [
      { card: { brand: "visa", exp_month: 12, exp_year: 2030, last4: "4242" }, customer: "cus_a", id: "pm_a" },
      { card: { brand: "amex", exp_month: 1, exp_year: 2031, last4: "0005" }, customer: { id: "cus_b" }, id: "pm_b" },
      { card: { brand: "visa", exp_month: 1, exp_year: 2031, last4: "1111" }, customer: null, id: "pm_orphan" },
      { customer: "cus_a", id: "pm_bank" },
    ] });
    await expect(adapter().listPaymentMethods("cus_a")).resolves.toEqual([
      { brand: "visa", customerId: "cus_a", expiryMonth: 12, expiryYear: 2030, id: "pm_a", last4: "4242" },
      { brand: "amex", customerId: "cus_b", expiryMonth: 1, expiryYear: 2031, id: "pm_b", last4: "0005" },
    ]);
    expect(stripeMock.paymentMethods.list).toHaveBeenCalledWith({ customer: "cus_a", limit: 100, type: "card" });
    stripeMock.paymentMethods.list.mockRejectedValue(new Error("nope"));
    await expect(adapter().listPaymentMethods("cus_a")).rejects.toThrow(BillingProviderError);
  });

  it("passes idempotency keys through default and detach mutations and reads card fingerprints", async () => {
    stripeMock.customers.update.mockResolvedValue({});
    stripeMock.paymentMethods.detach.mockResolvedValue({});
    stripeMock.paymentMethods.retrieve.mockResolvedValue({ card: { fingerprint: "fp_1" } });
    await adapter().setDefaultPaymentMethod("cus_a", "pm_a", "key-1");
    await adapter().detachPaymentMethod("cus_a", "pm_a", "key-2");
    expect(stripeMock.customers.update).toHaveBeenCalledWith("cus_a", { invoice_settings: { default_payment_method: "pm_a" } }, { idempotencyKey: "key-1" });
    expect(stripeMock.paymentMethods.detach).toHaveBeenCalledWith("pm_a", {}, { idempotencyKey: "key-2" });
    await expect(adapter().fingerprintForPaymentMethod("pm_a")).resolves.toBe("fp_1");
    stripeMock.paymentMethods.retrieve.mockResolvedValue({ card: undefined });
    await expect(adapter().fingerprintForPaymentMethod("pm_a")).resolves.toBeNull();
    stripeMock.customers.update.mockRejectedValue(new Error("down"));
    await expect(adapter().setDefaultPaymentMethod("cus_a", "pm_a", "key-3")).rejects.toThrow(BillingProviderError);
  });

  it("resolves a price only when active, priced, and on the requested interval, and never throws", async () => {
    await expect(adapter().resolvePrice("Workshop", "month")).resolves.toEqual({ amount: 2_500, currency: "usd", id: "price_workshop_month", interval: "month", plan: "Workshop" });
    stripeMock.prices.list.mockResolvedValue({ data: [{ ...price, active: false }] });
    await expect(adapter().resolvePrice("Workshop", "month")).resolves.toBeNull();
    stripeMock.prices.list.mockResolvedValue({ data: [{ ...price, unit_amount: null }] });
    await expect(adapter().resolvePrice("Workshop", "month")).resolves.toBeNull();
    stripeMock.prices.list.mockRejectedValue(new Error("down"));
    await expect(adapter().resolvePrice("Foundry", "year")).resolves.toBeNull();
  });
});

describe("Stripe adapter signed events", () => {
  it("rejects a bad signature with a non-retryable typed error before normalization", () => {
    stripeMock.webhooks.constructEvent.mockImplementation(() => { throw new Error("bad signature"); });
    expect(() => adapter().parseSignedEvent(new TextEncoder().encode("{}"), "sig")).toThrow(BillingSignatureError);
    expect(stripeMock.webhooks.constructEvent).toHaveBeenCalledWith(expect.any(Buffer), "sig", "whsec_fixture");
  });

  it("normalizes subscription events with periods, status, and cancellation, marking deleted as canceled", () => {
    const subscription = {
      cancel_at_period_end: true, customer: { id: "cus_a" }, id: "sub_a",
      items: { data: [{ current_period_end: 1_700_003_600, current_period_start: 1_700_000_000, price: { id: "price_1" } }] },
      status: "active",
    };
    stripeMock.webhooks.constructEvent.mockReturnValue({ created: 1_700_000_100, data: { object: subscription }, id: "evt_1", type: "customer.subscription.deleted" });
    expect(adapter().parseSignedEvent(new Uint8Array(), "sig")).toEqual({
      cancelAtPeriodEnd: true, customerId: "cus_a", eventId: "evt_1", eventType: "customer.subscription.deleted",
      periodEnd: new Date(1_700_003_600_000), periodStart: new Date(1_700_000_000_000), priceId: "price_1",
      providerCreatedAt: new Date(1_700_000_100_000), status: "canceled", subscriptionId: "sub_a",
    });
    stripeMock.webhooks.constructEvent.mockReturnValue({ created: 1, data: { object: { ...subscription, customer: null, items: { data: [] } } }, id: "evt_2", type: "customer.subscription.updated" });
    expect(adapter().parseSignedEvent(new Uint8Array(), "sig")).toEqual({
      cancelAtPeriodEnd: true, eventId: "evt_2", eventType: "customer.subscription.updated", providerCreatedAt: new Date(1_000), status: "active", subscriptionId: "sub_a",
    });
  });

  it("normalizes invoice events to customer and subscription references and leaves unknown events bare", () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      created: 2, data: { object: { customer: "cus_a", parent: { subscription_details: { subscription: { id: "sub_a" } }, type: "subscription_details" } } }, id: "evt_3", type: "invoice.paid",
    });
    expect(adapter().parseSignedEvent(new Uint8Array(), "sig")).toEqual({
      customerId: "cus_a", eventId: "evt_3", eventType: "invoice.paid", providerCreatedAt: new Date(2_000), subscriptionId: "sub_a",
    });
    stripeMock.webhooks.constructEvent.mockReturnValue({ created: 3, data: { object: { customer: null, parent: null } }, id: "evt_4", type: "invoice.payment_failed" });
    expect(adapter().parseSignedEvent(new Uint8Array(), "sig")).toEqual({ eventId: "evt_4", eventType: "invoice.payment_failed", providerCreatedAt: new Date(3_000) });
    stripeMock.webhooks.constructEvent.mockReturnValue({ created: 4, data: { object: { anything: true } }, id: "evt_5", type: "charge.refunded" });
    expect(adapter().parseSignedEvent(new Uint8Array(), "sig")).toEqual({ eventId: "evt_5", eventType: "charge.refunded", providerCreatedAt: new Date(4_000) });
  });
});
