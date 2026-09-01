import type { ReactNode } from "react";

import { requireOperatorRoute } from "./route-context";

export const dynamic = "force-dynamic";

export default async function OperatorLayout({ children }: Readonly<{ children: ReactNode }>) {
  await requireOperatorRoute("/ops");
  return (
    <div className="app-frame">
      <aside className="app-sidebar">
        <a className="brand-lockup" href="/ops">KERNEL ZERO operations</a>
        <nav aria-label="Operations" className="app-nav">
          <ul>
            <li><a href="/ops">Operations overview</a></li>
            <li><a href="/ops/payment-events">Payment events</a></li>
            <li><a href="/app">Workspace application</a></li>
          </ul>
        </nav>
      </aside>
      <div className="app-content">
        <header className="app-topbar"><p>System operator boundary</p></header>
        {children}
      </div>
    </div>
  );
}
