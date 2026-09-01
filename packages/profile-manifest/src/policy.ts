import { z } from "zod";

import { SlugSchema, uniqueArray } from "@kernel-zero/contracts";

const ManifestCheckSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("allowed-licenses"), allowed: uniqueArray(z.string().min(1).max(64), 1, 50) }),
  z.strictObject({ kind: z.literal("pinned-dependencies"), fields: uniqueArray(z.enum(["dependencies", "devDependencies", "optionalDependencies"]), 1, 3) }),
]);

const ManifestRuleSchema = z.strictObject({
  id: SlugSchema(3, 80),
  title: z.string().trim().min(1).max(120),
  level: z.enum(["error", "warning"]),
  check: ManifestCheckSchema,
  remediation: z.string().trim().min(1).max(500),
});

export const ManifestPolicySchema = z.strictObject({
  apiVersion: z.literal("kernel-zero.dev/v1"),
  kind: z.literal("ManifestPolicy"),
  metadata: z.strictObject({
    name: SlugSchema(3, 64),
    revision: z.number().int().min(1),
    description: z.string().trim().min(1).max(500),
  }),
  rules: uniqueArray(ManifestRuleSchema, 1, 100).superRefine((rules, context) => {
    if (new Set(rules.map((rule) => rule.id)).size !== rules.length) {
      context.addIssue({ code: "custom", message: "Rule IDs must be unique." });
    }
  }),
});

export type ManifestPolicy = z.infer<typeof ManifestPolicySchema>;

export type ManifestRule = ManifestPolicy["rules"][number];

export function manifestPolicyJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ManifestPolicySchema, { io: "input", reused: "ref" });
}
