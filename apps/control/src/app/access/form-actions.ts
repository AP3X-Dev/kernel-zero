import "server-only";

import { z } from "zod";

import { safeLocalCallback } from "../../server/identity/callback";

const TrimmedText = (max: number) => z.string().trim().min(1).max(max);

export const CredentialsSchema = z.strictObject({
  callback: z.string().max(2048).nullish(),
  email: z.email().trim().max(320),
  password: z.string().min(1).max(256),
});

export const RegistrationSchema = CredentialsSchema.extend({ name: TrimmedText(120) });

export const EmailOnlySchema = z.strictObject({
  callback: z.string().max(2048).nullish(),
  email: z.email().trim().max(320),
});

export const NewPasswordSchema = z.strictObject({
  newPassword: z.string().min(8).max(256),
  token: z.string().trim().min(1).max(2048).nullish(),
});

export function formValue(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  return typeof value === "string" ? value : null;
}

export function callbackFrom(formData: FormData): string {
  return safeLocalCallback(formValue(formData, "callbackURL"));
}

// Better Auth rejects with an APIError carrying an HTTP status; anything else is an unexpected failure.
export function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return status;
  if (typeof status === "string") return status === "FORBIDDEN" ? 403 : null;
  return null;
}

export function withQuery(path: string, params: Readonly<Record<string, string>>): string {
  const query = new URLSearchParams(params).toString();
  return query.length === 0 ? path : `${path}?${query}`;
}
