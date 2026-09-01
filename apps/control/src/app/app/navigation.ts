import type { Capability } from "@kernel-zero/domain";

export type WorkspaceNavigationItem = Readonly<{
  capability: Capability;
  href: string;
  label: string;
}>;

export const WORKSPACE_NAVIGATION: readonly WorkspaceNavigationItem[] = Object.freeze([
  { capability: "workspace.read", href: "/app", label: "Overview" },
  { capability: "policy.read", href: "/app/policies", label: "Policies" },
  { capability: "evidence.read", href: "/app/runs", label: "Verification runs" },
  { capability: "exception.read", href: "/app/exceptions", label: "Exceptions" },
  { capability: "member.read", href: "/app/people", label: "People" },
  { capability: "workspace.read", href: "/app/settings/workspace", label: "Workspace settings" },
  { capability: "billing.read", href: "/app/settings/subscription", label: "Subscription" },
  { capability: "audit.read", href: "/app/settings/audit", label: "Audit history" },
]);

export const MUTATION_STATES = Object.freeze([
  "pending",
  "success",
  "empty",
  "validation",
  "authorization",
  "quota",
  "provider-unavailable",
  "retryable-error",
] as const);

export type MutationState = (typeof MUTATION_STATES)[number];

export const MUTATION_STATE_MESSAGES: Readonly<Record<MutationState, string>> = Object.freeze({
  authorization: "You do not have permission to complete this action.",
  empty: "There is nothing to change yet.",
  pending: "Saving changes…",
  "provider-unavailable": "The external provider is unavailable. Your current settings are unchanged.",
  quota: "This workspace has reached its plan limit.",
  "retryable-error": "The action could not be completed. Try again.",
  success: "Changes saved.",
  validation: "Review the highlighted fields and try again.",
});
