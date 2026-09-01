import { loadPaymentEventsView } from "../../../server/application/governance-view";
import { EmptyState, PageHeading, Status } from "../../app/ui-components";
import { requireOperatorRoute } from "../route-context";

type PaymentEventsPageProps = Readonly<{ searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>> }>;

export const dynamic = "force-dynamic";

export default async function PaymentEventsPage({ searchParams }: PaymentEventsPageProps) {
  const { runtime } = await requireOperatorRoute("/ops/payment-events");
  const query = await searchParams;
  const rawState = typeof query.state === "string" ? query.state : undefined;
  const state = rawState === "applied" || rawState === "ignored" || rawState === "quarantined" || rawState === "received" || rawState === "stale" ? rawState : undefined;
  const events = await loadPaymentEventsView(runtime.prisma, state);
  return (
    <main className="app-main" id="main-content">
      <PageHeading description="Valid but unresolved events remain quarantined and retryable without regressing the subscription cursor.">Payment events</PageHeading>
      <section className="panel">
        <form method="get">
          <label htmlFor="event-state">Filter event state</label>
          <select id="event-state" name="state">
            <option value="">All states</option>
            <option value="quarantined">Quarantined</option>
            <option value="applied">Applied</option>
            <option value="ignored">Ignored</option>
            <option value="received">Received</option>
            <option value="stale">Stale</option>
          </select>
          <button type="submit">Apply filter</button>
        </form>
      </section>
      {events.length === 0 ? <EmptyState title="No matching payment events">No safe receipt projections match the selected state.</EmptyState> : (
        <ul aria-label="Payment event receipts" className="row-list">
          {events.map((event) => (
            <li className="row-card" key={`${event.provider}:${event.eventId}`}>
              <dl><dt>Event</dt><dd>{event.eventType}<br /><span className="muted">{event.provider} · {event.eventId}</span></dd></dl>
              <dl><dt>State</dt><dd><Status tone={event.state === "applied" ? "positive" : event.state === "quarantined" ? "danger" : "neutral"}>{event.state}</Status><br />{event.quarantineReason ?? event.projectionResult ?? "Awaiting projection"}</dd></dl>
              <dl><dt>Provider time</dt><dd>{event.providerCreatedAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC<br /><span className="muted">{String(event.retryCount)} retries</span></dd></dl>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
