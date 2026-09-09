import { z } from "zod";

import { NonemptyExactStringSchema, RelativeGlobSchema, SlugSchema, uniqueArray } from "@kernel-zero/contracts";

import { LAYER_REFERENCE_PREFIX, isLayerReference, ruleFileLists } from "./layers";

export const REPOSITORY_POLICY_MEDIA_TYPE = "application/vnd.kernel-zero.policy+json;version=1" as const;

// Scope lists hold globs only; rule lists may also hold `layer:<name>` references, which the policy-level refinement checks.
const GlobList = uniqueArray(RelativeGlobSchema, 1, 100);
const OptionalGlobList = uniqueArray(RelativeGlobSchema, 0, 100);
const RuleGlobList = GlobList;
const OptionalRuleGlobList = OptionalGlobList;
export const LayerNameSchema = SlugSchema(2, 40);
const MAX_LAYERS = 50;
const LayerGlobSchema = RelativeGlobSchema.refine((value) => !isLayerReference(value), "Layer values must be globs, not layer references.");
const LayersSchema = z.record(LayerNameSchema, uniqueArray(LayerGlobSchema, 1, 100)).refine(
  (layers) => Object.keys(layers).length <= MAX_LAYERS,
  `At most ${String(MAX_LAYERS)} layers may be declared.`,
);
const ExactList = uniqueArray(NonemptyExactStringSchema, 1, 100);
const ModuleDenialSchema = z.string().min(6).max(500).refine(
  (value) => value.startsWith("module:") || value.startsWith("module-prefix:") || value.startsWith("path:"),
  "Denied targets must declare module, module-prefix, or path semantics.",
);

export const IdentifierSchema = z.string().min(1).max(200).regex(/^[A-Za-z_$][\w$]*$/u, "Export names must be a single identifier.");
/** One legal state pair; `from: "*"` allows any source state for that `to`. */
const StateTransitionSchema = z.strictObject({ from: z.union([IdentifierSchema, z.literal("*")]), to: IdentifierSchema });
/** A glob over a resolved callee chain such as `*.findMany` or `prisma.*.updateMany`; `*` spans dots. */
export const CalleeGlobSchema = z.string().min(1).max(200).regex(/^[A-Za-z_$*][\w$*]*(?:\.[A-Za-z_$*][\w$*]*)*$/u, "Callee globs must be dotted identifier segments, each of which may contain *.");
/** 1..8 identifier segments joined by `.`, such as `where.workspaceId`. */
export const DottedPathSchema = z.string().min(1).max(200).regex(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,7}$/u, "Dotted paths must be 1 to 8 identifier segments.");
const RelativeTypeScriptFileSchema = RelativeGlobSchema.refine(
  (value) => !/[*?[\]{}]/u.test(value) && /\.(?:ts|tsx)$/u.test(value),
  "Type files must be one exact contained TypeScript file, not a glob.",
);
export const TypeReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("intrinsic"), name: z.enum(["string", "number", "boolean", "bigint"]) }),
  z.strictObject({ kind: z.literal("export"), file: RelativeTypeScriptFileSchema, exportName: IdentifierSchema }),
]);

export const PolicyCheckSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("forbid-import-edge"), from: RuleGlobList, deny: uniqueArray(ModuleDenialSchema, 1, 100) }),
  z.strictObject({ kind: z.literal("require-import"), files: RuleGlobList, module: NonemptyExactStringSchema, allowTypeOnly: z.boolean().default(false) }),
  z.strictObject({ kind: z.literal("restrict-call-site"), callee: ExactList, allowFrom: RuleGlobList, requireResolution: z.boolean().default(true) }),
  z.strictObject({ kind: z.literal("require-export-keys"), files: RuleGlobList, exportName: NonemptyExactStringSchema, requiredKeys: ExactList }),
  z.strictObject({ kind: z.literal("require-tenant-parameter"), files: RuleGlobList, symbols: NonemptyExactStringSchema, parameter: NonemptyExactStringSchema.default("workspaceId") }),
  z.strictObject({ kind: z.literal("require-boundary-parse"), files: RuleGlobList, boundaryCalls: ExactList, parserCalls: ExactList }),
  z.strictObject({
    kind: z.literal("require-governed-operation"),
    files: RuleGlobList,
    registryExport: NonemptyExactStringSchema,
    // ponytail: a registry may declare any non-empty subset of the closed key set; the kernel declares three since the SaaS shell left.
    requiredKeys: uniqueArray(z.enum(["capability", "tenantScope", "quota", "audit", "idempotency"]), 1, 5),
    declarationCalls: ExactList.default(["defineGovernedAction"]),
  }),
  z.strictObject({
    kind: z.literal("require-context-parameter"),
    files: RuleGlobList,
    symbols: NonemptyExactStringSchema,
    parameter: NonemptyExactStringSchema,
    expectedType: TypeReferenceSchema.nullable().default(null),
  }),
  z.strictObject({
    kind: z.literal("require-closed-registry"),
    registryFile: RelativeTypeScriptFileSchema,
    registryExport: IdentifierSchema,
    declarationFiles: RuleGlobList,
    declarationCalls: ExactList,
    requiredKeys: uniqueArray(NonemptyExactStringSchema, 0, 100),
  }),
  z.strictObject({
    kind: z.literal("restrict-property-write"),
    files: RuleGlobList,
    targetType: z.strictObject({ file: RelativeTypeScriptFileSchema, exportName: IdentifierSchema }),
    property: IdentifierSchema,
    allowFrom: OptionalRuleGlobList,
  }),
  z.strictObject({
    kind: z.literal("require-call-argument"),
    files: RuleGlobList,
    callee: uniqueArray(CalleeGlobSchema, 1, 100),
    argument: z.number().int().min(0).max(9).default(0),
    requiredPath: DottedPathSchema,
    allowFrom: OptionalRuleGlobList.default([]),
  }),
  z.strictObject({
    kind: z.literal("restrict-state-transition"),
    callee: uniqueArray(CalleeGlobSchema, 1, 100),
    argument: z.number().int().min(0).max(9).default(0),
    field: DottedPathSchema,
    allowFrom: OptionalRuleGlobList.default([]),
    transitions: uniqueArray(StateTransitionSchema, 0, 100).default([]),
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
  // exactOptional: an absent key stays absent in the parsed document, so a layer-free policy keeps its digest and the type stays a JsonValue.
  layers: LayersSchema.exactOptional(),
  rules: uniqueArray(PolicyRuleSchema, 1, 500).superRefine((rules, context) => {
    if (new Set(rules.map((rule) => rule.id)).size !== rules.length) {
      context.addIssue({ code: "custom", message: "Rule IDs must be unique." });
    }
  }),
}).superRefine((policy, context) => {
  for (const field of ["include", "exclude"] as const) {
    for (const entry of policy.scope[field]) {
      if (isLayerReference(entry)) {
        context.addIssue({ code: "custom", message: `Layer reference is not allowed in scope: ${entry}`, path: ["scope", field] });
      }
    }
  }
  const layers = policy.layers ?? {};
  policy.rules.forEach((rule, index) => {
    for (const [field, entries] of ruleFileLists(rule.check)) {
      for (const entry of entries) {
        if (!isLayerReference(entry)) continue;
        const name = entry.slice(LAYER_REFERENCE_PREFIX.length);
        const path = ["rules", index, "check", field];
        if (!LayerNameSchema.safeParse(name).success) {
          context.addIssue({ code: "custom", message: `Layer reference is not a slug: ${entry}`, path });
        } else if (!Object.hasOwn(layers, name)) {
          context.addIssue({ code: "custom", message: `Layer is not declared: ${name} (rule ${rule.id}, field ${field})`, path });
        }
      }
    }
  });
});

export type RepositoryPolicy = z.infer<typeof RepositoryPolicySchema>;

export function repositoryPolicyJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(RepositoryPolicySchema, { io: "input", reused: "ref" });
}
