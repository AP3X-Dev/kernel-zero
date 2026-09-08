import { getRuntime } from "../../server/runtime";

/** Every page reads through this so the configured workspace scope is the only one a page can see. */
export function workspaceRoute() {
  const runtime = getRuntime();
  return { runtime, workspaceId: runtime.config.workspaceId };
}
