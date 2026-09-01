import { randomBytes } from "node:crypto";

import { appError, type AppError } from "./errors";
import { err, ok, type Result } from "./result";

export const MAX_WORKSPACE_SLUG_LENGTH = 48;
export type WorkspaceSlug = string & { readonly __brand: "WorkspaceSlug" };

export function workspaceSlug(value: unknown): Result<WorkspaceSlug, AppError> {
  if (typeof value !== "string") {
    return err(appError("VALIDATION_FAILED", { details: { field: "slug" } }));
  }
  const normalized = value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MAX_WORKSPACE_SLUG_LENGTH)
    .replace(/-+$/gu, "");
  return normalized.length === 0
    ? err(appError("VALIDATION_FAILED", { details: { field: "slug" } }))
    : ok(normalized as WorkspaceSlug);
}

export function withCollisionSuffix(
  slug: WorkspaceSlug,
  random: (size: number) => Uint8Array = randomBytes,
): WorkspaceSlug {
  const suffix = [...random(4)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const prefixLength = MAX_WORKSPACE_SLUG_LENGTH - suffix.length - 1;
  const prefix = slug.slice(0, prefixLength).replace(/-+$/gu, "");
  return `${prefix}-${suffix}` as WorkspaceSlug;
}
