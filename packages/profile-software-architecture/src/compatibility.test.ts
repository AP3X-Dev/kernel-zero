import { EvidenceFindingSchema } from "@kernel-zero/contracts";
import { describe, expect, it } from "vitest";

import { findingCompatibilityReason } from "./compatibility";
import { findingMessage, type FindingMessageCode } from "./evidence";
import { RepositoryPolicySchema } from "./policy";

const checkCases: readonly Readonly<{
  check: Record<string, unknown>;
  code: FindingMessageCode;
  subject: string;
}>[] = [
  { check: { deny: ["module:blocked-package"], from: ["**/*.ts"], kind: "forbid-import-edge" }, code: "DENIED_IMPORT", subject: "blocked-package" },
  { check: { allowTypeOnly: false, files: ["**/*.ts"], kind: "require-import", module: "server-only" }, code: "REQUIRED_IMPORT_MISSING", subject: "file" },
  { check: { allowFrom: ["src/allowed.ts"], callee: ["db.query"], kind: "restrict-call-site", requireResolution: true }, code: "RESTRICTED_CALL", subject: "db.query" },
  { check: { exportName: "REGISTRY", files: ["**/*.ts"], kind: "require-export-keys", requiredKeys: ["audit"] }, code: "REQUIRED_EXPORT_KEY_MISSING", subject: "export:REGISTRY:audit" },
  { check: { files: ["**/*.ts"], kind: "require-tenant-parameter", parameter: "workspaceId", symbols: "create*" }, code: "TENANT_PARAMETER_MISSING", subject: "symbol:service.create" },
  { check: { boundaryCalls: ["save"], files: ["**/*.ts"], kind: "require-boundary-parse", parserCalls: ["Schema.parse"] }, code: "BOUNDARY_PARSE_REQUIRED", subject: "symbol:handler:save" },
  { check: { declarationCalls: ["defineGovernedAction"], files: ["**/*.ts"], kind: "require-governed-operation", registryExport: "ACTIONS", requiredKeys: ["capability", "tenantScope", "quota", "audit", "idempotency"] }, code: "GOVERNED_OPERATION_INVALID", subject: "action:create:audit" },
];

function policy(check: Record<string, unknown>) {
  return RepositoryPolicySchema.parse({
    apiVersion: "kernel-zero.dev/v1",
    kind: "RepositoryPolicy",
    metadata: { description: "Policy", name: "policy", revision: 1 },
    rules: [{ check, id: "test-rule", level: "error", remediation: "Fix it.", title: "Test" }],
    scope: { exclude: [], include: ["**/*.ts"], languages: ["typescript"] },
  });
}

function finding(code: FindingMessageCode, subject: string) {
  return EvidenceFindingSchema.parse({
    exceptionId: null,
    fingerprint: `sha256:${"1".repeat(64)}`,
    id: `sha256:${"2".repeat(64)}`,
    level: "error",
    location: { endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 },
    message: findingMessage(code),
    messageCode: code,
    path: "src/example.ts",
    ruleId: "test-rule",
    subject,
  });
}

describe("evidence rule compatibility", () => {
  it.each(checkCases)("accepts the normative $code subject grammar", ({ check, code, subject }) => {
    expect(findingCompatibilityReason(policy(check), finding(code, subject))).toBeNull();
  });

  it.each(checkCases)("rejects a non-normative subject for $code", ({ check, code }) => {
    expect(findingCompatibilityReason(policy(check), finding(code, "not-compatible"))).toBe("rule_subject_mismatch");
  });

  it("allows parse failures only for error-level resolved rules", () => {
    const firstCase = checkCases[0];
    if (firstCase === undefined) throw new Error("Test cases are required.");
    expect(findingCompatibilityReason(policy(firstCase.check), finding("PARSE_FAILURE", "parse"))).toBeNull();
    expect(findingCompatibilityReason(policy(firstCase.check), finding("PARSE_FAILURE", "other"))).toBe("rule_code_mismatch");
  });

  it("uses the validator's optional-directory double-star semantics for denied paths", () => {
    const deniedPath = { deny: ["path:**/*.ts"], from: ["**/*.ts"], kind: "forbid-import-edge" };
    expect(findingCompatibilityReason(policy(deniedPath), finding("DENIED_IMPORT", "example.ts"))).toBeNull();
    expect(findingCompatibilityReason(policy(deniedPath), finding("DENIED_IMPORT", "src/example.ts"))).toBeNull();
  });
});
