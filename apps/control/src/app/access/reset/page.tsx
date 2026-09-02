import { redirect } from "next/navigation";

import { getAuth } from "../../../server/identity/runtime";
import { FormSubmit } from "../../app/form-submit";
import { NewPasswordSchema, formValue, withQuery } from "../form-actions";

const MESSAGES: Readonly<Record<string, string>> = {
  expired: "That reset link is no longer valid. Request a new one.",
  invalid: "Choose a password of at least eight characters.",
};

async function resetAction(formData: FormData): Promise<void> {
  "use server";
  const parsed = NewPasswordSchema.safeParse({
    newPassword: formValue(formData, "newPassword"),
    token: formValue(formData, "token"),
  });
  if (!parsed.success) redirect(withQuery("/access/reset", { notice: "invalid" }));
  const token = parsed.data.token ?? null;
  if (token === null) redirect(withQuery("/access/reset", { notice: "expired" }));

  let failed = false;
  try {
    await getAuth().api.resetPassword({ body: { newPassword: parsed.data.newPassword, token } });
  } catch {
    failed = true;
  }
  redirect(failed
    ? withQuery("/access/reset", { notice: "expired", token })
    : withQuery("/access/sign-in", { notice: "credentials" }));
}

type ResetPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

export default async function ResetPage({ searchParams }: ResetPageProps) {
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : "";
  const notice = typeof query.notice === "string" ? MESSAGES[query.notice] : undefined;
  return (
    <main id="main-content">
      <h1>Choose a new password</h1>
      {notice === undefined ? null : <p role="status">{notice}</p>}
      <form action={resetAction}>
        <input name="token" type="hidden" value={token} />
        <label htmlFor="password">New password</label>
        <input autoComplete="new-password" id="password" minLength={8} name="newPassword" required type="password" />
        <FormSubmit pendingLabel="Resetting password…">Reset password</FormSubmit>
      </form>
      <p className="auth-links"><a href="/access/recover">Request a new link</a></p>
    </main>
  );
}
