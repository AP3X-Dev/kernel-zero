import { redirect } from "next/navigation";

import { getAuth } from "../../../server/identity/runtime";
import { safeLocalCallback } from "../../../server/identity/callback";
import { FormSubmit } from "../../app/form-submit";
import { CredentialsSchema, callbackFrom, formValue, statusOf, withQuery } from "../form-actions";

const MESSAGES: Readonly<Record<string, string>> = {
  credentials: "That email and password combination did not match an account.",
  registered: "Account created. Verify your email address, then sign in.",
  unverified: "Verify your email address before signing in.",
};

async function signInAction(formData: FormData): Promise<void> {
  "use server";
  const callback = callbackFrom(formData);
  const parsed = CredentialsSchema.safeParse({
    callback: formValue(formData, "callbackURL"),
    email: formValue(formData, "email"),
    password: formValue(formData, "password"),
  });
  if (!parsed.success) redirect(withQuery("/access/sign-in", { callback, notice: "credentials" }));

  let notice: string | null = null;
  try {
    await getAuth().api.signInEmail({ body: { email: parsed.data.email, password: parsed.data.password } });
  } catch (error: unknown) {
    notice = statusOf(error) === 403 ? "unverified" : "credentials";
  }
  redirect(notice === null ? callback : withQuery("/access/sign-in", { callback, notice }));
}

type SignInPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const query = await searchParams;
  const rawCallback = typeof query.callback === "string" ? query.callback : undefined;
  const callback = safeLocalCallback(rawCallback);
  const notice = typeof query.notice === "string" ? MESSAGES[query.notice] : undefined;
  return (
    <main id="main-content">
      <h1>Sign in</h1>
      {notice === undefined ? null : <p role="status">{notice}</p>}
      <form action={signInAction}>
        <input name="callbackURL" type="hidden" value={callback} />
        <label htmlFor="email">Email</label>
        <input autoComplete="email" id="email" name="email" required type="email" />
        <label htmlFor="password">Password</label>
        <input autoComplete="current-password" id="password" name="password" required type="password" />
        <FormSubmit pendingLabel="Signing in…">Sign in</FormSubmit>
      </form>
      <nav aria-label="Account help" className="auth-links">
        <a href="/access/recover">Forgot password?</a>
        <a href="/access/register">Create account</a>
      </nav>
    </main>
  );
}
