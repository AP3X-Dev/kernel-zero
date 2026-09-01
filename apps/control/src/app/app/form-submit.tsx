"use client";

import { useFormStatus } from "react-dom";

export function FormSubmit({ children, pendingLabel = "Saving…" }: Readonly<{
  children: string;
  pendingLabel?: string;
}>) {
  const { pending } = useFormStatus();
  return <button aria-disabled={pending} disabled={pending} type="submit">{pending ? pendingLabel : children}</button>;
}
