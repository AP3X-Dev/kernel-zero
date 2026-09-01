export const PLAN_NAMES = Object.freeze([
  "Open",
  "Workshop",
  "Foundry",
  "Enterprise",
] as const);

export type PlanName = (typeof PLAN_NAMES)[number];

export type PlanLimits = Readonly<{
  activePolicyPacks: number | null;
  evidenceRetentionDays: number;
  evidenceRunsPerMonth: number | null;
  occupiedSeats: number | null;
}>;

export type PlanDefinition = Readonly<{
  displayName: PlanName;
  limits: PlanLimits;
}>;

function plan(displayName: PlanName, limits: PlanLimits): PlanDefinition {
  return Object.freeze({ displayName, limits: Object.freeze({ ...limits }) });
}

export const PLAN_CATALOGUE: Readonly<Record<PlanName, PlanDefinition>> = Object.freeze({
  Open: plan("Open", {
    activePolicyPacks: 3,
    evidenceRetentionDays: 30,
    evidenceRunsPerMonth: 100,
    occupiedSeats: 3,
  }),
  Workshop: plan("Workshop", {
    activePolicyPacks: 20,
    evidenceRetentionDays: 180,
    evidenceRunsPerMonth: 2_000,
    occupiedSeats: 10,
  }),
  Foundry: plan("Foundry", {
    activePolicyPacks: 100,
    evidenceRetentionDays: 365,
    evidenceRunsPerMonth: 20_000,
    occupiedSeats: 50,
  }),
  Enterprise: plan("Enterprise", {
    activePolicyPacks: null,
    evidenceRetentionDays: 730,
    evidenceRunsPerMonth: null,
    occupiedSeats: null,
  }),
});

export type EntitlementMode = "open" | "paid" | "grace";
export type Entitlement = Readonly<{
  mode: EntitlementMode;
  plan: PlanName;
  definition: PlanDefinition;
  graceExpiresAt: Date | null;
}>;

export type EntitlementAction =
  | "read"
  | "evidence.submit"
  | "invitation.create"
  | "policy.activate"
  | "exception.approve"
  | "plan.expand";

export type SubscriptionEntitlementSource = Readonly<{
  graceExpiresAt?: Date | null;
  plan: PlanName;
  providerStatus: string;
}>;

export function resolveEntitlement(
  source: SubscriptionEntitlementSource | null,
  now = new Date(),
): Entitlement {
  if (source !== null && (source.providerStatus === "active" || source.providerStatus === "trialing")) {
    return entitlement("paid", source.plan, null);
  }
  if (
    source !== null &&
    source.providerStatus === "past_due" &&
    source.graceExpiresAt instanceof Date &&
    source.graceExpiresAt.getTime() > now.getTime()
  ) {
    return entitlement("grace", source.plan, source.graceExpiresAt);
  }
  return entitlement("open", "Open", null);
}

export function allowsEntitlementAction(
  entitlementValue: Entitlement,
  action: EntitlementAction,
): boolean {
  if (entitlementValue.mode !== "grace") return true;
  return action === "read" || action === "evidence.submit";
}

export type DowngradeUsage = Readonly<{
  activePolicyPacks: number;
  evidenceRunsThisMonth: number;
  occupiedSeats: number;
}>;

export type QuotaKey = "occupied_seats" | "active_policy_packs" | "evidence_runs";

export type DowngradeBlocker = Readonly<{
  current: number;
  limit: number;
  quota: QuotaKey;
  requiredReduction: number;
}>;

export function downgradeBlockers(
  targetPlan: PlanName,
  usage: DowngradeUsage,
): readonly DowngradeBlocker[] {
  const limits = PLAN_CATALOGUE[targetPlan].limits;
  const blockers: DowngradeBlocker[] = [];
  addBlocker(blockers, "occupied_seats", usage.occupiedSeats, limits.occupiedSeats);
  addBlocker(blockers, "active_policy_packs", usage.activePolicyPacks, limits.activePolicyPacks);
  addBlocker(blockers, "evidence_runs", usage.evidenceRunsThisMonth, limits.evidenceRunsPerMonth);
  return Object.freeze(blockers);
}

export function quotaLimit(planName: PlanName, quota: QuotaKey): number | null {
  const limits = PLAN_CATALOGUE[planName].limits;
  if (quota === "occupied_seats") return limits.occupiedSeats;
  if (quota === "active_policy_packs") return limits.activePolicyPacks;
  return limits.evidenceRunsPerMonth;
}

function entitlement(
  mode: EntitlementMode,
  planName: PlanName,
  graceExpiresAt: Date | null,
): Entitlement {
  return Object.freeze({
    definition: PLAN_CATALOGUE[planName],
    graceExpiresAt,
    mode,
    plan: planName,
  });
}

function addBlocker(
  blockers: DowngradeBlocker[],
  quota: QuotaKey,
  current: number,
  limit: number | null,
): void {
  if (limit === null || current <= limit) return;
  blockers.push(Object.freeze({ current, limit, quota, requiredReduction: current - limit }));
}
