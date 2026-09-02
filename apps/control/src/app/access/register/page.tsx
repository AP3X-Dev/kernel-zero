import { redirect } from "next/navigation";

import { loadConfig } from "../../../server/config/config";
import { safeLocalCallback } from "../../../server/identity/callback";
import { getAuth } from "../../../server/identity/runtime";
import { FormSubmit } from "../../app/form-submit";
import { RegistrationSchema, callbackFrom, formValue, withQuery } from "../form-actions";

export const dynamic = "force-dynamic";

const MESSAGES: Readonly<Record<string, string>> = {
  invalid: "Check the name, email, and a password of at least eight characters.",
  unavailable: "That account could not be created. Try again.",
};

async function registerAction(formData: FormData): Promise<void> {
  "use server";
  const callback = callbackFrom(formData);
  const parsed = RegistrationSchema.safeParse({
    callback: formValue(formData, "callbackURL"),
    email: formValue(formData, "email"),
    name: formValue(formData, "name"),
    password: formValue(formData, "password"),
  });
  if (!parsed.success) redirect(withQuery("/access/register", { callback, notice: "invalid" }));

  let failed = false;
  try {
    // A duplicate address returns a success-shaped result on purpose, so this never reveals who already has an account.
    await getAuth().api.signUpEmail({
      body: { email: parsed.data.email, name: parsed.data.name, password: parsed.data.password },
    });
  } catch {
    failed = true;
  }
  redirect(failed
    ? withQuery("/access/register", { callback, notice: "unavailable" })
    : withQuery("/access/sign-in", { callback, notice: "registered" }));
}

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
  const notice = typeof query.notice === "string" ? MESSAGES[query.notice] : undefined;

  return (
    <main id="main-content">
      <h1>Create your account</h1>
      {notice === undefined ? null : <p role="status">{notice}</p>}
      <form action={registerAction}>
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
