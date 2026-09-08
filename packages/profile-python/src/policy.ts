import { z } from "zod";

import { NonemptyExactStringSchema, RelativeGlobSchema, SlugSchema, uniqueArray } from "@kernel-zero/contracts";

const GlobList = uniqueArray(RelativeGlobSchema, 1, 100);
const OptionalGlobList = uniqueArray(RelativeGlobSchema, 0, 100);
const PythonIdentifierSchema = z.string().min(1).max(200).regex(/^[A-Za-z_][A-Za-z0-9_]*$/u);
const PythonModuleSchema = z.string().min(1).max(300).regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/u);
const PythonCalleeSchema = z.string().min(1).max(300).regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/u);
const PythonSymbolPatternSchema = NonemptyExactStringSchema.refine(
  (value) => /^(?:\*|[A-Za-z_][A-Za-z0-9_]*)(?:\.(?:\*|[A-Za-z_][A-Za-z0-9_]*))*$/u.test(value),
  "Python symbol patterns contain identifiers separated by dots and may use a whole-segment wildcard.",
);

export const PythonPolicyCheckSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("forbid-import-edge"), from: GlobList, deny: uniqueArray(PythonModuleSchema, 1, 100) }),
  z.strictObject({ kind: z.literal("require-import"), files: GlobList, module: PythonModuleSchema }),
  z.strictObject({ kind: z.literal("restrict-call-site"), callee: uniqueArray(PythonCalleeSchema, 1, 100), allowFrom: OptionalGlobList }),
  z.strictObject({ kind: z.literal("require-context-parameter"), files: GlobList, symbols: PythonSymbolPatternSchema, parameter: PythonIdentifierSchema }),
]);

const PythonPolicyRuleSchema = z.strictObject({
  id: SlugSchema(3, 80),
  title: z.string().trim().min(1).max(120),
  level: z.enum(["error", "warning"]),
  check: PythonPolicyCheckSchema,
  remediation: z.string().trim().min(1).max(500),
});

export const PythonPolicySchema = z.strictObject({
  apiVersion: z.literal("kernel-zero.dev/v1"),
  kind: z.literal("PythonPolicy"),
  metadata: z.strictObject({
    name: SlugSchema(3, 64),
    revision: z.number().int().min(1),
    description: z.string().trim().min(1).max(500),
  }),
  scope: z.strictObject({ include: GlobList, exclude: OptionalGlobList }),
  rules: uniqueArray(PythonPolicyRuleSchema, 1, 500).superRefine((rules, context) => {
    if (new Set(rules.map((rule) => rule.id)).size !== rules.length) {
      context.addIssue({ code: "custom", message: "Rule IDs must be unique." });
    }
    if (!rules.some((rule) => rule.level === "error")) {
      context.addIssue({ code: "custom", message: "At least one error-level rule is required so parse failures fail closed." });
    }
  }),
});

export type PythonPolicy = z.infer<typeof PythonPolicySchema>;
export type PythonPolicyRule = PythonPolicy["rules"][number];

export function pythonPolicyJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(PythonPolicySchema, { io: "input", reused: "ref" });
}
