import { FormSubmit } from "../../app/form-submit";

export default function RecoverPage() {
  return (
    <main id="main-content">
      <h1>Recover access</h1>
      <form action="/api/auth/forget-password" method="post">
        <label htmlFor="email">Email</label>
        <input autoComplete="email" id="email" name="email" required type="email" />
        <input name="redirectTo" type="hidden" value="/access/reset" />
        <FormSubmit pendingLabel="Sending reset link…">Send reset link</FormSubmit>
      </form>
      <p className="auth-links"><a href="/access/sign-in">Return to sign in</a></p>
    </main>
  );
}
