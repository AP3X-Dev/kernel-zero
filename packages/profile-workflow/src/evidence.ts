import { createEvidenceSchema, type EvidenceMessages } from "@kernel-zero/contracts";
import { z } from "zod";

export const WORKFLOW_MESSAGE_CODES = Object.freeze([
  "ACTION_NOT_PINNED",
  "PARSE_FAILURE",
  "PERMISSIONS_MISSING",
  "PERMISSION_TOO_BROAD",
] as const);

export type WorkflowMessageCode = (typeof WORKFLOW_MESSAGE_CODES)[number];

export const workflowMessages: Readonly<Record<WorkflowMessageCode, string>> & EvidenceMessages = Object.freeze({
  ACTION_NOT_PINNED: "A workflow step uses an action reference the policy does not accept as pinned.",
  PARSE_FAILURE: "A claimed workflow file could not be parsed.",
  PERMISSIONS_MISSING: "A workflow does not declare top-level permissions.",
  PERMISSION_TOO_BROAD: "A workflow grants a write permission the policy does not allow.",
});

const built = createEvidenceSchema({ evidenceKind: "WorkflowEvidence", toolName: "kernel-zero-workflow", messages: workflowMessages });

export const WorkflowEvidenceSchema = built.schema;

export type WorkflowEvidence = z.infer<typeof built.base>;

export function workflowEvidenceJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(built.schema, { io: "input", reused: "ref" });
}
