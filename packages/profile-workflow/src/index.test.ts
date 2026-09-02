import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { checkWorkflows, diffWorkflowRules, workflowFindingCompatibilityReason, workflowProfile, type WorkflowPolicy } from "./index";

const digest = `sha256:${"1".repeat(64)}` as const;
const path = ".github/workflows/ci.yml";
const policy: WorkflowPolicy = {
  apiVersion: "kernel-zero.dev/v1",
  kind: "WorkflowPolicy",
  metadata: { description: "Workflow hygiene rules", name: "workflow-hygiene", revision: 1 },
  scope: { include: [".github/workflows/*.yml"] },
  rules: [
    { check: { kind: "pinned-actions", mode: "sha" }, id: "pinned-actions", level: "error", remediation: "Pin every action reference to a commit sha.", title: "Actions are pinned" },
    { check: { allowWrite: [], kind: "restricted-permissions" }, id: "least-privilege", level: "error", remediation: "Declare least-privilege permissions.", title: "Least privilege" },
  ],
};

function fixture(name: "pinned" | "unpinned"): { path: string; text: string } {
  return { path, text: readFileSync(new URL(`../fixtures/${name}/ci.yml`, import.meta.url), "utf8") };
}

function check(name: "pinned" | "unpinned", used: WorkflowPolicy = policy) {
  return checkWorkflows({ files: [fixture(name)], policy: used, policyDigest: digest });
}

describe("workflowProfile", () => {
  it("declares its kinds and parses its own policy", () => {
    expect([workflowProfile.policyKind, workflowProfile.evidenceKind, workflowProfile.toolName]).toEqual(["WorkflowPolicy", "WorkflowEvidence", "kernel-zero-workflow"]);
    expect(workflowProfile.policySchema.safeParse(policy).success).toBe(true);
    expect(workflowProfile.policySchema.safeParse({ ...policy, extra: 1 }).success).toBe(false);
    expect(workflowProfile.policySchema.safeParse({ ...policy, rules: [{ ...policy.rules[0], check: { kind: "pinned-actions", mode: "digest" } }] }).success).toBe(false);
    expect(workflowProfile.policyJsonSchema()).toHaveProperty("properties");
    expect(workflowProfile.evidenceJsonSchema()).toHaveProperty("properties");
  });

  it("defaults the scope to the two GitHub workflow globs", () => {
    const { scope, ...withoutScope } = policy;
    expect(scope.include).toHaveLength(1);
    const parsed = workflowProfile.policySchema.parse(withoutScope);
    expect(parsed.scope.include).toEqual([".github/workflows/*.yml", ".github/workflows/*.yaml"]);
  });

  it("clears a compliant fixture and flags a non-compliant one", () => {
    expect(check("pinned")).toEqual([]);
    const findings = check("unpinned");
    expect(findings.map((finding) => finding.subject)).toEqual(["permissions:issues:write", "action:actions/checkout@v4"]);
    for (const finding of findings) expect(workflowFindingCompatibilityReason(policy, finding)).toBeNull();
  });

  it("names the reason an incompatible finding is refused", () => {
    const [, actionFinding] = check("unpinned");
    if (actionFinding === undefined) throw new Error("Fixture must produce an action finding.");
    expect(workflowFindingCompatibilityReason(policy, { ...actionFinding, ruleId: "nope-rule" })).toBe("rule_not_found");
    expect(workflowFindingCompatibilityReason(policy, { ...actionFinding, level: "warning" })).toBe("rule_level_mismatch");
    expect(workflowFindingCompatibilityReason(policy, { ...actionFinding, messageCode: "PERMISSIONS_MISSING" })).toBe("rule_code_mismatch");
    expect(workflowFindingCompatibilityReason(policy, { ...actionFinding, messageCode: "PARSE_FAILURE", subject: "parse" })).toBeNull();
    expect(workflowFindingCompatibilityReason(policy, { ...actionFinding, messageCode: "PARSE_FAILURE" })).toBe("rule_code_mismatch");
  });

  it("refuses a forged subject that belongs to the other rule kind", () => {
    const [permissionFinding, actionFinding] = check("unpinned");
    if (permissionFinding === undefined || actionFinding === undefined) throw new Error("Fixture must produce both findings.");
    expect(workflowFindingCompatibilityReason(policy, { ...actionFinding, subject: "permissions:contents:write" })).toBe("rule_subject_mismatch");
    expect(workflowFindingCompatibilityReason(policy, { ...permissionFinding, subject: "action:actions/checkout@v4" })).toBe("rule_subject_mismatch");
  });

  it("refuses a violation naming a reference the pinning mode already accepts", () => {
    const [, actionFinding] = check("unpinned");
    if (actionFinding === undefined) throw new Error("Fixture must produce an action finding.");
    const [pinningRule] = policy.rules;
    if (pinningRule === undefined) throw new Error("Policy must declare the pinning rule.");
    const tagPolicy: WorkflowPolicy = { ...policy, rules: [{ ...pinningRule, check: { kind: "pinned-actions", mode: "tag" } }] };
    expect(workflowFindingCompatibilityReason(tagPolicy, actionFinding)).toBe("rule_subject_mismatch");
    expect(workflowFindingCompatibilityReason(policy, { ...actionFinding, subject: `action:actions/checkout@${"b".repeat(40)}` })).toBe("rule_subject_mismatch");
  });

  it("refuses a violation naming a permission scope the rule allows to write", () => {
    const [permissionFinding] = check("unpinned");
    if (permissionFinding === undefined) throw new Error("Fixture must produce a permission finding.");
    expect(permissionFinding.subject).toBe("permissions:issues:write");
    const [, permissionRule] = policy.rules;
    if (permissionRule === undefined) throw new Error("Policy must declare the permission rule.");
    const allowing: WorkflowPolicy = { ...policy, rules: [{ ...permissionRule, check: { allowWrite: ["issues"], kind: "restricted-permissions" } }] };
    expect(workflowFindingCompatibilityReason(allowing, permissionFinding)).toBe("rule_subject_mismatch");
    expect(workflowFindingCompatibilityReason(policy, { ...permissionFinding, subject: "permissions:issues:read" })).toBe("rule_subject_mismatch");
    expect(workflowFindingCompatibilityReason(policy, { ...permissionFinding, messageCode: "PERMISSIONS_MISSING" })).toBe("rule_subject_mismatch");
    expect(workflowFindingCompatibilityReason(policy, { ...permissionFinding, messageCode: "PERMISSIONS_MISSING", subject: "permissions:top-level" })).toBeNull();
  });

  it("refuses a parse failure claimed against a warning rule", () => {
    const warningPolicy: WorkflowPolicy = { ...policy, rules: policy.rules.map((rule) => ({ ...rule, level: "warning" as const })) };
    const [parseFailure] = checkWorkflows({ files: [{ path, text: "a:\n  - b\n  c: d\n" }], policy, policyDigest: digest });
    if (parseFailure === undefined) throw new Error("Unparseable YAML must produce a parse failure.");
    expect(workflowFindingCompatibilityReason(warningPolicy, { ...parseFailure, level: "warning" })).toBe("rule_code_mismatch");
  });

  it("diffs rules by identifier", () => {
    const [pinnedRule] = policy.rules;
    if (pinnedRule === undefined) throw new Error("Policy must declare the pinning rule.");
    const changed: WorkflowPolicy = { ...policy, rules: [{ ...pinnedRule, check: { kind: "pinned-actions", mode: "tag" } }] };
    expect(diffWorkflowRules(policy, changed).map((entry) => [entry.id, entry.status])).toEqual([
      ["least-privilege", "removed"],
      ["pinned-actions", "changed"],
    ]);
    expect(diffWorkflowRules(changed, policy).map((entry) => [entry.id, entry.status])).toEqual([
      ["least-privilege", "added"],
      ["pinned-actions", "changed"],
    ]);
    expect(diffWorkflowRules(policy, policy)).toEqual([]);
  });
});
