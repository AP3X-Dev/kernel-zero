import type { ReactNode } from "react";

import { WORKSPACE_NAVIGATION } from "./navigation";

export const dynamic = "force-dynamic";

export default function ApplicationLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="app-frame">
      <aside className="app-sidebar">
        <a className="brand-lockup" href="/app">KERNEL ZERO</a>
        <nav aria-label="Workspace" className="app-nav">
          <ul>
            {WORKSPACE_NAVIGATION.map((item) => (
              <li key={item.href}><a href={item.href}>{item.label}</a></li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="app-content">
        <header className="app-topbar">
          <p>Repository governance control plane</p>
        </header>
        {children}
      </div>
    </div>
  );
}
