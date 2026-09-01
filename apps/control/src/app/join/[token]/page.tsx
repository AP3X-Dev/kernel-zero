import { resolveCorrelationId } from "@kernel-zero/domain";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getRuntime } from "../../../server/identity/runtime";
import { acceptWorkspaceInvitation } from "../../../server/application/workspace-view";
import { FormSubmit } from "../../app/form-submit";

type JoinPageProps = Readonly<{ params: Promise<Readonly<{ token: string }>> }>;

export default async function JoinPage({ params }: JoinPageProps) {
  const { token } = await params;
  const runtime = getRuntime();
  const session = await runtime.auth.api.getSession({ headers: await headers() });
  if (session === null) redirect(`/access/sign-in?callback=${encodeURIComponent(`/join/${token}`)}`);

  async function acceptAction(): Promise<void> {
    "use server";
    const current = getRuntime();
    const currentSession = await current.auth.api.getSession({ headers: await headers() });
    if (currentSession === null) redirect("/access/sign-in");
    await acceptWorkspaceInvitation(current.prisma, {
      correlationId: resolveCorrelationId(undefined).id, email: currentSession.user.email,
      token, userId: currentSession.user.id,
    });
    redirect("/app");
  }

  return (
    <main id="main-content">
      <h1>Workspace invitation</h1>
      <p>Confirm that you want to join using {session.user.email}.</p>
      <form action={acceptAction}><FormSubmit pendingLabel="Joining workspace…">Accept invitation</FormSubmit></form>
    </main>
  );
}
