import { FormSubmit } from "../../app/form-submit";

export default function ResetPage() {
  return (
    <main id="main-content">
      <h1>Choose a new password</h1>
      <form action="/api/auth/reset-password" method="post">
        <label htmlFor="password">New password</label>
        <input autoComplete="new-password" id="password" minLength={8} name="newPassword" required type="password" />
        <FormSubmit pendingLabel="Resetting password…">Reset password</FormSubmit>
      </form>
    </main>
  );
}
