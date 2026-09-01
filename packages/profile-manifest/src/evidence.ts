import { createEvidenceSchema, type EvidenceMessages } from "@kernel-zero/contracts";
import { z } from "zod";

export const MANIFEST_MESSAGE_CODES = Object.freeze([
  "DEPENDENCY_NOT_PINNED",
  "LICENSE_NOT_ALLOWED",
  "PARSE_FAILURE",
] as const);

export type ManifestMessageCode = (typeof MANIFEST_MESSAGE_CODES)[number];

export const manifestMessages: Readonly<Record<ManifestMessageCode, string>> & EvidenceMessages = Object.freeze({
  DEPENDENCY_NOT_PINNED: "A dependency uses a version range instead of an exact version.",
  LICENSE_NOT_ALLOWED: "The manifest license is not in the allowed list.",
  PARSE_FAILURE: "A claimed manifest file could not be parsed.",
});

const built = createEvidenceSchema({ evidenceKind: "ManifestEvidence", toolName: "kernel-zero-manifest", messages: manifestMessages });

export const ManifestEvidenceSchema = built.schema;

export type ManifestEvidence = z.infer<typeof built.base>;

export function manifestEvidenceJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(built.schema, { io: "input", reused: "ref" });
}
