import type { EvidenceFinding, PolicyRuleDiff, Profile } from "@kernel-zero/contracts";
import { diffRulesById } from "@kernel-zero/contracts";

import { matchesPythonGlob, matchesPythonSymbol, moduleMatches } from "./check";
import { PythonEvidenceSchema, pythonEvidenceJsonSchema, type PythonEvidence } from "./evidence";
import { PythonPolicySchema, pythonPolicyJsonSchema, type PythonPolicy } from "./policy";

export * from "./check";
export * from "./evidence";
export * from "./facts";
export * from "./policy";

export function pythonFindingCompatibilityReason(policy: PythonPolicy, finding: EvidenceFinding): string | null {
  const rule = policy.rules.find((candidate) => candidate.id === finding.ruleId);
  if (rule === undefined) return "rule_not_found";
  if (finding.level !== rule.level) return "rule_level_mismatch";
  if (finding.messageCode === "PARSE_FAILURE") return rule.level === "error" && finding.subject === "parse" ? null : "rule_code_mismatch";
  if (rule.check.kind === "forbid-import-edge") {
    const module = subjectValue(finding.subject, "module:");
    return finding.messageCode === "PYTHON_IMPORT_DENIED"
      && rule.check.from.some((glob) => matchesPythonGlob(finding.path, glob))
      && module !== null && rule.check.deny.some((denied) => moduleMatches(module, denied))
      ? null : "rule_subject_mismatch";
  }
  if (rule.check.kind === "require-import") {
    return finding.messageCode === "PYTHON_IMPORT_REQUIRED"
      && rule.check.files.some((glob) => matchesPythonGlob(finding.path, glob))
      && finding.subject === `module:${rule.check.module}` ? null : "rule_subject_mismatch";
  }
  if (rule.check.kind === "restrict-call-site") {
    const callee = subjectValue(finding.subject, "call:");
    return finding.messageCode === "PYTHON_CALL_RESTRICTED"
      && !rule.check.allowFrom.some((glob) => matchesPythonGlob(finding.path, glob))
      && callee !== null && rule.check.callee.includes(callee)
      ? null : "rule_subject_mismatch";
  }
  const suffix = `:parameter:${rule.check.parameter}`;
  const symbol = finding.subject.startsWith("symbol:") && finding.subject.endsWith(suffix)
    ? finding.subject.slice("symbol:".length, -suffix.length)
    : null;
  const shortName = symbol?.split(".").at(-1) ?? null;
  return finding.messageCode === "PYTHON_CONTEXT_PARAMETER_REQUIRED"
    && rule.check.files.some((glob) => matchesPythonGlob(finding.path, glob))
    && symbol !== null && shortName !== null
    && (matchesPythonSymbol(symbol, rule.check.symbols) || matchesPythonSymbol(shortName, rule.check.symbols))
    ? null : "rule_subject_mismatch";
}

function subjectValue(subject: string, prefix: string): string | null {
  return subject.startsWith(prefix) && subject.length > prefix.length ? subject.slice(prefix.length) : null;
}

export function diffPythonRules(before: PythonPolicy, after: PythonPolicy): readonly PolicyRuleDiff[] {
  return diffRulesById(before, after);
}

export const pythonProfile: Profile<PythonPolicy, PythonEvidence> = Object.freeze({
  policyKind: "PythonPolicy",
  evidenceKind: "PythonEvidence",
  toolName: "kernel-zero-python",
  policySchema: PythonPolicySchema,
  evidenceSchema: PythonEvidenceSchema,
  findingCompatibilityReason: pythonFindingCompatibilityReason,
  diffRules: diffPythonRules,
  policyJsonSchema: pythonPolicyJsonSchema,
  evidenceJsonSchema: pythonEvidenceJsonSchema,
});
