import { redirect } from "next/navigation";

import { getAuth } from "../../../server/identity/runtime";
import { FormSubmit } from "../../app/form-submit";
import { EmailOnlySchema, formValue, withQuery } from "../form-actions";

const MESSAGES: Readonly<Record<string, string>> = {
  invalid: "Enter the email address on your account.",
  sent: "If that address has an account, a reset link is on its way.",
};

async function recoverAction(formData: FormData): Promise<void> {
  "use server";
  const parsed = EmailOnlySchema.safeParse({ email: formValue(formData, "email") });
  if (!parsed.success) redirect(withQuery("/access/recover", { notice: "invalid" }));

  try {
    await getAuth().api.requestPasswordReset({ body: { email: parsed.data.email, redirectTo: "/access/reset" } });
  } catch {
    // A failed lookup or delivery must read the same as a successful one, so the outcome never reveals the account.
  }
  redirect(withQuery("/access/recover", { notice: "sent" }));
}

type RecoverPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

export default async function RecoverPage({ searchParams }: RecoverPageProps) {
  const query = await searchParams;
  const notice = typeof query.notice === "string" ? MESSAGES[query.notice] : undefined;
  return (
    <main id="main-content">
      <h1>Recover access</h1>
      {notice === undefined ? null : <p role="status">{notice}</p>}
      <form action={recoverAction}>
        <label htmlFor="email">Email</label>
        <input autoComplete="email" id="email" name="email" required type="email" />
        <FormSubmit pendingLabel="Sending reset link…">Send reset link</FormSubmit>
      </form>
      <p className="auth-links"><a href="/access/sign-in">Return to sign in</a></p>
    </main>
  );
}
