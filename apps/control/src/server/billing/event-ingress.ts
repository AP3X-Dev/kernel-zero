import "server-only";

import { sha256, type PlanName } from "@kernel-zero/domain";
import {
  createPersistenceClient,
  ingestPaymentEvent,
  type NormalizedPaymentEvent,
  type PaymentProjectionResult,
} from "@kernel-zero/persistence";

import { loadConfig } from "../config";
import { createPriceCatalogue } from "./price-catalogue";
import { createStripeBillingAdapter } from "./stripe-adapter";
import type { BillingProvider } from "./types";

export type ParsedBillingEvent = Readonly<{
  event: NormalizedPaymentEvent;
  payloadDigest: string;
  resolvePlan: (priceId: string) => PlanName | null;
}>;

export type BillingEventIngressDependencies = Readonly<{
  configured(): boolean;
  parseSignedEvent(rawBody: Uint8Array, signature: string): Promise<ParsedBillingEvent>;
  persist(input: ParsedBillingEvent & Readonly<{ correlationId: string }>): Promise<PaymentProjectionResult>;
}>;

export function createRuntimeBillingEventDependencies(): BillingEventIngressDependencies {
  let billingRuntime: Readonly<{
    catalogue: ReturnType<typeof createPriceCatalogue>;
    provider: BillingProvider;
  }> | null = null;

  function runtime() {
    if (billingRuntime !== null) return billingRuntime;
    const provider = createStripeBillingAdapter(loadConfig(process.env).stripe);
    billingRuntime = Object.freeze({ catalogue: createPriceCatalogue(provider), provider });
    return billingRuntime;
  }

  return Object.freeze({
    configured() {
      return loadConfig(process.env).stripe.enabled;
    },
    async parseSignedEvent(rawBody, signature) {
      const { catalogue, provider } = runtime();
      const event = provider.parseSignedEvent(rawBody, signature);
      const prices = await catalogue.read();
      const priceToPlan = new Map<string, PlanName>();
      for (const [plan, intervals] of Object.entries(prices)) {
        for (const price of Object.values(intervals)) {
          if (price !== null) priceToPlan.set(price.id, plan as PlanName);
        }
      }
      return Object.freeze({
        event,
        payloadDigest: sha256(rawBody),
        resolvePlan: (priceId: string) => priceToPlan.get(priceId) ?? null,
      });
    },
    async persist(input) {
      const config = loadConfig(process.env);
      const client = createPersistenceClient(config.databaseUrl);
      try {
        return await ingestPaymentEvent(client, input);
      } finally {
        await client.$disconnect();
      }
    },
  });
}
