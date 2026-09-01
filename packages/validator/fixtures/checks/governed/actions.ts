declare function defineGovernedAction(actionId: string, metadata?: Record<string, unknown>): unknown;
declare const dynamicActionId: string;

export const GOVERNED_ACTIONS = {
  complete: {
    capability: "workspace.update",
    tenantScope: "workspace",
    quota: "mutations",
    audit: "workspace.updated",
    idempotency: "required",
  },
  incomplete: {
    capability: "workspace.update",
    tenantScope: "workspace",
    quota: "mutations",
    audit: "workspace.updated",
  },
  declared: defineGovernedAction("declared", {
    capability: "workspace.update",
    tenantScope: "workspace",
    quota: "mutations",
    audit: "workspace.updated",
    idempotency: "required",
  }),
  mismatched: defineGovernedAction("different", {
    capability: "workspace.update",
    tenantScope: "workspace",
    quota: "mutations",
    audit: "workspace.updated",
    idempotency: "required",
  }),
};

defineGovernedAction("complete");
defineGovernedAction("unknown");
defineGovernedAction(dynamicActionId);
