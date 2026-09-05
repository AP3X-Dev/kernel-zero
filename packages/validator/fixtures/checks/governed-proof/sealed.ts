declare function defineGovernedAction(id: string, metadata: object): unknown;
declare function sealRegistry(value: object): unknown;

export const GOVERNED_ACTIONS = sealRegistry({
  unsafe: defineGovernedAction("unsafe", {
    capability: "workspace.update",
    tenantScope: "workspace",
    quota: "mutations",
    audit: "workspace.updated",
    idempotency: "required",
  }),
});
