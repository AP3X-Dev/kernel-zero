import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { getRuntime } from "../../server/identity/runtime";
import { authorizeOperatorRoute } from "../../server/operator/operator-boundary";

export async function requireOperatorRoute(callback: string) {
  const runtime = getRuntime();
  const session = await runtime.auth.api.getSession({ headers: await headers() });
  const decision = await authorizeOperatorRoute({
    configuredEmail: runtime.config.operatorEmail ?? null,
    prisma: runtime.prisma,
    session: session === null ? null : {
      normalizedEmail: session.user.email.toLowerCase(),
      userId: session.user.id,
    },
  });
  if (decision.decision === "not-found") notFound();
  if (decision.decision === "sign-in") redirect(`/access/sign-in?callback=${encodeURIComponent(callback)}`);
  if (decision.decision === "application") redirect("/app");
  return { runtime, session };
}
