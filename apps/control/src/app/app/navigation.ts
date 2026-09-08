export type WorkspaceNavigationItem = Readonly<{
  href: string;
  label: string;
}>;

export const WORKSPACE_NAVIGATION: readonly WorkspaceNavigationItem[] = Object.freeze([
  { href: "/app", label: "Overview" },
  { href: "/app/policies", label: "Policies" },
  { href: "/app/runs", label: "Verification runs" },
  { href: "/app/exceptions", label: "Exceptions" },
  { href: "/app/settings/audit", label: "Audit history" },
]);
