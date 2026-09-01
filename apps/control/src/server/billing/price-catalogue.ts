import "server-only";

import type { BillingInterval, BillingPrice, PaidPlanName } from "./types";

const PAID_PLANS = Object.freeze(["Workshop", "Foundry", "Enterprise"] as const);
const INTERVALS = Object.freeze(["month", "year"] as const);
const CACHE_MILLISECONDS = 5 * 60 * 1_000;

export type PriceCatalogue = Readonly<Record<PaidPlanName, Readonly<Record<BillingInterval, BillingPrice | null>>>>;

export function createPriceCatalogue(
  provider: Readonly<{ resolvePrice(plan: PaidPlanName, interval: BillingInterval): Promise<BillingPrice | null> }>,
  now: () => number = Date.now,
): Readonly<{ read(): Promise<PriceCatalogue> }> {
  let cached: Readonly<{ expiresAt: number; value: PriceCatalogue }> | null = null;
  let pending: Promise<PriceCatalogue> | null = null;

  return Object.freeze({
    async read() {
      const time = now();
      if (cached !== null && time < cached.expiresAt) return cached.value;
      pending ??= load(provider).then((value) => {
        cached = Object.freeze({ expiresAt: time + CACHE_MILLISECONDS, value });
        return value;
      }).finally(() => { pending = null; });
      return pending;
    },
  });
}

async function load(
  provider: Readonly<{ resolvePrice(plan: PaidPlanName, interval: BillingInterval): Promise<BillingPrice | null> }>,
): Promise<PriceCatalogue> {
  const entries = await Promise.all(PAID_PLANS.flatMap((plan) =>
    INTERVALS.map(async (interval) => ({ interval, plan, price: await nullablePrice(provider, plan, interval) })),
  ));
  const prices = Object.fromEntries(PAID_PLANS.map((plan) => [plan, Object.fromEntries(
    entries.filter((entry) => entry.plan === plan).map((entry) => [entry.interval, entry.price]),
  )])) as PriceCatalogue;
  return Object.freeze(prices);
}

async function nullablePrice(
  provider: Readonly<{ resolvePrice(plan: PaidPlanName, interval: BillingInterval): Promise<BillingPrice | null> }>,
  plan: PaidPlanName,
  interval: BillingInterval,
): Promise<BillingPrice | null> {
  try {
    return await provider.resolvePrice(plan, interval);
  } catch {
    return null;
  }
}
