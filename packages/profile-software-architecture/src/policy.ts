import { z } from "zod";

import { NonemptyExactStringSchema, RelativeGlobSchema, SlugSchema, uniqueArray } from "@kernel-zero/contracts";

export const REPOSITORY_POLICY_MEDIA_TYPE = "application/vnd.kernel-zero.policy+json;version=1" as const;

const GlobList = uniqueArray(RelativeGlobSchema, 1, 100);
const OptionalGlobList = uniqueArray(RelativeGlobSchema, 0, 100);
const ExactList = uniqueArray(NonemptyExactStringSchema, 1, 100);
const ModuleDenialSchema = z.string().min(6).max(500).refine(
  (value) => value.startsWith("module:") || value.startsWith("module-prefix:") || value.startsWith("path:"),
  "Denied targets must declare module, module-prefix, or path semantics.",
);

const IdentifierSchema = z.string().min(1).max(200).regex(/^[A-Za-z_$][\w$]*$/u, "Export names must be a single identifier.");
const RelativeTypeScriptFileSchema = RelativeGlobSchema.refine(
  (value) => !/[*?[\]{}]/u.test(value) && /\.(?:ts|tsx)$/u.test(value),
  "Type files must be one exact contained TypeScript file, not a glob.",
);
export const TypeReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("intrinsic"), name: z.enum(["string", "number", "boolean", "bigint"]) }),
  z.strictObject({ kind: z.literal("export"), file: RelativeTypeScriptFileSchema, exportName: IdentifierSchema }),
]);

export const PolicyCheckSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("forbid-import-edge"), from: GlobList, deny: uniqueArray(ModuleDenialSchema, 1, 100) }),
  z.strictObject({ kind: z.literal("require-import"), files: GlobList, module: NonemptyExactStringSchema, allowTypeOnly: z.boolean().default(false) }),
  z.strictObject({ kind: z.literal("restrict-call-site"), callee: ExactList, allowFrom: GlobList, requireResolution: z.boolean().default(true) }),
  z.strictObject({ kind: z.literal("require-export-keys"), files: GlobList, exportName: NonemptyExactStringSchema, requiredKeys: ExactList }),
  z.strictObject({ kind: z.literal("require-tenant-parameter"), files: GlobList, symbols: NonemptyExactStringSchema, parameter: NonemptyExactStringSchema.default("workspaceId") }),
  z.strictObject({ kind: z.literal("require-boundary-parse"), files: GlobList, boundaryCalls: ExactList, parserCalls: ExactList }),
  z.strictObject({
    kind: z.literal("require-governed-operation"),
    files: GlobList,
    registryExport: NonemptyExactStringSchema,
    requiredKeys: uniqueArray(z.enum(["capability", "tenantScope", "quota", "audit", "idempotency"]), 5, 5),
    declarationCalls: ExactList.default(["defineGovernedAction"]),
  }),
  z.strictObject({
    kind: z.literal("require-context-parameter"),
    files: GlobList,
    symbols: NonemptyExactStringSchema,
    parameter: NonemptyExactStringSchema,
    expectedType: TypeReferenceSchema.nullable().default(null),
  }),
  z.strictObject({
    kind: z.literal("require-closed-registry"),
    registryFile: RelativeTypeScriptFileSchema,
    registryExport: IdentifierSchema,
    declarationFiles: GlobList,
    declarationCalls: ExactList,
    requiredKeys: uniqueArray(NonemptyExactStringSchema, 0, 100),
  }),
  z.strictObject({
    kind: z.literal("restrict-property-write"),
    files: GlobList,
    targetType: z.strictObject({ file: RelativeTypeScriptFileSchema, exportName: IdentifierSchema }),
    property: IdentifierSchema,
    allowFrom: OptionalGlobList,
  }),
]);

const PolicyRuleSchema = z.strictObject({
  id: SlugSchema(3, 80),
  title: z.string().trim().min(1).max(120),
  level: z.enum(["error", "warning"]),
  check: PolicyCheckSchema,
  remediation: z.string().trim().min(1).max(500),
});

export const RepositoryPolicySchema = z.strictObject({
  apiVersion: z.literal("kernel-zero.dev/v1"),
  kind: z.literal("RepositoryPolicy"),
  metadata: z.strictObject({
    name: SlugSchema(3, 64),
    revision: z.number().int().min(1),
    description: z.string().trim().min(1).max(500),
  }),
  scope: z.strictObject({
    languages: uniqueArray(z.enum(["typescript", "tsx"]), 1, 2),
    include: GlobList,
    exclude: OptionalGlobList,
  }),
  rules: uniqueArray(PolicyRuleSchema, 1, 500).superRefine((rules, context) => {
    if (new Set(rules.map((rule) => rule.id)).size !== rules.length) {
      context.addIssue({ code: "custom", message: "Rule IDs must be unique." });
    }
  }),
});

export type RepositoryPolicy = z.infer<typeof RepositoryPolicySchema>;

export function repositoryPolicyJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(RepositoryPolicySchema, { io: "input", reused: "ref" });
}
