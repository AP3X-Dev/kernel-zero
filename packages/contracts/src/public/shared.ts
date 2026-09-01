import { z } from "zod";

import type { Sha256Digest } from "@kernel-zero/domain";

export const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u) as z.ZodType<Sha256Digest>;
export const UuidV7Schema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
export const InstantSchema = z.iso.datetime({ offset: true });

export const SlugSchema = (minimum: number, maximum: number) =>
  z.string().min(minimum).max(maximum).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export function uniqueArray<T extends z.ZodType>(item: T, minimum: number, maximum: number) {
  return z.array(item).min(minimum).max(maximum).superRefine((values, context) => {
    if (new Set(values.map((value) => JSON.stringify(value))).size !== values.length) {
      context.addIssue({ code: "custom", message: "Array values must be unique." });
    }
  });
}

export const RelativeGlobSchema = z.string().min(1).max(500).superRefine((value, context) => {
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    value !== normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized) ||
    segments.includes("..") ||
    normalized.includes("\0")
  ) {
    context.addIssue({ code: "custom", message: "Glob must be a contained relative POSIX pattern." });
  }
});

export const NonemptyExactStringSchema = z.string().trim().min(1).max(500);
