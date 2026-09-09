import { findingIdentity, sortFindings, type EvidenceFinding, type FindingLocation } from "@kernel-zero/contracts";
import type { Sha256Digest } from "@kernel-zero/domain";

import { pythonMessages, type PythonMessageCode } from "./evidence";
import type { PythonFileFacts } from "./facts";
import type { PythonPolicy, PythonPolicyRule } from "./policy";

const WHOLE_FILE: FindingLocation = Object.freeze({ endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 });

export function checkPython(input: Readonly<{
  files: readonly PythonFileFacts[];
  policy: PythonPolicy;
  policyDigest: Sha256Digest;
}>): readonly EvidenceFinding[] {
  const findings = new Map<string, EvidenceFinding>();
  for (const file of [...input.files].sort((left, right) => left.path.localeCompare(right.path))) {
    if (file.parseError !== null) {
      const rule = input.policy.rules.find((candidate) => candidate.level === "error") ?? input.policy.rules[0];
      if (rule !== undefined) remember(findings, finding(rule, "PARSE_FAILURE", "parse", file.path, file.parseError, input.policyDigest));
      continue;
    }
    for (const rule of input.policy.rules) {
      for (const violation of violations(rule, file)) {
        remember(findings, finding(rule, violation.code, violation.subject, file.path, violation.location, input.policyDigest));
      }
    }
  }
  return Object.freeze(sortFindings([...findings.values()]));
}

type Violation = Readonly<{ code: PythonMessageCode; location: FindingLocation; subject: string }>;

function* violations(rule: PythonPolicyRule, file: PythonFileFacts): Generator<Violation> {
  if (rule.check.kind === "forbid-import-edge") {
    if (!rule.check.from.some((glob) => matchesPythonGlob(file.path, glob))) return;
    for (const imported of file.imports) {
      if (rule.check.deny.some((denied) => moduleMatches(imported.module, denied))) {
        yield { code: "PYTHON_IMPORT_DENIED", location: imported.location, subject: `module:${safeSubject(imported.module)}` };
      }
    }
    return;
  }
  if (rule.check.kind === "require-import") {
    if (!rule.check.files.some((glob) => matchesPythonGlob(file.path, glob))) return;
    const requiredModule = rule.check.module;
    if (!file.imports.some((imported) => moduleMatches(imported.module, requiredModule))) {
      yield { code: "PYTHON_IMPORT_REQUIRED", location: WHOLE_FILE, subject: `module:${requiredModule}` };
    }
    return;
  }
  if (rule.check.kind === "restrict-call-site") {
    if (rule.check.allowFrom.some((glob) => matchesPythonGlob(file.path, glob))) return;
    for (const call of file.calls) {
      if (rule.check.callee.includes(call.callee)) {
        yield { code: "PYTHON_CALL_RESTRICTED", location: call.location, subject: `call:${safeSubject(call.callee)}` };
      }
    }
    return;
  }
  if (!rule.check.files.some((glob) => matchesPythonGlob(file.path, glob))) return;
  const parameterName = rule.check.parameter;
  for (const candidate of file.functions) {
    const shortName = candidate.name.split(".").at(-1) ?? candidate.name;
    if (!matchesPythonSymbol(candidate.name, rule.check.symbols) && !matchesPythonSymbol(shortName, rule.check.symbols)) continue;
    const parameter = candidate.parameters.find((item) => item.name === parameterName);
    if (parameter === undefined || !parameter.required || parameter.kind === "vararg" || parameter.kind === "kwarg") {
      yield {
        code: "PYTHON_CONTEXT_PARAMETER_REQUIRED",
        location: candidate.location,
        subject: `symbol:${safeSubject(candidate.name)}:parameter:${parameterName}`,
      };
    }
  }
}

export function moduleMatches(candidate: string, expected: string): boolean {
  return candidate === expected || candidate.startsWith(`${expected}.`);
}

export function matchesPythonSymbol(value: string, pattern: string): boolean {
  const expected = pattern.split(".");
  const actual = value.split(".");
  return expected.length === actual.length && expected.every((segment, index) => segment === "*" || segment === actual[index]);
}

export function matchesPythonGlob(value: string, glob: string): boolean {
  const expression = glob.replace(/\*\*\/|\*\*|\*|[.+^${}()|[\]\\?]/gu, (token) => {
    if (token === "**/") return "(?:[^\\0]*/)?";
    if (token === "**") return "[^\\0]*";
    if (token === "*") return "[^/]*";
    return `\\${token}`;
  });
  return new RegExp(`^${expression}$`, "u").test(value);
}

function finding(
  rule: PythonPolicyRule,
  messageCode: PythonMessageCode,
  subject: string,
  path: string,
  location: FindingLocation,
  policyDigest: Sha256Digest,
): EvidenceFinding {
  const identity = findingIdentity({ location, messageCode, path, policyDigest, ruleId: rule.id, subject });
  return Object.freeze({
    exceptionId: null,
    fingerprint: identity.fingerprint,
    id: identity.id,
    level: rule.level,
    location,
    message: pythonMessages[messageCode],
    messageCode,
    path,
    ruleId: rule.id,
    subject,
  });
}

function safeSubject(value: string): string {
  return value.replace(/[^\x20-\x7e]/gu, "?").slice(0, 300);
}

function remember(findings: Map<string, EvidenceFinding>, candidate: EvidenceFinding): void {
  if (!findings.has(candidate.id)) findings.set(candidate.id, candidate);
}
