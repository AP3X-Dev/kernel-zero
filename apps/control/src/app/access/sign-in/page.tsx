import { safeLocalCallback } from "../../../server/identity/callback";
import { FormSubmit } from "../../app/form-submit";

type SignInPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const query = await searchParams;
  const rawCallback = typeof query.callback === "string" ? query.callback : undefined;
  const callback = safeLocalCallback(rawCallback);
  return (
    <main id="main-content">
      <h1>Sign in</h1>
      <form action="/api/auth/sign-in/email" method="post">
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
