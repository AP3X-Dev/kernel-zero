import type { EvidenceFinding, PolicyRuleDiff, Profile } from "@kernel-zero/contracts";
import { diffRulesById } from "@kernel-zero/contracts";

import { acceptsReference } from "./check";
import { WorkflowEvidenceSchema, workflowEvidenceJsonSchema, type WorkflowEvidence } from "./evidence";
import { WorkflowPolicySchema, workflowPolicyJsonSchema, type WorkflowPolicy } from "./policy";

export * from "./check";
export * from "./evidence";
export * from "./policy";

const messageCodesByKind: Readonly<Record<"pinned-actions" | "restricted-permissions", readonly string[]>> = Object.freeze({
  "pinned-actions": Object.freeze(["ACTION_NOT_PINNED"]),
  "restricted-permissions": Object.freeze(["PERMISSIONS_MISSING", "PERMISSION_TOO_BROAD"]),
});

const subjectPrefixByKind = Object.freeze({
  "pinned-actions": "action:",
  "restricted-permissions": "permissions:",
} as const);

export function workflowFindingCompatibilityReason(policy: WorkflowPolicy, finding: EvidenceFinding): string | null {
  const rule = policy.rules.find((candidate) => candidate.id === finding.ruleId);
  if (rule === undefined) return "rule_not_found";
  if (finding.level !== rule.level) return "rule_level_mismatch";
  if (finding.messageCode === "PARSE_FAILURE") return rule.level === "error" && finding.subject === "parse" ? null : "rule_code_mismatch";
  if (!messageCodesByKind[rule.check.kind].includes(finding.messageCode)) return "rule_code_mismatch";
  if (!finding.subject.startsWith(subjectPrefixByKind[rule.check.kind])) return "rule_subject_mismatch";
  if (rule.check.kind === "pinned-actions") {
    const reference = finding.subject.slice("action:".length);
    // A reference the rule already accepts can never be the subject of violating it.
    return reference.length > 0 && !acceptsReference(rule.check.mode, reference) ? null : "rule_subject_mismatch";
  }
  if (finding.messageCode === "PERMISSIONS_MISSING") return finding.subject === "permissions:top-level" ? null : "rule_subject_mismatch";
  const [, scope, value] = finding.subject.split(":");
  if (scope === undefined || value === undefined) return "rule_subject_mismatch";
  if (scope === "all") return value === "write-all" ? null : "rule_subject_mismatch";
  // A scope the rule allows to write can never be the subject of violating it.
  return value === "write" && !rule.check.allowWrite.includes(scope) ? null : "rule_subject_mismatch";
}

export function diffWorkflowRules(before: WorkflowPolicy, after: WorkflowPolicy): readonly PolicyRuleDiff[] {
  return diffRulesById(before, after);
}

export const workflowProfile: Profile<WorkflowPolicy, WorkflowEvidence> = Object.freeze({
  policyKind: "WorkflowPolicy",
  evidenceKind: "WorkflowEvidence",
  toolName: "kernel-zero-workflow",
  policySchema: WorkflowPolicySchema,
  evidenceSchema: WorkflowEvidenceSchema,
  findingCompatibilityReason: workflowFindingCompatibilityReason,
  diffRules: diffWorkflowRules,
  policyJsonSchema: workflowPolicyJsonSchema,
  evidenceJsonSchema: workflowEvidenceJsonSchema,
});
