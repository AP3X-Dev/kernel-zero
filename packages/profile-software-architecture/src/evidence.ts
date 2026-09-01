import { createEvidenceSchema, type EvidenceMessages } from "@kernel-zero/contracts";
import { z } from "zod";

export const FINDING_MESSAGE_CODES = Object.freeze([
  "BOUNDARY_PARSE_REQUIRED",
  "DENIED_IMPORT",
  "GOVERNED_OPERATION_INVALID",
  "PARSE_FAILURE",
  "REQUIRED_EXPORT_KEY_MISSING",
  "REQUIRED_IMPORT_MISSING",
  "RESTRICTED_CALL",
  "TENANT_PARAMETER_MISSING",
] as const);

export type FindingMessageCode = (typeof FINDING_MESSAGE_CODES)[number];

const messages: Readonly<Record<FindingMessageCode, string>> & EvidenceMessages = Object.freeze({
  BOUNDARY_PARSE_REQUIRED: "A public boundary value is not proven to be parsed.",
  DENIED_IMPORT: "A denied dependency edge was found.",
  GOVERNED_OPERATION_INVALID: "A governed operation declaration is incomplete or invalid.",
  PARSE_FAILURE: "A claimed source file could not be parsed.",
  REQUIRED_EXPORT_KEY_MISSING: "A required exported object key is missing.",
  REQUIRED_IMPORT_MISSING: "A required module import is missing.",
  RESTRICTED_CALL: "A restricted call was found outside its allowed location.",
  TENANT_PARAMETER_MISSING: "A tenant-scoped symbol is missing its required tenant parameter.",
});

const built = createEvidenceSchema({ evidenceKind: "RepositoryEvidence", toolName: "kernel-zero-validator", messages });

export const RepositoryEvidenceSchema = built.schema;

export type RepositoryEvidence = z.infer<typeof built.base>;

export function findingMessage(code: FindingMessageCode): string {
  return messages[code];
}

export function repositoryEvidenceJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(built.base, { io: "input", reused: "ref" });
}
