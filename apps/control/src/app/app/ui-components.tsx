import type { ReactNode } from "react";

export function PageHeading({ actions, children, description }: Readonly<{
  actions?: ReactNode;
  children: ReactNode;
  description: string;
}>) {
  return (
    <header className="page-heading">
      <div><h1>{children}</h1><p>{description}</p></div>
      {actions}
    </header>
  );
}

export function Status({ children, tone = "neutral" }: Readonly<{
  children: ReactNode;
  tone?: "danger" | "neutral" | "positive" | "warning";
}>) {
  return <span className={`status status-${tone}`}>{children}</span>;
}

export function EmptyState({ children, title }: Readonly<{ children: ReactNode; title: string }>) {
  return <section className="empty-state"><h2>{title}</h2><p>{children}</p></section>;
}

export function LiveMutationStatus({ message }: Readonly<{ message: string }>) {
  return <p aria-atomic="true" aria-live="polite" className="live-status" role="status">{message}</p>;
}
