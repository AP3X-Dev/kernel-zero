import { EvidenceFindingSchema } from "@kernel-zero/contracts";
import { describe, expect, it } from "vitest";

import { findingCompatibilityReason } from "./compatibility";
import { findingMessage, type FindingMessageCode } from "./evidence";
import { RepositoryPolicySchema } from "./policy";

const REG = { declarationCalls: ["defineTool"], declarationFiles: ["src/tools/**/*.ts"], kind: "require-closed-registry", registryExport: "TOOL_POLICY", registryFile: "src/tools/tool-policy.ts", requiredKeys: ["classification"] };

const PW = { allowFrom: ["src/dataplane/state/**"], files: ["src/**/*.ts"], kind: "restrict-property-write", property: "status", targetType: { exportName: "Job", file: "src/domain/job.ts" } };

const CA = { allowFrom: ["src/audit.ts"], argument: 0, callee: ["*.findFirst", "db.policy.*"], files: ["src/**/*.ts"], kind: "require-call-argument", requiredPath: "where.workspaceId" };

const ST = { allowFrom: ["src/persistence/policies.ts"], argument: 0, callee: ["*.policyRevision.updateMany"], field: "data.state", kind: "restrict-state-transition", transitions: [{ from: "draft", to: "approved" }] };

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
  { check: { files: ["**/*.ts"], kind: "require-context-parameter", parameter: "actorContext", symbols: "create*" }, code: "CONTEXT_PARAMETER_INVALID", subject: "symbol:service.create:parameter:actorContext" },
  { check: { expectedType: { exportName: "Ctx", file: "src/ctx.ts", kind: "export" }, files: ["**/*.ts"], kind: "require-context-parameter", parameter: "actorContext", symbols: "create*" }, code: "CONTEXT_PARAMETER_PROOF_FAILED", subject: "type:src/ctx.ts#Ctx" },
  { check: { expectedType: { exportName: "Ctx", file: "src/ctx.ts", kind: "export" }, files: ["**/*.ts"], kind: "require-context-parameter", parameter: "actorContext", symbols: "create*" }, code: "CONTEXT_PARAMETER_PROOF_FAILED", subject: "symbol:create:parameter:actorContext" },
  { check: REG, code: "CLOSED_REGISTRY_ENTRY_INVALID", subject: "registry:TOOL_POLICY:entry:read/file:classification" },
  { check: REG, code: "CLOSED_REGISTRY_ENTRY_INVALID", subject: "registry:TOOL_POLICY:entry:<invalid>:id" },
  { check: REG, code: "UNREGISTERED_DECLARATION", subject: "registry:TOOL_POLICY:declaration:search" },
  { check: REG, code: "CLOSED_REGISTRY_PROOF_FAILED", subject: "registry:TOOL_POLICY:proof:registry" },
  { check: REG, code: "CLOSED_REGISTRY_PROOF_FAILED", subject: "registry:TOOL_POLICY:proof:search" },
  { check: PW, code: "PROPERTY_WRITE_DENIED", subject: "property:src/domain/job.ts#Job.status" },
  { check: PW, code: "PROPERTY_WRITE_PROOF_FAILED", subject: "property:src/domain/job.ts#Job.status" },
  { check: CA, code: "CALL_ARGUMENT_MISSING", subject: "call:tx.policyRevision.findFirst:argument:0:where.workspaceId" },
  { check: CA, code: "CALL_ARGUMENT_PROOF_FAILED", subject: "call:db.policy.findMany:argument:0:where.workspaceId" },
  { check: CA, code: "CALL_ARGUMENT_PROOF_FAILED", subject: "call:db.policy.*:argument:0:where.workspaceId" },
  { check: CA, code: "CALL_ARGUMENT_PROOF_FAILED", subject: "call:*.findFirst:argument:0:where.workspaceId" },
  { check: ST, code: "STATE_TRANSITION_DENIED", subject: "transition:state:tx.policyRevision.updateMany" },
  { check: ST, code: "STATE_TRANSITION_DENIED", subject: "transition:state:draft->active" },
  { check: ST, code: "STATE_TRANSITION_DENIED", subject: "transition:state:*->active" },
  { check: ST, code: "STATE_TRANSITION_PROOF_FAILED", subject: "transition:state:tx.policyRevision.updateMany" },
  { check: ST, code: "STATE_TRANSITION_PROOF_FAILED", subject: "transition:state:*.policyRevision.updateMany" },
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

  it("rejects a context type subject when the rule has no exported type obligation", () => {
    const check = { files: ["**/*.ts"], kind: "require-context-parameter", parameter: "actorContext", symbols: "create*" };
    expect(findingCompatibilityReason(policy(check), finding("CONTEXT_PARAMETER_PROOF_FAILED", "type:src/ctx.ts#Ctx"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(check), finding("CONTEXT_PARAMETER_INVALID", "symbol:create:parameter:other"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(check), finding("TENANT_PARAMETER_MISSING", "symbol:create"))).toBe("rule_code_mismatch");
  });

  it("accepts string-literal method names and colon-bearing required keys that the validator can legitimately emit", () => {
    const context = { files: ["**/*.ts"], kind: "require-context-parameter", parameter: "ctx", symbols: "*" };
    expect(findingCompatibilityReason(policy(context), finding("CONTEXT_PARAMETER_INVALID", "symbol:Api.create-user:parameter:ctx"))).toBeNull();
    expect(findingCompatibilityReason(policy(context), finding("CONTEXT_PARAMETER_INVALID", "symbol:Api..broken:parameter:ctx"))).toBe("rule_subject_mismatch");
    const tenant = { files: ["**/*.ts"], kind: "require-tenant-parameter", parameter: "workspaceId", symbols: "*" };
    expect(findingCompatibilityReason(policy(tenant), finding("TENANT_PARAMETER_MISSING", "symbol:handlers.list-all"))).toBeNull();
    const colonKeys = { ...REG, requiredKeys: ["io:mode"] };
    expect(findingCompatibilityReason(policy(colonKeys), finding("CLOSED_REGISTRY_ENTRY_INVALID", "registry:TOOL_POLICY:entry:x:io:mode"))).toBeNull();
    expect(findingCompatibilityReason(policy(colonKeys), finding("CLOSED_REGISTRY_ENTRY_INVALID", "registry:TOOL_POLICY:entry:x:mode"))).toBe("rule_subject_mismatch");
  });

  it("rejects closed-registry subjects with unknown keys, other exports, or malformed ids", () => {
    expect(findingCompatibilityReason(policy(REG), finding("CLOSED_REGISTRY_ENTRY_INVALID", "registry:TOOL_POLICY:entry:read:authority"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(REG), finding("UNREGISTERED_DECLARATION", "registry:OTHER:declaration:search"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(REG), finding("CLOSED_REGISTRY_PROOF_FAILED", "registry:TOOL_POLICY:proof:bad id!"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(REG), finding("UNREGISTERED_DECLARATION", "registry:TOOL_POLICY:proof:search"))).toBe("rule_subject_mismatch");
  });

  it("rejects property-write subjects naming another type, file, or property", () => {
    expect(findingCompatibilityReason(policy(PW), finding("PROPERTY_WRITE_DENIED", "property:src/domain/job.ts#Job.retries"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(PW), finding("PROPERTY_WRITE_DENIED", "property:src/domain/task.ts#Job.status"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(PW), finding("PROPERTY_WRITE_PROOF_FAILED", "property:src/domain/job.ts#Task.status"))).toBe("rule_subject_mismatch");
  });

  it("rejects call-argument subjects with another index, path, or a chain outside the callee globs", () => {
    expect(findingCompatibilityReason(policy(CA), finding("CALL_ARGUMENT_MISSING", "call:db.policy.findMany:argument:1:where.workspaceId"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(CA), finding("CALL_ARGUMENT_MISSING", "call:db.policy.findMany:argument:0:where.tenantId"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(CA), finding("CALL_ARGUMENT_MISSING", "call:db.other.findMany:argument:0:where.workspaceId"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(CA), finding("CALL_ARGUMENT_PROOF_FAILED", "call:db.policy.findMany/x:argument:0:where.workspaceId"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(CA), finding("CALL_ARGUMENT_PROOF_FAILED", "call::argument:0:where.workspaceId"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(CA), finding("RESTRICTED_CALL", "db.policy.findMany"))).toBe("rule_code_mismatch");
    expect(findingCompatibilityReason(policy(CA), finding("CALL_ARGUMENT_MISSING", "call:db.policy.findMany:argument:0:where.workspaceId"))).toBeNull();
    const layered = RepositoryPolicySchema.parse({
      apiVersion: "kernel-zero.dev/v1",
      kind: "RepositoryPolicy",
      layers: { persistence: ["src/persistence/**/*.ts"] },
      metadata: { description: "Policy", name: "policy", revision: 1 },
      rules: [{ check: { ...CA, allowFrom: [], files: ["layer:persistence"] }, id: "test-rule", level: "error", remediation: "Fix it.", title: "Test" }],
      scope: { exclude: [], include: ["**/*.ts"], languages: ["typescript"] },
    });
    expect(findingCompatibilityReason(layered, finding("CALL_ARGUMENT_MISSING", "call:db.policy.findMany:argument:0:where.workspaceId"))).toBeNull();
  });

  it("rejects state-transition subjects with another leaf, a chain outside the callee globs, a malformed pair, or a pair on a proof failure", () => {
    expect(findingCompatibilityReason(policy(ST), finding("STATE_TRANSITION_DENIED", "transition:status:tx.policyRevision.updateMany"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(ST), finding("STATE_TRANSITION_DENIED", "transition:state:tx.policyPack.updateMany"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(ST), finding("STATE_TRANSITION_DENIED", "transition:state:draft->"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(ST), finding("STATE_TRANSITION_DENIED", "transition:state:draft->a->b"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(ST), finding("STATE_TRANSITION_DENIED", "transition:state:draft->*"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(ST), finding("STATE_TRANSITION_DENIED", "transition:state:in progress->done"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(ST), finding("STATE_TRANSITION_PROOF_FAILED", "transition:state:draft->active"))).toBe("rule_subject_mismatch");
    expect(findingCompatibilityReason(policy(ST), finding("CALL_ARGUMENT_MISSING", "transition:state:draft->active"))).toBe("rule_code_mismatch");
    expect(findingCompatibilityReason(policy({ ...ST, field: "state" }), finding("STATE_TRANSITION_DENIED", "transition:state:draft->active"))).toBeNull();
  });

  it("resolves layer references before matching so a layered rule accepts its finding", () => {
    const layered = RepositoryPolicySchema.parse({
      apiVersion: "kernel-zero.dev/v1",
      kind: "RepositoryPolicy",
      layers: { source: ["src/**/*.ts"] },
      metadata: { description: "Policy", name: "policy", revision: 1 },
      rules: [{ check: { deny: ["module:blocked-package"], from: ["layer:source"], kind: "forbid-import-edge" }, id: "test-rule", level: "error", remediation: "Fix it.", title: "Test" }],
      scope: { exclude: [], include: ["**/*.ts"], languages: ["typescript"] },
    });
    expect(findingCompatibilityReason(layered, finding("DENIED_IMPORT", "blocked-package"))).toBeNull();
    expect(findingCompatibilityReason(layered, finding("DENIED_IMPORT", "other-package"))).toBe("rule_subject_mismatch");
    expect(layered.rules[0]?.check).toMatchObject({ from: ["layer:source"] });
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
