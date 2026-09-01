import { appError, type AppError } from "./errors";
import { err, ok, type Result } from "./result";

export type RelativePosixPath = string & { readonly __brand: "RelativePosixPath" };

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function normalizeRelativePath(value: unknown): Result<RelativePosixPath, AppError> {
  if (typeof value !== "string" || value.length === 0 || hasControlCharacter(value)) {
    return err(appError("VALIDATION_FAILED", { details: { field: "path" } }));
  }
  if (/^[a-zA-Z]:[\\/]/u.test(value) || /^[\\/]{1,2}/u.test(value)) {
    return err(appError("VALIDATION_FAILED", { details: { field: "path" } }));
  }
  const segments = value.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment === "..")) {
    return err(appError("VALIDATION_FAILED", { details: { field: "path" } }));
  }
  const normalized = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (normalized.length === 0) {
    return err(appError("VALIDATION_FAILED", { details: { field: "path" } }));
  }
  return ok(normalized as RelativePosixPath);
}
