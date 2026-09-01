import { describe, expect, it, vi } from "vitest";

import {
  BillingConfigurationError,
  BillingService,
  createPriceCatalogue,
  createStripeBillingAdapter,
  type BillingProvider,
  type BillingRepository,
} from "./index";

const WORKSPACE = "0195f000-0000-7000-8000-000000000002";
const USER = "0195f000-0000-7000-8000-000000000003";

function provider(overrides: Partial<BillingProvider> = {}): BillingProvider {
  return {
    changeSubscription: vi.fn().mockResolvedValue({ commandId: "sub_1" }),
    detachPaymentMethod: vi.fn().mockResolvedValue(undefined),
    fingerprintForPaymentMethod: vi.fn().mockResolvedValue("fingerprint-a"),
    listPaymentMethods: vi.fn().mockResolvedValue([
      { brand: "visa", customerId: "cus_a", expiryMonth: 12, expiryYear: 2030, id: "pm_a", last4: "4242" },
    ]),
    parseSignedEvent: vi.fn(),
    resolvePrice: vi.fn().mockResolvedValue(null),
    setDefaultPaymentMethod: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function repository(overrides: Partial<BillingRepository> = {}): BillingRepository {
  return {
    findWorkspaceBilling: vi.fn().mockResolvedValue({ customerId: "cus_a", subscriptionId: "sub_a" }),
    markTrialUsed: vi.fn().mockResolvedValue(undefined),
    readDowngradeUsage: vi.fn().mockResolvedValue({ activePolicyPacks: 1, evidenceRunsThisMonth: 5, occupiedSeats: 2 }),
    readTrialEligibility: vi.fn().mockResolvedValue({ eligible: true }),
    ...overrides,
  };
}

describe("Stripe billing adapter", () => {
  it("does not block startup when absent and fails billing writes with a typed error", async () => {
    const adapter = createStripeBillingAdapter({ enabled: false });
    await expect(adapter.resolvePrice("Workshop", "month")).resolves.toBeNull();
    await expect(adapter.setDefaultPaymentMethod("cus_a", "pm_a", "operation-a"))
      .rejects.toBeInstanceOf(BillingConfigurationError);
  });
});

describe("billing catalogue", () => {
  it("loads all prices concurrently, keeps independently missing entries nullable, and caches for five minutes", async () => {
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const resolvePrice = vi.fn(async (plan: "Enterprise" | "Foundry" | "Workshop", interval: "month" | "year") => {
      await barrier;
      return plan === "Foundry" && interval === "year"
        ? null
        : { amount: 2_500, currency: "usd", id: `${plan}-${interval}`, interval, plan };
    });
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_100).mockReturnValueOnce(301_001);
    const catalogue = createPriceCatalogue({ resolvePrice }, now);

    const first = catalogue.read();
    expect(resolvePrice).toHaveBeenCalledTimes(6);
    release?.();
    await expect(first).resolves.toMatchObject({ Foundry: { year: null } });
    await catalogue.read();
    expect(resolvePrice).toHaveBeenCalledTimes(6);
    await catalogue.read();
    expect(resolvePrice).toHaveBeenCalledTimes(12);
  });
});

describe("billing commands", () => {
  it("returns only safe payment-method summaries for the resolved customer", async () => {
    const service = new BillingService(repository(), provider({
      listPaymentMethods: vi.fn().mockResolvedValue([
        { brand: "visa", customerId: "cus_a", expiryMonth: 12, expiryYear: 2030, id: "pm_a", last4: "4242" },
        { brand: "visa", customerId: "cus_foreign", expiryMonth: 1, expiryYear: 2031, id: "pm_b", last4: "1111" },
      ]),
    }));
    await expect(service.listPaymentMethods(WORKSPACE)).resolves.toEqual([
      { brand: "visa", expiryMonth: 12, expiryYear: 2030, id: "pm_a", last4: "4242" },
    ]);
  });

  it("proves payment-method ownership before default or detach mutations", async () => {
    const billingProvider = provider();
    const service = new BillingService(repository(), billingProvider);
    await service.setDefaultPaymentMethod({ operationId: "op-1", paymentMethodId: "pm_a", workspaceId: WORKSPACE });
    await service.detachPaymentMethod({ operationId: "op-2", paymentMethodId: "pm_a", workspaceId: WORKSPACE });
    expect(billingProvider.listPaymentMethods).toHaveBeenCalledTimes(2);
    expect(billingProvider.setDefaultPaymentMethod).toHaveBeenCalledWith("cus_a", "pm_a", `${WORKSPACE}:op-1`);
    expect(billingProvider.detachPaymentMethod).toHaveBeenCalledWith("cus_a", "pm_a", `${WORKSPACE}:op-2`);

    const foreignProvider = provider({ listPaymentMethods: vi.fn().mockResolvedValue([]) });
    await expect(new BillingService(repository(), foreignProvider).detachPaymentMethod({
      operationId: "op-3", paymentMethodId: "pm_foreign", workspaceId: WORKSPACE,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(foreignProvider.detachPaymentMethod).not.toHaveBeenCalled();
  });

  it("rejects downgrade blockers before provider mutation", async () => {
    const billingProvider = provider();
    const service = new BillingService(repository({
      readDowngradeUsage: vi.fn().mockResolvedValue({ activePolicyPacks: 4, evidenceRunsThisMonth: 101, occupiedSeats: 4 }),
    }), billingProvider);
    await expect(service.changeSubscription({
      interval: "month", operationId: "op-4", paymentMethodId: "pm_a", plan: "Open",
      promisedTrial: false, userId: USER, workspaceId: WORKSPACE,
    })).rejects.toMatchObject({ code: "CONFLICT", reason: "downgrade_blocked" });
    expect(billingProvider.changeSubscription).not.toHaveBeenCalled();
  });

  it("fails trial fingerprint reads open with health evidence and marks trial use monotonically", async () => {
    const emitHealth = vi.fn();
    const repo = repository({ readTrialEligibility: vi.fn().mockRejectedValue(new Error("database unavailable")) });
    const billingProvider = provider();
    const service = new BillingService(repo, billingProvider, emitHealth);
    await expect(service.changeSubscription({
      interval: "year", operationId: "op-5", paymentMethodId: "pm_a", plan: "Workshop",
      promisedTrial: true, userId: USER, workspaceId: WORKSPACE,
    })).resolves.toEqual({ commandId: "sub_1", trialPromised: true });
    expect(emitHealth).toHaveBeenCalledWith(expect.objectContaining({ code: "trial_fingerprint_unavailable" }));
    expect(repo.markTrialUsed).toHaveBeenCalledWith(expect.objectContaining({ fingerprint: "fingerprint-a", userId: USER }));
  });

  it("fails open when the provider cannot read a fingerprint while still consuming the user trial", async () => {
    const emitHealth = vi.fn();
    const repo = repository();
    const billingProvider = provider({ fingerprintForPaymentMethod: vi.fn().mockRejectedValue(new Error("provider unavailable")) });
    const service = new BillingService(repo, billingProvider, emitHealth);
    await expect(service.changeSubscription({
      interval: "month", operationId: "op-7", paymentMethodId: "pm_a", plan: "Workshop",
      promisedTrial: true, userId: USER, workspaceId: WORKSPACE,
    })).resolves.toEqual({ commandId: "sub_1", trialPromised: true });
    expect(emitHealth).toHaveBeenCalledWith(expect.objectContaining({ code: "trial_fingerprint_unavailable" }));
    expect(repo.markTrialUsed).toHaveBeenCalledWith({ fingerprint: null, userId: USER });
  });

  it("rejects an ineligible promised trial before subscription mutation", async () => {
    const billingProvider = provider();
    const service = new BillingService(repository({ readTrialEligibility: vi.fn().mockResolvedValue({ eligible: false }) }), billingProvider);
    await expect(service.changeSubscription({
      interval: "month", operationId: "op-6", paymentMethodId: "pm_a", plan: "Workshop",
      promisedTrial: true, userId: USER, workspaceId: WORKSPACE,
    })).rejects.toMatchObject({ code: "CONFLICT", reason: "trial_ineligible" });
    expect(billingProvider.changeSubscription).not.toHaveBeenCalled();
  });
});
