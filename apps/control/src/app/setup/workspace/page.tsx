import { resolveCorrelationId } from "@kernel-zero/domain";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createApplicationWorkspace } from "../../../server/application/workspace-view";
import { getRuntime } from "../../../server/identity/runtime";
import { FormSubmit } from "../../app/form-submit";

async function createWorkspaceAction(formData: FormData): Promise<void> {
  "use server";
  const runtime = getRuntime();
  const session = await runtime.auth.api.getSession({ headers: await headers() });
  if (session === null) redirect("/access/sign-in?callback=%2Fsetup%2Fworkspace");
  const name = formData.get("name");
  const logoUrl = formData.get("logoUrl");
  await createApplicationWorkspace(runtime.prisma, {
    correlationId: resolveCorrelationId(undefined).id,
    ...(typeof logoUrl === "string" && logoUrl.trim() !== "" ? { logoUrl } : {}),
    name: typeof name === "string" ? name : "",
    userId: session.user.id,
  });
  redirect("/app");
}

export default function WorkspaceSetupPage() {
  return (
    <main id="main-content">
      <h1>Create a workspace</h1>
      <p>A workspace keeps policy, evidence, and people inside one authorization boundary.</p>
      <form action={createWorkspaceAction}>
        <label htmlFor="workspace-name">Workspace name</label>
        <input id="workspace-name" maxLength={120} minLength={2} name="name" required />
        <label htmlFor="workspace-logo">Logo URL (optional HTTPS)</label>
        <input id="workspace-logo" name="logoUrl" type="url" />
        <FormSubmit pendingLabel="Creating workspace…">Create workspace</FormSubmit>
      </form>
    </main>
  );
}
