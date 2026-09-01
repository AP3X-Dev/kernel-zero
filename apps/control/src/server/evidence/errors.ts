import "server-only";

import type { AppErrorCode } from "@kernel-zero/domain";

export class EvidenceIngressError extends Error {
  readonly code: AppErrorCode;
  readonly reason: string;
  readonly status: number;

  constructor(status: number, code: AppErrorCode, reason: string) {
    super(code === "INVALID_EVIDENCE" ? "The evidence document is invalid." : "The evidence request could not be completed.");
    this.name = "EvidenceIngressError";
    this.code = code;
    this.reason = reason;
    this.status = status;
  }
}

export function invalidEvidence(reason: string, status = 422): EvidenceIngressError {
  return new EvidenceIngressError(status, "INVALID_EVIDENCE", reason);
}
