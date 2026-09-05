declare function defineGovernedAction(id: string, metadata: object): unknown;

export const GOVERNED_ACTIONS = Object.freeze({
  safe: defineGovernedAction("safe", {
    capability: "workspace.update",
    tenantScope: "workspace",
    quota: "mutations",
    audit: "workspace.updated",
    idempotency: "required",
  }),
  spread: defineGovernedAction("spread", {
    ...{ capability: "workspace.update" },
    tenantScope: "workspace",
    quota: "mutations",
    audit: "workspace.updated",
    idempotency: "required",
  }),
});
