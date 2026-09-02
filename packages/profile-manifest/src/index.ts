import type { EvidenceFinding, PolicyRuleDiff, Profile } from "@kernel-zero/contracts";
import { canonicalJson } from "@kernel-zero/domain";

import { ManifestEvidenceSchema, manifestEvidenceJsonSchema, type ManifestEvidence } from "./evidence";
import { ManifestPolicySchema, manifestPolicyJsonSchema, type ManifestPolicy } from "./policy";

export * from "./check";
export * from "./evidence";
export * from "./policy";

const messageCodeByKind = Object.freeze({
  "allowed-licenses": "LICENSE_NOT_ALLOWED",
  "pinned-dependencies": "DEPENDENCY_NOT_PINNED",
} as const);

export function manifestFindingCompatibilityReason(policy: ManifestPolicy, finding: EvidenceFinding): string | null {
  const rule = policy.rules.find((candidate) => candidate.id === finding.ruleId);
  if (rule === undefined) return "rule_not_found";
  if (finding.level !== rule.level) return "rule_level_mismatch";
  if (finding.messageCode === "PARSE_FAILURE") return rule.level === "error" && finding.subject === "parse" ? null : "rule_code_mismatch";
  if (finding.messageCode !== messageCodeByKind[rule.check.kind]) return "rule_code_mismatch";
  if (rule.check.kind === "allowed-licenses") {
    const license = finding.subject.startsWith("license:") ? finding.subject.slice("license:".length) : null;
    // An allowed license can never be the subject of a violation of its own rule.
    return license !== null && !rule.check.allowed.includes(license) ? null : "rule_subject_mismatch";
  }
  return rule.check.fields.some((field) => finding.subject.startsWith(`${field}:`)) ? null : "rule_subject_mismatch";
}

// ponytail: duplicated in profile-software-architecture/src/diff.ts; lift to contracts as diffRulesById when a third profile needs it
export function diffManifestRules(before: ManifestPolicy, after: ManifestPolicy): readonly PolicyRuleDiff[] {
  const left = new Map(before.rules.map((rule) => [rule.id, rule]));
  const right = new Map(after.rules.map((rule) => [rule.id, rule]));
  const result: PolicyRuleDiff[] = [];
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const beforeRule = left.get(id) ?? null;
    const afterRule = right.get(id) ?? null;
    if (beforeRule === null) result.push(Object.freeze({ after: afterRule, before: null, id, status: "added" }));
    else if (afterRule === null) result.push(Object.freeze({ after: null, before: beforeRule, id, status: "removed" }));
    else if (canonicalJson(beforeRule) !== canonicalJson(afterRule)) result.push(Object.freeze({ after: afterRule, before: beforeRule, id, status: "changed" }));
  }
  return Object.freeze(result);
}

export const manifestProfile: Profile<ManifestPolicy, ManifestEvidence> = Object.freeze({
  policyKind: "ManifestPolicy",
  evidenceKind: "ManifestEvidence",
  toolName: "kernel-zero-manifest",
  policySchema: ManifestPolicySchema,
  evidenceSchema: ManifestEvidenceSchema,
  findingCompatibilityReason: manifestFindingCompatibilityReason,
  diffRules: diffManifestRules,
  policyJsonSchema: manifestPolicyJsonSchema,
  evidenceJsonSchema: manifestEvidenceJsonSchema,
});
