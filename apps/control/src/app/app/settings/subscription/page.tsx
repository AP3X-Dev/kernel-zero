import { loadSubscriptionView } from "../../../../server/application/governance-view";
import { PageHeading, Status } from "../../ui-components";
import { requireWorkspaceRoute } from "../../route-context";

export const dynamic = "force-dynamic";

export default async function SubscriptionPage() {
  const { context, runtime } = await requireWorkspaceRoute("billing.read", "/app/settings/subscription");
  const subscription = await loadSubscriptionView(runtime.prisma, context.workspace.id);
  return (
    <main className="app-main" id="main-content">
      <PageHeading description="Server-authoritative plan state, payment methods, trial eligibility, and downgrade blockers.">Subscription</PageHeading>
      <section className="card-grid">
        <article className="card"><p className="metric-label">Current plan</p><p className="metric-value">{subscription?.plan ?? "Open"}</p><Status tone={subscription?.entitlementState === "paid" ? "positive" : subscription?.entitlementState === "grace" ? "warning" : "neutral"}>{subscription?.entitlementState ?? "open entitlement"}</Status></article>
        <article className="card"><p className="metric-label">Provider state</p><p className="metric-value">{subscription?.providerStatus ?? "Not connected"}</p><Status>{subscription?.cancelAtPeriodEnd === true ? "Cancels at period end" : "No scheduled cancellation"}</Status></article>
      </section>
      <section className="panel">
        <h2>Billing period</h2>
        {subscription?.currentPeriodEnd === null || subscription?.currentPeriodEnd === undefined
          ? <p>No provider billing period is recorded.</p>
          : <p>Current access period ends {subscription.currentPeriodEnd.toLocaleString("en-US", { timeZone: "UTC" })} UTC.</p>}
        {subscription?.graceExpiresAt === null || subscription?.graceExpiresAt === undefined ? null : (
          <p><Status tone="warning">Grace access expires {subscription.graceExpiresAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC</Status></p>
        )}
        <p className="muted">Subscription mutations remain disabled until their governed provider-backed actions are connected.</p>
      </section>
    </main>
  );
}
