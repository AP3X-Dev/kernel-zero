import { describe, expect, it } from "vitest";

import {
  REPOSITORY_POLICY_MEDIA_TYPE,
  RepositoryPolicySchema,
  repositoryPolicyJsonSchema,
} from "./policy";

const validPolicy = {
  apiVersion: "kernel-zero.dev/v1",
  kind: "RepositoryPolicy",
  metadata: { name: "service-boundaries", revision: 1, description: "Repository architecture rules" },
  scope: {
    languages: ["typescript", "tsx"],
    include: ["apps/**/*.ts"],
    exclude: ["**/*.generated.ts"],
  },
  rules: [{
    id: "layers-no-ui-db",
    title: "UI cannot import persistence",
    level: "error",
    check: { kind: "forbid-import-edge", from: ["apps/control/**"], deny: ["module:@prisma/client"] },
    remediation: "Call an application service through a validated boundary.",
  }],
} as const;

describe("RepositoryPolicy v1 contract", () => {
  it("accepts the canonical shape and publishes its media type", () => {
    expect(RepositoryPolicySchema.parse(validPolicy)).toEqual(validPolicy);
    expect(REPOSITORY_POLICY_MEDIA_TYPE).toBe("application/vnd.kernel-zero.policy+json;version=1");
    expect(repositoryPolicyJsonSchema()).toMatchObject({ type: "object" });
  });

  it.each([
    ["unknown top-level field", { ...validPolicy, executable: "no" }],
    ["unknown version", { ...validPolicy, apiVersion: "kernel-zero.dev/v2" }],
    ["path escape", { ...validPolicy, scope: { ...validPolicy.scope, include: ["../secret.ts"] } }],
    ["absolute path", { ...validPolicy, scope: { ...validPolicy.scope, include: ["/tmp/a.ts"] } }],
    ["duplicate language", { ...validPolicy, scope: { ...validPolicy.scope, languages: ["typescript", "typescript"] } }],
    ["duplicate rule id", { ...validPolicy, rules: [validPolicy.rules[0], validPolicy.rules[0]] }],
    ["regex field", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { ...validPolicy.rules[0].check, regex: ".*" } }] }],
    ["unknown check", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "run-code" } }] }],
    ["context type glob file", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "require-context-parameter", files: ["apps/**"], symbols: "*", parameter: "ctx", expectedType: { kind: "export", file: "src/**/*.ts", exportName: "Ctx" } } }] }],
    ["context type non-typescript file", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "require-context-parameter", files: ["apps/**"], symbols: "*", parameter: "ctx", expectedType: { kind: "export", file: "src/ctx.json", exportName: "Ctx" } } }] }],
    ["context type dotted export", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "require-context-parameter", files: ["apps/**"], symbols: "*", parameter: "ctx", expectedType: { kind: "export", file: "src/ctx.ts", exportName: "a.b" } } }] }],
    ["closed registry glob file", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "require-closed-registry", registryFile: "src/**/*.ts", registryExport: "R", declarationFiles: ["src/**"], declarationCalls: ["define"], requiredKeys: [] } }] }],
    ["closed registry duplicate required key", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "require-closed-registry", registryFile: "src/r.ts", registryExport: "R", declarationFiles: ["src/**"], declarationCalls: ["define"], requiredKeys: ["a", "a"] } }] }],
    ["property write dotted property", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "restrict-property-write", files: ["src/**"], targetType: { file: "src/job.ts", exportName: "Job" }, property: "a.b", allowFrom: [] } }] }],
    ["property write missing allowFrom", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "restrict-property-write", files: ["src/**"], targetType: { file: "src/job.ts", exportName: "Job" }, property: "status" } }] }],
    ["context intrinsic outside the closed set", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "require-context-parameter", files: ["apps/**"], symbols: "*", parameter: "ctx", expectedType: { kind: "intrinsic", name: "object" } } }] }],
    ["call argument empty callee segment", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "require-call-argument", files: ["src/**"], callee: ["db..findMany"], requiredPath: "where.workspaceId" } }] }],
    ["call argument slash in callee", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "require-call-argument", files: ["src/**"], callee: ["db/policy.findMany"], requiredPath: "where.workspaceId" } }] }],
    ["call argument empty callee list", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "require-call-argument", files: ["src/**"], callee: [], requiredPath: "where.workspaceId" } }] }],
    ["call argument trailing dot in path", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "require-call-argument", files: ["src/**"], callee: ["*.findMany"], requiredPath: "where." } }] }],
    ["call argument glob in path", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "require-call-argument", files: ["src/**"], callee: ["*.findMany"], requiredPath: "where.*" } }] }],
    ["call argument nine path segments", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "require-call-argument", files: ["src/**"], callee: ["*.findMany"], requiredPath: "a.b.c.d.e.f.g.h.i" } }] }],
    ["call argument index above nine", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "require-call-argument", files: ["src/**"], callee: ["*.findMany"], argument: 10, requiredPath: "where" } }] }],
    ["call argument negative index", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "require-call-argument", files: ["src/**"], callee: ["*.findMany"], argument: -1, requiredPath: "where" } }] }],
    ["call argument fractional index", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "require-call-argument", files: ["src/**"], callee: ["*.findMany"], argument: 0.5, requiredPath: "where" } }] }],
    ["call argument unknown field", { ...validPolicy, rules: [{ ...validPolicy.rules[0], check: { kind: "require-call-argument", files: ["src/**"], callee: ["*.findMany"], requiredPath: "where", regex: ".*" } }] }],
  ])("rejects %s", (_label, value) => {
    expect(RepositoryPolicySchema.safeParse(value).success).toBe(false);
  });

  it("accepts all eleven closed check variants and rejects variant-only drift", () => {
    const checks = [
      { kind: "forbid-import-edge", from: ["apps/**"], deny: ["module:x"] },
      { kind: "require-import", files: ["apps/**"], module: "server-only", allowTypeOnly: false },
      { kind: "restrict-call-site", callee: ["db.query"], allowFrom: ["packages/persistence/**"], requireResolution: true },
      { kind: "require-export-keys", files: ["apps/**"], exportName: "ACTIONS", requiredKeys: ["audit"] },
      { kind: "require-tenant-parameter", files: ["apps/**"], symbols: "*", parameter: "workspaceId" },
      { kind: "require-boundary-parse", files: ["apps/**"], boundaryCalls: ["request.json"], parserCalls: ["Input.parse"] },
      { kind: "require-governed-operation", files: ["apps/**"], registryExport: "GOVERNED_ACTIONS", requiredKeys: ["capability", "tenantScope", "quota", "audit", "idempotency"], declarationCalls: ["defineGovernedAction"] },
      { kind: "require-context-parameter", files: ["apps/**"], symbols: "create*", parameter: "actorContext" },
      { kind: "require-context-parameter", files: ["apps/**"], symbols: "create*", parameter: "actorContext", expectedType: { kind: "intrinsic", name: "string" } },
      { kind: "require-context-parameter", files: ["apps/**"], symbols: "create*", parameter: "actorContext", expectedType: { kind: "export", file: "src/auth/context.ts", exportName: "AuthorizationContext" } },
      { kind: "require-closed-registry", registryFile: "src/tools/tool-policy.ts", registryExport: "TOOL_POLICY", declarationFiles: ["src/tools/**/*.ts"], declarationCalls: ["defineTool"], requiredKeys: ["classification", "authority", "approval"] },
      { kind: "restrict-property-write", files: ["src/**/*.ts"], targetType: { file: "src/domain/job.ts", exportName: "Job" }, property: "status", allowFrom: ["src/dataplane/state/**"] },
      { kind: "restrict-property-write", files: ["src/**/*.ts"], targetType: { file: "src/domain/job.ts", exportName: "Job" }, property: "status", allowFrom: [] },
      { kind: "require-call-argument", files: ["packages/persistence/src/**/*.ts"], callee: ["*.findFirst", "*.findMany", "prisma.*.updateMany", "$db.count"], argument: 0, requiredPath: "where.workspaceId", allowFrom: ["packages/persistence/src/audit.ts"] },
      { kind: "require-call-argument", files: ["src/**"], callee: ["*"], requiredPath: "a.b.c.d.e.f.g.h" },
    ];
    for (const [index, check] of checks.entries()) {
      const result = RepositoryPolicySchema.safeParse({
        ...validPolicy,
        rules: [{ ...validPolicy.rules[0], id: `rule-${String(index)}`, check }],
      });
      expect(result.success, JSON.stringify(result.error)).toBe(true);
    }
  });

  it("defaults require-call-argument's argument to 0 and allowFrom to []", () => {
    const parsed = RepositoryPolicySchema.parse({
      ...validPolicy,
      rules: [{ ...validPolicy.rules[0], check: { kind: "require-call-argument", files: ["src/**"], callee: ["*.findMany"], requiredPath: "where.workspaceId" } }],
    });
    expect(parsed.rules[0]?.check).toEqual({ kind: "require-call-argument", files: ["src/**"], callee: ["*.findMany"], argument: 0, requiredPath: "where.workspaceId", allowFrom: [] });
  });

  describe("layers", () => {
    const extraLayers = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`layer-${String(index)}`, ["apps/**"]]));
    const layeredRule = { ...validPolicy.rules[0], check: { kind: "forbid-import-edge", from: ["layer:ui", "packages/**"], deny: ["module:@prisma/client"] } };
    const layered = {
      ...validPolicy,
      layers: { ui: ["apps/control/src/app/**/page.tsx"], service: ["apps/control/src/server/**/*.ts"] },
      rules: [layeredRule],
    };

    it("accepts declared layers and keeps references unexpanded in the parsed document", () => {
      expect(RepositoryPolicySchema.parse(layered)).toEqual(layered);
    });

    it("parses a policy without layers to the same object with no layers key", () => {
      const parsed = RepositoryPolicySchema.parse(validPolicy);
      expect(parsed).toEqual(validPolicy);
      expect("layers" in parsed).toBe(false);
    });

    it.each([
      ["malformed reference", { ...layered, rules: [{ ...layeredRule, check: { ...layeredRule.check, from: ["layer:UI_Layer"] } }] }, "Layer reference is not a slug: layer:UI_Layer"],
      ["reference in scope include", { ...layered, scope: { ...layered.scope, include: ["layer:ui"] } }, "Layer reference is not allowed in scope: layer:ui"],
      ["reference in scope exclude", { ...layered, scope: { ...layered.scope, exclude: ["layer:ui"] } }, "Layer reference is not allowed in scope: layer:ui"],
      ["undeclared reference", { ...layered, rules: [{ ...layeredRule, check: { ...layeredRule.check, from: ["layer:ghost"] } }] }, "Layer is not declared: ghost (rule layers-no-ui-db, field from)"],
      ["reference without a layers block", { ...validPolicy, rules: layered.rules }, "Layer is not declared: ui (rule layers-no-ui-db, field from)"],
      ["undeclared allowFrom reference", { ...layered, rules: [{ ...layeredRule, check: { kind: "restrict-property-write", files: ["layer:ui"], targetType: { file: "src/job.ts", exportName: "Job" }, property: "status", allowFrom: ["layer:data"] } }] }, "Layer is not declared: data (rule layers-no-ui-db, field allowFrom)"],
    ])("rejects a %s with the exact message", (_label, value, message) => {
      const result = RepositoryPolicySchema.safeParse(value);
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([message]);
    });

    it.each([
      ["a non-slug layer name", { ...layered, layers: { ...layered.layers, "Bad Name": ["apps/**"] } }],
      ["a one-character layer name", { ...layered, layers: { ...layered.layers, a: ["apps/**"] } }],
      ["an empty layer", { ...layered, layers: { ...layered.layers, empty: [] } }],
      ["a layer containing a reference", { ...layered, layers: { ...layered.layers, nested: ["layer:ui"] } }],
      ["51 layers", { ...layered, layers: { ...layered.layers, ...extraLayers(49) } }],
    ])("rejects %s", (_label, value) => {
      expect(RepositoryPolicySchema.safeParse(value).success).toBe(false);
    });

    it("accepts 50 layers", () => {
      const layers = { ...layered.layers, ...extraLayers(48) };
      expect(Object.keys(layers)).toHaveLength(50);
      expect(RepositoryPolicySchema.safeParse({ ...layered, layers }).success).toBe(true);
    });
  });
});
