import "server-only";

/** Every owned selector composes the configured workspace identifier; the self-policy rule `tenant-selector-requires-workspace` proves it. */
export function tenantSelector<T extends object>(workspaceId: string, selector: T): T & { workspaceId: string } {
  return { ...selector, workspaceId };
}
