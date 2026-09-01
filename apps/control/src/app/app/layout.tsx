import type { ReactNode } from "react";

import { requireCapability } from "../../server/authorization/workspace";
import { WORKSPACE_NAVIGATION } from "./navigation";
import { requireWorkspaceRoute } from "./route-context";

export const dynamic = "force-dynamic";

export default async function ApplicationLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { authority, context, session } = await requireWorkspaceRoute("workspace.read", "/app");
  const visibleNavigation = WORKSPACE_NAVIGATION.filter(
    (item) => requireCapability(authority, item.capability) === null,
  );
  return (
    <div className="app-frame">
      <aside className="app-sidebar">
        <a className="brand-lockup" href="/app">KERNEL ZERO</a>
        <p className="workspace-label">Active workspace</p>
        <p className="workspace-name">{context.workspace.name}</p>
        <nav aria-label="Workspace" className="app-nav">
          <ul>
            {visibleNavigation.map((item) => (
              <li key={item.href}><a href={item.href}>{item.label}</a></li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="app-content">
        <header className="app-topbar">
          <p>Repository governance control plane</p>
          <p className="muted">Signed in as {session.user.email}</p>
        </header>
        {children}
      </div>
    </div>
  );
}
