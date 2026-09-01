import { appError, type AppError } from "./errors";
import { err, ok, type Result } from "./result";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
const MAX_CURSOR_LENGTH = 512;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export type Pagination = Readonly<{ limit: number; cursor?: string }>;

export function parsePagination(
  input: Readonly<{ limit?: unknown; cursor?: unknown }> = {},
): Result<Pagination, AppError> {
  const limit = input.limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || typeof limit !== "number" || limit < 1 || limit > MAX_PAGE_SIZE) {
    return err(appError("VALIDATION_FAILED", { details: { field: "limit" } }));
  }

  if (input.cursor === undefined || input.cursor === null) return ok({ limit });
  if (
    typeof input.cursor !== "string" ||
    input.cursor.length === 0 ||
    input.cursor.length > MAX_CURSOR_LENGTH ||
    input.cursor.trim() !== input.cursor ||
    hasControlCharacter(input.cursor)
  ) {
    return err(appError("VALIDATION_FAILED", { details: { field: "cursor" } }));
  }
  return ok({ cursor: input.cursor, limit });
}
