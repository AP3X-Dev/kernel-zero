import type { EvidenceFinding } from "@kernel-zero/contracts";

import type { RepositoryPolicy } from "./policy";

const messageCodesByKind: Readonly<Record<RepositoryPolicy["rules"][number]["check"]["kind"], readonly string[]>> = Object.freeze({
  "forbid-import-edge": ["DENIED_IMPORT"],
  "require-boundary-parse": ["BOUNDARY_PARSE_REQUIRED"],
  "require-closed-registry": ["CLOSED_REGISTRY_ENTRY_INVALID", "UNREGISTERED_DECLARATION", "CLOSED_REGISTRY_PROOF_FAILED"],
  "require-context-parameter": ["CONTEXT_PARAMETER_INVALID", "CONTEXT_PARAMETER_PROOF_FAILED"],
  "require-export-keys": ["REQUIRED_EXPORT_KEY_MISSING"],
  "require-governed-operation": ["GOVERNED_OPERATION_INVALID"],
  "require-import": ["REQUIRED_IMPORT_MISSING"],
  "require-tenant-parameter": ["TENANT_PARAMETER_MISSING"],
  "restrict-call-site": ["RESTRICTED_CALL"],
  "restrict-property-write": ["PROPERTY_WRITE_DENIED", "PROPERTY_WRITE_PROOF_FAILED"],
});

export function findingCompatibilityReason(policy: RepositoryPolicy, finding: EvidenceFinding): string | null {
  const rule = policy.rules.find((candidate) => candidate.id === finding.ruleId);
  if (rule === undefined) return "rule_not_found";
  if (finding.level !== rule.level) return "rule_level_mismatch";
  if (finding.messageCode === "PARSE_FAILURE") {
    return rule.level === "error" && finding.subject === "parse" ? null : "rule_code_mismatch";
  }
  if (!messageCodesByKind[rule.check.kind].includes(finding.messageCode)) return "rule_code_mismatch";

  switch (rule.check.kind) {
    case "forbid-import-edge":
      return deniedSubjectMatches(finding.subject, rule.check.deny) ? null : "rule_subject_mismatch";
    case "require-import":
      return finding.subject === "file" ? null : "rule_subject_mismatch";
    case "restrict-call-site":
      return rule.check.callee.includes(finding.subject) ? null : "rule_subject_mismatch";
    case "require-export-keys": {
      const check = rule.check;
      return check.requiredKeys.some((key) => finding.subject === `export:${check.exportName}:${key}`) ? null : "rule_subject_mismatch";
    }
    case "require-tenant-parameter": {
      const qualifiedName = stripPrefix(finding.subject, "symbol:");
      const symbolName = qualifiedName?.split(".").at(-1);
      return qualifiedName !== null
        && symbolName !== undefined
        && isQualifiedName(qualifiedName)
        && (globMatches(qualifiedName, [rule.check.symbols]) || globMatches(symbolName, [rule.check.symbols]))
        ? null
        : "rule_subject_mismatch";
    }
    case "require-boundary-parse":
      return boundarySubjectMatches(finding.subject, rule.check.boundaryCalls) ? null : "rule_subject_mismatch";
    case "require-governed-operation":
      return governedSubjectMatches(finding.subject, rule.check.requiredKeys) ? null : "rule_subject_mismatch";
    case "restrict-property-write": {
      const check = rule.check;
      return finding.subject === `property:${check.targetType.file}#${check.targetType.exportName}.${check.property}` ? null : "rule_subject_mismatch";
    }
    case "require-closed-registry":
      return closedRegistrySubjectMatches(finding.subject, finding.messageCode, rule.check.registryExport, rule.check.requiredKeys) ? null : "rule_subject_mismatch";
    case "require-context-parameter": {
      const check = rule.check;
      if (
        finding.messageCode === "CONTEXT_PARAMETER_PROOF_FAILED"
        && check.expectedType?.kind === "export"
        && finding.subject === `type:${check.expectedType.file}#${check.expectedType.exportName}`
      ) {
        return null;
      }
      const body = stripPrefix(finding.subject, "symbol:");
      const suffix = `:parameter:${check.parameter}`;
      if (!body?.endsWith(suffix)) return "rule_subject_mismatch";
      const qualifiedName = body.slice(0, -suffix.length);
      const symbolName = qualifiedName.split(".").at(-1) ?? qualifiedName;
      return isQualifiedName(qualifiedName)
        && (globMatches(qualifiedName, [check.symbols]) || globMatches(symbolName, [check.symbols]))
        ? null
        : "rule_subject_mismatch";
    }
  }
}

function deniedSubjectMatches(subject: string, denials: readonly string[]): boolean {
  if (!isNormalizedSubject(subject)) return false;
  return denials.some((denial) => {
    if (denial.startsWith("module:")) return subject === denial.slice("module:".length);
    if (denial.startsWith("module-prefix:")) return subject.startsWith(denial.slice("module-prefix:".length));
    if (!denial.startsWith("path:") || !isRelativePosixPath(subject)) return false;
    return globMatches(subject, [denial.slice("path:".length)]);
  });
}

function boundarySubjectMatches(subject: string, calls: readonly string[]): boolean {
  const body = stripPrefix(subject, "symbol:");
  if (body === null) return false;
  return calls.some((call) => body.endsWith(`:${call}`) && isIdentifierChain(body.slice(0, -(call.length + 1))));
}

function governedSubjectMatches(subject: string, requiredKeys: readonly string[]): boolean {
  const body = stripPrefix(subject, "action:");
  if (body === null) return false;
  const separator = body.lastIndexOf(":");
  if (separator < 1) return false;
  const actionId = body.slice(0, separator);
  const key = body.slice(separator + 1);
  return isNormalizedSubject(actionId) && (requiredKeys.includes(key) || key === "actionId" || key === "registry");
}

const REGISTRY_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/u;

function closedRegistrySubjectMatches(subject: string, code: string, registryExport: string, requiredKeys: readonly string[]): boolean {
  const body = stripPrefix(subject, `registry:${registryExport}:`);
  if (body === null) return false;
  const isId = (value: string): boolean => value === "<invalid>" || REGISTRY_ID.test(value);
  switch (code) {
    case "CLOSED_REGISTRY_ENTRY_INVALID": {
      const entry = stripPrefix(body, "entry:");
      // IDs never contain ":", so the first ":" ends the ID even when a required key contains one.
      const separator = entry?.indexOf(":") ?? -1;
      if (entry === null || separator < 1) return false;
      const key = entry.slice(separator + 1);
      return isId(entry.slice(0, separator)) && (key === "id" || requiredKeys.includes(key));
    }
    case "UNREGISTERED_DECLARATION": {
      const id = stripPrefix(body, "declaration:");
      return id !== null && isId(id);
    }
    case "CLOSED_REGISTRY_PROOF_FAILED": {
      const target = stripPrefix(body, "proof:");
      return target !== null && (target === "registry" || target === "declaration" || REGISTRY_ID.test(target));
    }
    default:
      return false;
  }
}

function globMatches(value: string, globs: readonly string[]): boolean {
  return globs.some((glob) => new RegExp(`^${globExpression(glob)}$`, "u").test(value));
}

function globExpression(glob: string): string {
  let expression = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob.charAt(index);
    if (character === "*" && glob[index + 1] === "*") {
      if (glob[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
  }
  return expression;
}

function stripPrefix(value: string, prefix: string): string | null {
  return value.startsWith(prefix) ? value.slice(prefix.length) : null;
}

function isNormalizedSubject(value: string): boolean {
  return value.length > 0 && value === value.trim() && !value.includes("\\") && !value.includes("\0");
}

function isIdentifierChain(value: string): boolean {
  return isNormalizedSubject(value) && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u.test(value);
}

/** Qualified symbol names come from property names, which may be string-literal method keys, so only ":" and "." edges are rejected. */
function isQualifiedName(value: string): boolean {
  return isNormalizedSubject(value) && !value.includes(":") && value.split(".").every((segment) => segment.length > 0);
}

function isRelativePosixPath(value: string): boolean {
  return isNormalizedSubject(value) && !value.startsWith("/") && !/^[A-Za-z]:/u.test(value) && !value.split("/").includes("..");
}
