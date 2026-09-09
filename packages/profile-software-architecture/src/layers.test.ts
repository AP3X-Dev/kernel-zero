import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { LAYER_REFERENCE_PREFIX, isLayerReference, resolvePolicyLayers, ruleFileLists } from "./layers";
import { RepositoryPolicySchema, type RepositoryPolicy } from "./policy";

const LAYERS = {
  persistence: ["packages/persistence/src/**/*.ts"],
  service: ["apps/control/src/server/**/*.ts", "packages/persistence/src/**/*.ts"],
  ui: ["apps/control/src/app/**/page.tsx", "apps/control/src/app/**/layout.tsx"],
} as const;

function policy(overrides: Record<string, unknown> = {}, layers: Record<string, readonly string[]> | null = LAYERS): RepositoryPolicy {
  return RepositoryPolicySchema.parse({
    apiVersion: "kernel-zero.dev/v1",
    kind: "RepositoryPolicy",
    ...(layers === null ? {} : { layers }),
    metadata: { description: "Layered policy", name: "layered", revision: 1 },
    rules: [
      {
        check: { deny: ["module:@prisma/client"], from: ["layer:ui", "layer:service", "packages/persistence/src/**/*.ts"], kind: "forbid-import-edge" },
        id: "ui-no-prisma", level: "error", remediation: "Use a service.", title: "UI",
      },
      {
        check: { allowTypeOnly: false, files: ["layer:service", "layer:persistence"], kind: "require-import", module: "server-only" },
        id: "server-only", level: "error", remediation: "Import server-only.", title: "Server",
      },
      {
        check: { allowFrom: ["layer:persistence"], callee: ["db.query"], kind: "restrict-call-site", requireResolution: true },
        id: "db-query", level: "warning", remediation: "Call from persistence.", title: "Calls",
      },
    ],
    scope: { exclude: ["**/*.test.ts"], include: ["apps/**/*.ts", "packages/**/*.ts"], languages: ["typescript"] },
    ...overrides,
  });
}

describe("policy layers", () => {
  it("recognizes references by prefix and discovers rule file lists by field name", () => {
    expect(isLayerReference(`${LAYER_REFERENCE_PREFIX}ui`)).toBe(true);
    expect(isLayerReference("apps/**")).toBe(false);
    expect(policy().rules.map((rule) => ruleFileLists(rule.check).map(([field]) => field))).toEqual([["from"], ["files"], ["allowFrom"]]);
    const registry: RepositoryPolicy["rules"][number]["check"] = { declarationCalls: ["define"], declarationFiles: ["src/**"], kind: "require-closed-registry", registryExport: "R", registryFile: "src/r.ts", requiredKeys: [] };
    expect(ruleFileLists(registry).map(([field]) => field)).toEqual(["declarationFiles"]);
  });

  it("expands references in declaration order and de-duplicates while keeping the first occurrence", () => {
    const resolved = resolvePolicyLayers(policy());
    expect(resolved.rules.map((rule) => rule.check)).toEqual([
      {
        deny: ["module:@prisma/client"],
        from: ["apps/control/src/app/**/page.tsx", "apps/control/src/app/**/layout.tsx", "apps/control/src/server/**/*.ts", "packages/persistence/src/**/*.ts"],
        kind: "forbid-import-edge",
      },
      { allowTypeOnly: false, files: ["apps/control/src/server/**/*.ts", "packages/persistence/src/**/*.ts"], kind: "require-import", module: "server-only" },
      { allowFrom: ["packages/persistence/src/**/*.ts"], callee: ["db.query"], kind: "restrict-call-site", requireResolution: true },
    ]);
  });

  it("is idempotent, frozen, and leaves layers, scope, metadata, and rule identity untouched", () => {
    const input = policy();
    const once = resolvePolicyLayers(input);
    const twice = resolvePolicyLayers(once);
    expect(twice).toEqual(once);
    expect(Object.isFrozen(once)).toBe(true);
    expect(Object.isFrozen(once.rules)).toBe(true);
    expect(once.rules.every((rule) => Object.isFrozen(rule) && Object.isFrozen(rule.check))).toBe(true);
    expect(once.rules.every((rule) => ruleFileLists(rule.check).every(([, globs]) => Object.isFrozen(globs)))).toBe(true);
    expect(once.layers).toEqual(input.layers);
    expect(once.scope).toEqual(input.scope);
    expect(once.metadata).toEqual(input.metadata);
    expect(once.rules.map((rule) => [rule.id, rule.level, rule.title, rule.remediation])).toEqual(input.rules.map((rule) => [rule.id, rule.level, rule.title, rule.remediation]));
    expect(input.rules[0]?.check).toMatchObject({ from: ["layer:ui", "layer:service", "packages/persistence/src/**/*.ts"] });
  });

  it("returns an equal document for a policy without layers", () => {
    const plain = policy({
      rules: [{ check: { deny: ["module:x"], from: ["apps/**"], kind: "forbid-import-edge" }, id: "plain", level: "error", remediation: "r", title: "t" }],
    }, null);
    expect("layers" in plain).toBe(false);
    const resolved = resolvePolicyLayers(plain);
    expect(resolved).toEqual(plain);
    expect("layers" in resolved).toBe(false);
  });

  it("fails closed on a reference the schema did not see", () => {
    const handBuilt: RepositoryPolicy = { ...policy(), layers: { ui: ["apps/**"] } };
    expect(() => resolvePolicyLayers(handBuilt)).toThrow("Layer is not declared: service");
  });

  it("never changes the expanded glob set when reference order changes", () => {
    const slug = fc.stringMatching(/^[a-z][a-z0-9]{1,9}$/u);
    const glob = fc.stringMatching(/^[a-z][a-z0-9]{0,5}(?:\/[a-z*][a-z0-9*]{0,5}){0,3}\.ts$/u);
    const layersArbitrary = fc.dictionary(slug, fc.uniqueArray(glob, { minLength: 1, maxLength: 4 }), { minKeys: 1, maxKeys: 6 });
    fc.assert(fc.property(
      layersArbitrary.chain((layers) => {
        const names = Object.keys(layers);
        const entries = fc.uniqueArray(fc.oneof(fc.constantFrom(...names).map((name) => `${LAYER_REFERENCE_PREFIX}${name}`), glob), { minLength: 1, maxLength: 8 });
        return fc.tuple(fc.constant(layers), entries.chain((list) => fc.tuple(fc.constant(list), fc.shuffledSubarray(list, { minLength: list.length }))));
      }),
      ([layers, [ordered, shuffled]]) => {
        const resolve = (from: readonly string[]) => resolvePolicyLayers({
          apiVersion: "kernel-zero.dev/v1",
          kind: "RepositoryPolicy",
          layers,
          metadata: { description: "Property policy", name: "property", revision: 1 },
          rules: [{ check: { deny: ["module:x"], from: [...from], kind: "forbid-import-edge" }, id: "rule", level: "error", remediation: "r", title: "t" }],
          scope: { exclude: [], include: ["**/*.ts"], languages: ["typescript"] },
        }).rules.flatMap((rule) => ruleFileLists(rule.check).flatMap(([, globs]) => globs));
        const expected = [...new Set(ordered.flatMap((entry) => (isLayerReference(entry) ? layers[entry.slice(LAYER_REFERENCE_PREFIX.length)] ?? [] : [entry])))].sort();
        expect([...resolve(shuffled)].sort()).toEqual(expected);
        expect([...resolve(ordered)].sort()).toEqual(expected);
        expect(resolve(shuffled).some(isLayerReference)).toBe(false);
      },
    ));
  });
});
