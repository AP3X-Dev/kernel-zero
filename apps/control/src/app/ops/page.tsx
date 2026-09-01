import { PageHeading, Status } from "../app/ui-components";
import { requireOperatorRoute } from "./route-context";

export const dynamic = "force-dynamic";

export default async function OperatorPage() {
  await requireOperatorRoute("/ops");
  return (
    <main className="app-main" id="main-content">
      <PageHeading description="Operational health stays separate from workspace membership and tenant capabilities.">Operations</PageHeading>
      <section className="card-grid">
        <article className="card"><p className="metric-label">Payment quarantine</p><p className="metric-value">Unavailable</p><Status>Ledger summary not loaded</Status></article>
        <article className="card"><p className="metric-label">Rate limiter</p><p className="metric-value">Unavailable</p><Status>Health summary not loaded</Status></article>
      </section>
    </main>
  );
}
