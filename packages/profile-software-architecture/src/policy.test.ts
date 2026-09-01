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
  ])("rejects %s", (_label, value) => {
    expect(RepositoryPolicySchema.safeParse(value).success).toBe(false);
  });

  it("accepts all seven closed check variants and rejects variant-only drift", () => {
    const checks = [
      { kind: "forbid-import-edge", from: ["apps/**"], deny: ["module:x"] },
      { kind: "require-import", files: ["apps/**"], module: "server-only", allowTypeOnly: false },
      { kind: "restrict-call-site", callee: ["db.query"], allowFrom: ["packages/persistence/**"], requireResolution: true },
      { kind: "require-export-keys", files: ["apps/**"], exportName: "ACTIONS", requiredKeys: ["audit"] },
      { kind: "require-tenant-parameter", files: ["apps/**"], symbols: "*", parameter: "workspaceId" },
      { kind: "require-boundary-parse", files: ["apps/**"], boundaryCalls: ["request.json"], parserCalls: ["Input.parse"] },
      { kind: "require-governed-operation", files: ["apps/**"], registryExport: "GOVERNED_ACTIONS", requiredKeys: ["capability", "tenantScope", "quota", "audit", "idempotency"], declarationCalls: ["defineGovernedAction"] },
    ];
    for (const [index, check] of checks.entries()) {
      const result = RepositoryPolicySchema.safeParse({
        ...validPolicy,
        rules: [{ ...validPolicy.rules[0], id: `rule-${String(index)}`, check }],
      });
      expect(result.success, JSON.stringify(result.error)).toBe(true);
    }
  });
});
