import { z } from "zod";

import { RelativeGlobSchema, SlugSchema, uniqueArray } from "@kernel-zero/contracts";

export const DEFAULT_WORKFLOW_INCLUDE = Object.freeze([
  ".github/workflows/*.yml",
  ".github/workflows/*.yaml",
] as const);

const WorkflowCheckSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("pinned-actions"), mode: z.enum(["sha", "tag"]) }),
  z.strictObject({ kind: z.literal("restricted-permissions"), allowWrite: uniqueArray(SlugSchema(3, 64), 0, 30) }),
]);

const WorkflowRuleSchema = z.strictObject({
  id: SlugSchema(3, 80),
  title: z.string().trim().min(1).max(120),
  level: z.enum(["error", "warning"]),
  check: WorkflowCheckSchema,
  remediation: z.string().trim().min(1).max(500),
});

export const WorkflowPolicySchema = z.strictObject({
  apiVersion: z.literal("kernel-zero.dev/v1"),
  kind: z.literal("WorkflowPolicy"),
  metadata: z.strictObject({
    name: SlugSchema(3, 64),
    revision: z.number().int().min(1),
    description: z.string().trim().min(1).max(500),
  }),
  // A repository that wants a workflow unjudged narrows include; there is deliberately no exclude.
  scope: z.strictObject({ include: uniqueArray(RelativeGlobSchema, 1, 50) }).default({ include: [...DEFAULT_WORKFLOW_INCLUDE] }),
  rules: uniqueArray(WorkflowRuleSchema, 1, 100).superRefine((rules, context) => {
    if (new Set(rules.map((rule) => rule.id)).size !== rules.length) {
      context.addIssue({ code: "custom", message: "Rule IDs must be unique." });
    }
  }),
});

export type WorkflowPolicy = z.infer<typeof WorkflowPolicySchema>;

export type WorkflowRule = WorkflowPolicy["rules"][number];

export function workflowPolicyJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(WorkflowPolicySchema, { io: "input", reused: "ref" });
}
