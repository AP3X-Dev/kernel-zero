import "server-only";

import type { DowngradeUsage, PlanName } from "@kernel-zero/domain";
import type { NormalizedPaymentEvent, TrialEligibility, WorkspaceBillingState } from "@kernel-zero/persistence";

export type BillingInterval = "month" | "year";
export type PaidPlanName = Exclude<PlanName, "Open">;

export type BillingPrice = Readonly<{
  amount: number;
  currency: string;
  id: string;
  interval: BillingInterval;
  plan: PaidPlanName;
}>;

export type PaymentMethodSummary = Readonly<{
  brand: string;
  customerId: string;
  expiryMonth: number;
  expiryYear: number;
  id: string;
  last4: string;
}>;

export type SafePaymentMethodSummary = Readonly<Omit<PaymentMethodSummary, "customerId">>;

export type SubscriptionCommand = Readonly<{
  customerId: string;
  idempotencyKey: string;
  interval: BillingInterval;
  paymentMethodId: string;
  plan: PlanName;
  promisedTrial: boolean;
  subscriptionId: string | null;
  workspaceId: string;
}>;

export type BillingProvider = Readonly<{
  changeSubscription(input: SubscriptionCommand): Promise<Readonly<{ commandId: string }>>;
  detachPaymentMethod(customerId: string, paymentMethodId: string, idempotencyKey: string): Promise<void>;
  fingerprintForPaymentMethod(paymentMethodId: string): Promise<string | null>;
  listPaymentMethods(customerId: string): Promise<readonly PaymentMethodSummary[]>;
  parseSignedEvent(rawBody: Uint8Array, signature: string): NormalizedPaymentEvent;
  resolvePrice(plan: PaidPlanName, interval: BillingInterval): Promise<BillingPrice | null>;
  setDefaultPaymentMethod(customerId: string, paymentMethodId: string, idempotencyKey: string): Promise<void>;
}>;

export type BillingRepository = Readonly<{
  findWorkspaceBilling(workspaceId: string): Promise<WorkspaceBillingState>;
  markTrialUsed(input: Readonly<{ fingerprint: string | null; userId: string }>): Promise<void>;
  readDowngradeUsage(workspaceId: string): Promise<DowngradeUsage>;
  readTrialEligibility(input: Readonly<{ fingerprint: string; userId: string }>): Promise<TrialEligibility>;
}>;

export type BillingHealthEvent = Readonly<{
  code: "trial_fingerprint_unavailable";
  component: "billing";
  level: "warning";
}>;
