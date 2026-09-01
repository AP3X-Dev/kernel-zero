import { redirect } from "next/navigation";

import { loadConfig } from "../../../server/config/config";
import { safeLocalCallback } from "../../../server/identity/callback";
import { FormSubmit } from "../../app/form-submit";

export const dynamic = "force-dynamic";

type RegisterPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const query = await searchParams;
  const rawCallback = typeof query.callback === "string" ? query.callback : undefined;
  const callback = safeLocalCallback(rawCallback);
  if (!loadConfig(process.env).registrationOpen) {
    redirect(`/access/sign-in?callback=${encodeURIComponent(callback)}`);
  }

  return (
    <main id="main-content">
      <h1>Create your account</h1>
      <form action="/api/auth/sign-up/email" method="post">
        <input name="callbackURL" type="hidden" value={callback} />
        <label htmlFor="name">Name</label>
        <input autoComplete="name" id="name" name="name" required />
        <label htmlFor="email">Email</label>
        <input autoComplete="email" id="email" name="email" required type="email" />
        <label htmlFor="password">Password</label>
        <input autoComplete="new-password" id="password" minLength={8} name="password" required type="password" />
        <FormSubmit pendingLabel="Creating account…">Create account</FormSubmit>
      </form>
      <p className="auth-links"><a href="/access/sign-in">Already have an account?</a></p>
    </main>
  );
}
