import "server-only";

import type { AppErrorCode } from "@kernel-zero/domain";

const CONSTRAINT_CODES: Readonly<Record<string, AppErrorCode>> = Object.freeze({
  audit_actor_shape_check: "VALIDATION_FAILED",
  audit_metadata_bounds_check: "VALIDATION_FAILED",
  audit_record_immutable_update: "CONFLICT",
});

export class PersistenceConstraintError extends Error {
  readonly code: AppErrorCode;
  readonly constraint: string;

  constructor(code: AppErrorCode, constraint: string) {
    super("A database invariant rejected the requested change.");
    this.name = "PersistenceConstraintError";
    this.code = code;
    this.constraint = constraint;
  }
}

export function mapKnownPersistenceError(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return error;
  const candidate = error as { constraint?: unknown; meta?: { constraint?: unknown; target?: unknown } };
  const constraint = typeof candidate.meta?.constraint === "string"
    ? candidate.meta.constraint
    : typeof candidate.constraint === "string"
      ? candidate.constraint
      : typeof candidate.meta?.target === "string"
        ? candidate.meta.target
        : null;
  if (constraint === null) return error;
  const code = CONSTRAINT_CODES[constraint];
  return code === undefined ? error : new PersistenceConstraintError(code, constraint);
}
