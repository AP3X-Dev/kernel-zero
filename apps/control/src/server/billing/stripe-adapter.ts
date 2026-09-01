import "server-only";

import Stripe from "stripe";

import type { NormalizedPaymentEvent } from "@kernel-zero/persistence";

import { BillingConfigurationError, BillingProviderError, BillingSignatureError } from "./errors";
import type {
  BillingInterval,
  BillingPrice,
  BillingProvider,
  PaidPlanName,
  PaymentMethodSummary,
  SubscriptionCommand,
} from "./types";

export type StripeBillingConfig =
  | Readonly<{ enabled: false }>
  | Readonly<{ enabled: true; secretKey: string; webhookSecret: string }>;

export function createStripeBillingAdapter(config: StripeBillingConfig): BillingProvider {
  if (!config.enabled) return unavailableAdapter();
  const stripe = new Stripe(config.secretKey);
  return Object.freeze({
    changeSubscription: (input) => changeSubscription(stripe, input),
    async detachPaymentMethod(_customerId, paymentMethodId, idempotencyKey) {
      await stripe.paymentMethods.detach(paymentMethodId, {}, { idempotencyKey });
    },
    async fingerprintForPaymentMethod(paymentMethodId) {
      try {
        const method = await stripe.paymentMethods.retrieve(paymentMethodId);
        return method.card?.fingerprint ?? null;
      } catch (error) {
        throw providerFailure(error);
      }
    },
    async listPaymentMethods(customerId) {
      try {
        const methods = await stripe.paymentMethods.list({ customer: customerId, limit: 100, type: "card" });
        return Object.freeze(methods.data.flatMap((method): readonly PaymentMethodSummary[] => {
          const card = method.card;
          const owner = identifier(method.customer);
          if (card === undefined || owner === null) return [];
          return [Object.freeze({
            brand: card.brand,
            customerId: owner,
            expiryMonth: card.exp_month,
            expiryYear: card.exp_year,
            id: method.id,
            last4: card.last4,
          })];
        }));
      } catch (error) {
        throw providerFailure(error);
      }
    },
    parseSignedEvent(rawBody, signature) {
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(Buffer.from(rawBody), signature, config.webhookSecret);
      } catch {
        throw new BillingSignatureError();
      }
      return normalizeStripeEvent(event);
    },
    async resolvePrice(plan, interval) {
      try {
        const prices = await stripe.prices.list({ active: true, limit: 1, lookup_keys: [lookupKey(plan, interval)] });
        const price = prices.data[0];
        if (price?.unit_amount === undefined || price.unit_amount === null || !price.active || price.recurring?.interval !== interval) return null;
        return Object.freeze({
          amount: price.unit_amount,
          currency: price.currency,
          id: price.id,
          interval,
          plan,
        });
      } catch {
        return null;
      }
    },
    async setDefaultPaymentMethod(customerId, paymentMethodId, idempotencyKey) {
      try {
        await stripe.customers.update(
          customerId,
          { invoice_settings: { default_payment_method: paymentMethodId } },
          { idempotencyKey },
        );
      } catch (error) {
        throw providerFailure(error);
      }
    },
  });
}

async function changeSubscription(
  stripe: Stripe,
  input: SubscriptionCommand,
): Promise<Readonly<{ commandId: string }>> {
  try {
    if (input.plan === "Open") {
      if (input.subscriptionId === null) return Object.freeze({ commandId: `open:${input.workspaceId}` });
      const updated = await stripe.subscriptions.update(
        input.subscriptionId,
        { cancel_at_period_end: true },
        { idempotencyKey: input.idempotencyKey },
      );
      return Object.freeze({ commandId: updated.id });
    }
    const price = await resolveRequiredPrice(stripe, input.plan, input.interval);
    if (input.subscriptionId === null) {
      const created = await stripe.subscriptions.create({
        customer: input.customerId,
        default_payment_method: input.paymentMethodId,
        items: [{ price: price.id }],
        metadata: { workspace_id: input.workspaceId },
        ...(input.promisedTrial ? { trial_period_days: 14 } : {}),
      }, { idempotencyKey: input.idempotencyKey });
      return Object.freeze({ commandId: created.id });
    }
    const current = await stripe.subscriptions.retrieve(input.subscriptionId);
    const item = current.items.data[0];
    if (item === undefined) throw new BillingProviderError("The subscription has no billable item.");
    const updated = await stripe.subscriptions.update(input.subscriptionId, {
      cancel_at_period_end: false,
      default_payment_method: input.paymentMethodId,
      items: [{ id: item.id, price: price.id }],
      proration_behavior: "create_prorations",
    }, { idempotencyKey: input.idempotencyKey });
    return Object.freeze({ commandId: updated.id });
  } catch (error) {
    if (error instanceof BillingProviderError) throw error;
    throw providerFailure(error);
  }
}

async function resolveRequiredPrice(
  stripe: Stripe,
  plan: PaidPlanName,
  interval: BillingInterval,
): Promise<BillingPrice> {
  const prices = await stripe.prices.list({ active: true, limit: 1, lookup_keys: [lookupKey(plan, interval)] });
  const price = prices.data[0];
  if (price?.unit_amount === undefined || price.unit_amount === null || price.recurring?.interval !== interval) {
    throw new BillingProviderError("The requested billing price is unavailable.");
  }
  return Object.freeze({ amount: price.unit_amount, currency: price.currency, id: price.id, interval, plan });
}

function normalizeStripeEvent(event: Stripe.Event): NormalizedPaymentEvent {
  const base = {
    eventId: event.id,
    eventType: event.type,
    providerCreatedAt: new Date(event.created * 1_000),
  };
  if (event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted" ||
      event.type === "customer.subscription.trial_will_end") {
    const subscription = event.data.object;
    const item = subscription.items.data[0];
    const customer = identifier(subscription.customer);
    return Object.freeze({
      ...base,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      ...(customer === null ? {} : { customerId: customer }),
      ...(item === undefined ? {} : {
        periodEnd: new Date(item.current_period_end * 1_000),
        periodStart: new Date(item.current_period_start * 1_000),
        priceId: item.price.id,
      }),
      status: event.type === "customer.subscription.deleted" ? "canceled" : subscription.status,
      subscriptionId: subscription.id,
    });
  }
  if (event.type === "invoice.payment_failed" || event.type === "invoice.paid") {
    const invoice = event.data.object;
    const subscription = invoice.parent?.type === "subscription_details"
      ? identifier(invoice.parent.subscription_details?.subscription ?? null)
      : null;
    const customer = identifier(invoice.customer);
    return Object.freeze({
      ...base,
      ...(customer === null ? {} : { customerId: customer }),
      ...(subscription === null ? {} : { subscriptionId: subscription }),
    });
  }
  return Object.freeze(base);
}

function identifier(value: string | Readonly<{ id: string }> | null): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value.id;
}

function lookupKey(plan: PaidPlanName, interval: BillingInterval): string {
  return `kernel-zero-${plan.toLowerCase()}-${interval}`;
}

function unavailableAdapter(): BillingProvider {
  const unavailable = (): never => { throw new BillingConfigurationError(); };
  return Object.freeze({
    changeSubscription: () => Promise.reject(new BillingConfigurationError()),
    detachPaymentMethod: () => Promise.reject(new BillingConfigurationError()),
    fingerprintForPaymentMethod: () => Promise.reject(new BillingConfigurationError()),
    listPaymentMethods: () => Promise.reject(new BillingConfigurationError()),
    parseSignedEvent: () => unavailable(),
    resolvePrice: () => Promise.resolve(null),
    setDefaultPaymentMethod: () => Promise.reject(new BillingConfigurationError()),
  });
}

function providerFailure(error: unknown): BillingProviderError {
  return new BillingProviderError(error instanceof Error ? error.message : undefined);
}
