import type { RepositoryPolicy } from "@kernel-zero/profile-software-architecture";
import type ts from "typescript";

import type { RepositoryProgram } from "./program";

export type RawFindingMessageCode =
  | "PARSE_FAILURE"
  | "DENIED_IMPORT"
  | "IMPORT_RESOLUTION_FAILED"
  | "MISSING_REQUIRED_IMPORT"
  | "RESTRICTED_CALL_SITE"
  | "CALL_RESOLUTION_FAILED"
  | "MISSING_EXPORT_KEY"
  | "EXPORT_PROOF_FAILED"
  | "MISSING_TENANT_PARAMETER"
  | "UNPARSED_BOUNDARY"
  | "MISSING_GOVERNED_KEY"
  | "INVALID_GOVERNED_KEY"
  | "GOVERNED_REGISTRY_PROOF_FAILED"
  | "GOVERNED_DECLARATION_PROOF_FAILED"
  | "UNKNOWN_GOVERNED_ACTION"
  | "CONTEXT_PARAMETER_MISSING"
  | "CONTEXT_PARAMETER_UNSAFE"
  | "CONTEXT_PARAMETER_TYPE_MISMATCH"
  | "CONTEXT_PARAMETER_UNRESOLVED"
  | "CONTEXT_TYPE_UNRESOLVED"
  | "CLOSED_REGISTRY_ENTRY_INVALID"
  | "UNREGISTERED_DECLARATION"
  | "CLOSED_REGISTRY_PROOF_FAILED"
  | "PROPERTY_WRITE_DENIED"
  | "PROPERTY_WRITE_UNRESOLVED"
  | "PROPERTY_TARGET_UNRESOLVED";

export interface RawFindingLocation {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface RawValidatorFinding {
  readonly ruleId: string;
  readonly level: "error" | "warning";
  readonly messageCode: RawFindingMessageCode;
  readonly subject: string;
  readonly path: string;
  readonly location: RawFindingLocation;
}

export type PolicyRule = RepositoryPolicy["rules"][number];
export type PolicyCheck = PolicyRule["check"];
export type RuleOf<K extends PolicyCheck["kind"]> = PolicyRule & { readonly check: Extract<PolicyCheck, { kind: K }> };

/** Every check evaluator has this shape; `failedPaths` are files already reported as unparseable. */
export type CheckEvaluator<K extends PolicyCheck["kind"]> = (
  rule: RuleOf<K>,
  repository: RepositoryProgram,
  failedPaths: ReadonlySet<string>,
  findings: RawValidatorFinding[],
) => void;

export function rawFinding(
  rule: PolicyRule,
  messageCode: RawFindingMessageCode,
  subject: string,
  filePath: string,
  location: RawFindingLocation | undefined,
): RawValidatorFinding {
  return {
    ruleId: rule.id,
    level: rule.level,
    messageCode,
    subject,
    path: filePath,
    location: location ?? { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
  };
}

export function nodeLocation(sourceFile: ts.SourceFile, node: ts.Node): RawFindingLocation {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

export function diagnosticLocation(sourceFile: ts.SourceFile, diagnostic: ts.Diagnostic): RawFindingLocation {
  const startPosition = diagnostic.start ?? 0;
  const endPosition = startPosition + (diagnostic.length ?? 0);
  const start = sourceFile.getLineAndCharacterOfPosition(startPosition);
  const end = sourceFile.getLineAndCharacterOfPosition(endPosition);
  return {
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

export function fileLocation(sourceFile: ts.SourceFile): RawFindingLocation {
  return nodeLocation(sourceFile, sourceFile);
}

export function compareFindings(left: RawValidatorFinding, right: RawValidatorFinding): number {
  return left.ruleId.localeCompare(right.ruleId)
    || left.path.localeCompare(right.path)
    || left.location.startLine - right.location.startLine
    || left.location.startColumn - right.location.startColumn
    || left.messageCode.localeCompare(right.messageCode)
    || left.subject.localeCompare(right.subject);
}

export function forEachMatchingSource(
  repository: RepositoryProgram,
  globs: readonly string[],
  failedPaths: ReadonlySet<string>,
  evaluate: (filePath: string, sourceFile: ts.SourceFile) => void,
): void {
  for (const filePath of repository.filePaths) {
    if (failedPaths.has(filePath) || !globs.some((glob) => matchesGlob(filePath, glob))) {
      continue;
    }
    const sourceFile = repository.sourceFiles.get(filePath);
    if (sourceFile !== undefined) {
      evaluate(filePath, sourceFile);
    }
  }
}

export function matchesGlob(value: string, glob: string): boolean {
  let expression = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    const next = glob[index + 1];
    if (character === "*" && next === "*") {
      if (glob[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += escapeRegularExpression(character ?? "");
    }
  }
  return new RegExp(`${expression}$`, "u").test(value);
}

function escapeRegularExpression(value: string): string {
  return value.replaceAll(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
}
