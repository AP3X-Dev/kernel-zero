import { createEvidenceSchema, type EvidenceMessages } from "@kernel-zero/contracts";
import { z } from "zod";

export const FINDING_MESSAGE_CODES = Object.freeze([
  "BOUNDARY_PARSE_REQUIRED",
  "CALL_ARGUMENT_MISSING",
  "CALL_ARGUMENT_PROOF_FAILED",
  "CLOSED_REGISTRY_ENTRY_INVALID",
  "CLOSED_REGISTRY_PROOF_FAILED",
  "CONTEXT_PARAMETER_INVALID",
  "CONTEXT_PARAMETER_PROOF_FAILED",
  "DENIED_IMPORT",
  "GOVERNED_OPERATION_INVALID",
  "PARSE_FAILURE",
  "PROPERTY_WRITE_DENIED",
  "PROPERTY_WRITE_PROOF_FAILED",
  "REQUIRED_EXPORT_KEY_MISSING",
  "REQUIRED_IMPORT_MISSING",
  "RESTRICTED_CALL",
  "STATE_TRANSITION_DENIED",
  "STATE_TRANSITION_PROOF_FAILED",
  "TENANT_PARAMETER_MISSING",
  "UNREGISTERED_DECLARATION",
] as const);

export type FindingMessageCode = (typeof FINDING_MESSAGE_CODES)[number];

const messages: Readonly<Record<FindingMessageCode, string>> & EvidenceMessages = Object.freeze({
  BOUNDARY_PARSE_REQUIRED: "A public boundary value is not proven to be parsed.",
  CALL_ARGUMENT_MISSING: "A call to a governed operation omits a required argument field.",
  CALL_ARGUMENT_PROOF_FAILED: "A call to a governed operation could not be proven to carry a required argument field.",
  CLOSED_REGISTRY_ENTRY_INVALID: "A closed registry entry is missing required metadata or has an invalid identifier.",
  CLOSED_REGISTRY_PROOF_FAILED: "The closed registry invariant could not be proven from static declarations.",
  CONTEXT_PARAMETER_INVALID: "A required context parameter is missing or has a disallowed declaration.",
  CONTEXT_PARAMETER_PROOF_FAILED: "The required context parameter type could not be proven.",
  DENIED_IMPORT: "A denied dependency edge was found.",
  GOVERNED_OPERATION_INVALID: "A governed operation declaration is incomplete or invalid.",
  PARSE_FAILURE: "A claimed source file could not be parsed.",
  PROPERTY_WRITE_DENIED: "A protected property is written outside its allowed authority boundary.",
  PROPERTY_WRITE_PROOF_FAILED: "A protected property write could not be resolved well enough to prove its authority boundary.",
  REQUIRED_EXPORT_KEY_MISSING: "A required exported object key is missing.",
  REQUIRED_IMPORT_MISSING: "A required module import is missing.",
  RESTRICTED_CALL: "A restricted call was found outside its allowed location.",
  STATE_TRANSITION_DENIED: "A governed state field is written outside its allowed writer or through an unlisted transition.",
  STATE_TRANSITION_PROOF_FAILED: "A write to a governed state field could not be proven against the allowed transitions.",
  TENANT_PARAMETER_MISSING: "A tenant-scoped symbol is missing its required tenant parameter.",
  UNREGISTERED_DECLARATION: "A declaration is not present in its required closed registry.",
});

const built = createEvidenceSchema({ evidenceKind: "RepositoryEvidence", toolName: "kernel-zero-validator", messages });

export const RepositoryEvidenceSchema = built.schema;

export type RepositoryEvidence = z.infer<typeof built.base>;

export function findingMessage(code: FindingMessageCode): string {
  return messages[code];
}

export function repositoryEvidenceJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(built.schema, { io: "input", reused: "ref" });
}
