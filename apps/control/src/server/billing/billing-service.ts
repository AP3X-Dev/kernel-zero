import "server-only";

import { downgradeBlockers, type PlanName } from "@kernel-zero/domain";

import { billingFailure } from "./errors";
import type {
  BillingHealthEvent,
  BillingInterval,
  BillingProvider,
  BillingRepository,
  SafePaymentMethodSummary,
} from "./types";

type HealthSink = (event: BillingHealthEvent) => void;

export class BillingService {
  readonly #repository: BillingRepository;
  readonly #provider: BillingProvider;
  readonly #emitHealth: HealthSink;

  constructor(repository: BillingRepository, provider: BillingProvider, emitHealth: HealthSink = () => undefined) {
    this.#repository = repository;
    this.#provider = provider;
    this.#emitHealth = emitHealth;
  }

  async listPaymentMethods(workspaceId: string): Promise<readonly SafePaymentMethodSummary[]> {
    const billing = await this.#repository.findWorkspaceBilling(workspaceId);
    if (billing.customerId === null) return Object.freeze([]);
    const methods = await this.#provider.listPaymentMethods(billing.customerId);
    return Object.freeze(methods
      .filter((method) => method.customerId === billing.customerId)
      .map((method) => Object.freeze({
        brand: method.brand,
        expiryMonth: method.expiryMonth,
        expiryYear: method.expiryYear,
        id: method.id,
        last4: method.last4,
      })));
  }

  async setDefaultPaymentMethod(input: Readonly<{
    operationId: string;
    paymentMethodId: string;
    workspaceId: string;
  }>): Promise<void> {
    const customerId = await this.#ownedCustomer(input.workspaceId, input.paymentMethodId);
    await this.#provider.setDefaultPaymentMethod(customerId, input.paymentMethodId, idempotency(input.workspaceId, input.operationId));
  }

  async detachPaymentMethod(input: Readonly<{
    operationId: string;
    paymentMethodId: string;
    workspaceId: string;
  }>): Promise<void> {
    const customerId = await this.#ownedCustomer(input.workspaceId, input.paymentMethodId);
    await this.#provider.detachPaymentMethod(customerId, input.paymentMethodId, idempotency(input.workspaceId, input.operationId));
  }

  async changeSubscription(input: Readonly<{
    interval: BillingInterval;
    operationId: string;
    paymentMethodId: string;
    plan: PlanName;
    promisedTrial: boolean;
    userId: string;
    workspaceId: string;
  }>): Promise<Readonly<{ commandId: string; trialPromised: boolean }>> {
    const usage = await this.#repository.readDowngradeUsage(input.workspaceId);
    const blockers = downgradeBlockers(input.plan, usage);
    if (blockers.length > 0) throw billingFailure("CONFLICT", "downgrade_blocked", { blockers });
    const billing = await this.#repository.findWorkspaceBilling(input.workspaceId);
    if (billing.customerId === null) throw billingFailure("NOT_FOUND", "billing_customer");

    let fingerprint: string | null = null;
    if (input.promisedTrial) {
      try {
        fingerprint = await this.#provider.fingerprintForPaymentMethod(input.paymentMethodId);
        if (fingerprint === null) throw new Error("card_fingerprint_missing");
        const eligibility = await this.#repository.readTrialEligibility({ fingerprint, userId: input.userId });
        if (!eligibility.eligible) throw billingFailure("CONFLICT", "trial_ineligible");
      } catch (error) {
        if (isBillingFailure(error)) throw error;
        this.#emitHealth(Object.freeze({ code: "trial_fingerprint_unavailable", component: "billing", level: "warning" }));
      }
    }

    const result = await this.#provider.changeSubscription({
      customerId: billing.customerId,
      idempotencyKey: idempotency(input.workspaceId, input.operationId),
      interval: input.interval,
      paymentMethodId: input.paymentMethodId,
      plan: input.plan,
      promisedTrial: input.promisedTrial,
      subscriptionId: billing.subscriptionId,
      workspaceId: input.workspaceId,
    });
    if (input.promisedTrial) await this.#repository.markTrialUsed({ fingerprint, userId: input.userId });
    return Object.freeze({ commandId: result.commandId, trialPromised: input.promisedTrial });
  }

  async #ownedCustomer(workspaceId: string, paymentMethodId: string): Promise<string> {
    const billing = await this.#repository.findWorkspaceBilling(workspaceId);
    if (billing.customerId === null) throw billingFailure("NOT_FOUND", "billing_customer");
    const methods = await this.#provider.listPaymentMethods(billing.customerId);
    const owned = methods.some((method) => method.id === paymentMethodId && method.customerId === billing.customerId);
    if (!owned) throw billingFailure("NOT_FOUND", "payment_method");
    return billing.customerId;
  }
}

function idempotency(workspaceId: string, operationId: string): string {
  return `${workspaceId}:${operationId}`;
}

function isBillingFailure(error: unknown): error is Readonly<{ code: string; reason: string }> {
  return typeof error === "object" && error !== null && "code" in error && "reason" in error;
}
