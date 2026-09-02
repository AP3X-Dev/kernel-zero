import type { EvidenceFinding, PolicyRuleDiff, Profile } from "@kernel-zero/contracts";
import { diffRulesById } from "@kernel-zero/contracts";

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

export function diffManifestRules(before: ManifestPolicy, after: ManifestPolicy): readonly PolicyRuleDiff[] {
  return diffRulesById(before, after);
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
