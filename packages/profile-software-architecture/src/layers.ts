import type { RepositoryPolicy } from "./policy";

export const LAYER_REFERENCE_PREFIX = "layer:";

type PolicyCheck = RepositoryPolicy["rules"][number]["check"];

// Field discovery is by name so a future check kind that reuses one of these names inherits layer references.
const RULE_FILE_FIELDS = ["from", "files", "allowFrom", "declarationFiles"] as const;

export type RuleFileField = (typeof RULE_FILE_FIELDS)[number];

export function isLayerReference(value: string): boolean {
  return value.startsWith(LAYER_REFERENCE_PREFIX);
}

/** The file-naming lists a check carries, by field name; scope lists are never included. */
export function ruleFileLists(check: PolicyCheck): readonly (readonly [RuleFileField, readonly string[]])[] {
  const record: Record<string, unknown> = check;
  const lists: (readonly [RuleFileField, readonly string[]])[] = [];
  for (const field of RULE_FILE_FIELDS) {
    const value = record[field];
    if (isStringArray(value)) lists.push([field, value]);
  }
  return lists;
}

/** Equal policy whose rule file lists contain only globs. Idempotent. `layers` and `scope` untouched. */
export function resolvePolicyLayers(policy: RepositoryPolicy): RepositoryPolicy {
  const layers = policy.layers ?? {};
  const rules = policy.rules.map((rule) => {
    const check: Record<string, unknown> = { ...rule.check };
    for (const [field, globs] of ruleFileLists(rule.check)) {
      check[field] = expandGlobList(globs, layers);
    }
    return Object.freeze({ ...rule, check: Object.freeze(check) as PolicyCheck });
  });
  Object.freeze(rules);
  return Object.freeze({ ...policy, rules });
}

function expandGlobList(globs: readonly string[], layers: Readonly<Record<string, readonly string[]>>): string[] {
  const expanded = new Set<string>();
  for (const entry of globs) {
    if (!isLayerReference(entry)) {
      expanded.add(entry);
      continue;
    }
    const name = entry.slice(LAYER_REFERENCE_PREFIX.length);
    const members = layers[name];
    if (members === undefined) throw new Error(`Layer is not declared: ${name}`);
    for (const glob of members) expanded.add(glob);
  }
  const result = [...expanded];
  Object.freeze(result);
  return result;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
