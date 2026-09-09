import { isLayerReference, ruleFileLists, type RepositoryPolicy } from "@kernel-zero/profile-software-architecture";

import { evaluateBoundaryParses } from "./checks/boundary";
import { evaluateCallArguments } from "./checks/call-argument";
import { evaluateRestrictedCalls } from "./checks/calls";
import { evaluateContextParameters } from "./checks/context";
import { evaluateExportKeys } from "./checks/exports";
import { evaluateGovernedOperations } from "./checks/governed";
import { evaluateForbiddenImports, evaluateRequiredImports } from "./checks/imports";
import { evaluatePropertyWrites } from "./checks/property-write";
import { evaluateClosedRegistry } from "./checks/registry";
import { evaluateStateTransitions } from "./checks/state-transition";
import { evaluateTenantParameters } from "./checks/tenant";
import {
  compareFindings,
  diagnosticLocation,
  matchesGlob,
  rawFinding,
  type PolicyCheck,
  type PolicyRule,
  type RawValidatorFinding,
} from "./findings";
import { RepositoryProgramError, type RepositoryProgram } from "./program";

export type { RawFindingLocation, RawFindingMessageCode, RawValidatorFinding } from "./findings";
export { RepositoryProgramError, createRepositoryProgram, type CreateRepositoryProgramOptions, type RepositoryProgram } from "./program";

export function evaluatePolicyChecks(policy: RepositoryPolicy, repository: RepositoryProgram): RawValidatorFinding[] {
  // Programming-error guard, not a finding: the runner resolves layers after the digest and before this call.
  if (policy.rules.some((rule) => ruleFileLists(rule.check).some(([, globs]) => globs.some(isLayerReference)))) {
    throw new RepositoryProgramError("Policy layers must be resolved before evaluation.");
  }
  const findings: RawValidatorFinding[] = [];

  for (const rule of policy.rules) {
    const claimedPaths = repository.filePaths.filter((filePath) => ruleClaimsPath(rule.check, filePath));
    const failedPaths = new Set<string>();

    if (rule.level === "error") {
      for (const filePath of claimedPaths) {
        const diagnostics = repository.parseDiagnostics.get(filePath) ?? [];
        const diagnostic = diagnostics[0];
        if (diagnostic === undefined) {
          continue;
        }
        failedPaths.add(filePath);
        const sourceFile = repository.sourceFiles.get(filePath);
        findings.push(rawFinding(
          rule,
          "PARSE_FAILURE",
          "parse",
          filePath,
          sourceFile === undefined ? undefined : diagnosticLocation(sourceFile, diagnostic),
        ));
      }
    }

    evaluateRule(rule, repository, failedPaths, findings);
  }

  return findings.sort(compareFindings);
}

function evaluateRule(
  rule: PolicyRule,
  repository: RepositoryProgram,
  failedPaths: ReadonlySet<string>,
  findings: RawValidatorFinding[],
): void {
  switch (rule.check.kind) {
    case "forbid-import-edge":
      evaluateForbiddenImports({ ...rule, check: rule.check }, repository, failedPaths, findings);
      return;
    case "require-import":
      evaluateRequiredImports({ ...rule, check: rule.check }, repository, failedPaths, findings);
      return;
    case "restrict-call-site":
      evaluateRestrictedCalls({ ...rule, check: rule.check }, repository, failedPaths, findings);
      return;
    case "require-export-keys":
      evaluateExportKeys({ ...rule, check: rule.check }, repository, failedPaths, findings);
      return;
    case "require-tenant-parameter":
      evaluateTenantParameters({ ...rule, check: rule.check }, repository, failedPaths, findings);
      return;
    case "require-boundary-parse":
      evaluateBoundaryParses({ ...rule, check: rule.check }, repository, failedPaths, findings);
      return;
    case "require-governed-operation":
      evaluateGovernedOperations({ ...rule, check: rule.check }, repository, failedPaths, findings);
      return;
    case "require-context-parameter":
      evaluateContextParameters({ ...rule, check: rule.check }, repository, failedPaths, findings);
      return;
    case "require-closed-registry":
      evaluateClosedRegistry({ ...rule, check: rule.check }, repository, failedPaths, findings);
      return;
    case "restrict-property-write":
      evaluatePropertyWrites({ ...rule, check: rule.check }, repository, failedPaths, findings);
      return;
    case "require-call-argument":
      evaluateCallArguments({ ...rule, check: rule.check }, repository, failedPaths, findings);
      return;
    case "restrict-state-transition":
      evaluateStateTransitions({ ...rule, check: rule.check }, repository, failedPaths, findings);
      return;
  }
}

function ruleClaimsPath(check: PolicyCheck, filePath: string): boolean {
  switch (check.kind) {
    case "forbid-import-edge":
      return check.from.some((glob) => matchesGlob(filePath, glob));
    case "restrict-call-site":
    case "restrict-state-transition":
      return true;
    case "require-context-parameter":
      return (check.expectedType?.kind === "export" && check.expectedType.file === filePath)
        || check.files.some((glob) => matchesGlob(filePath, glob));
    case "require-import":
    case "require-export-keys":
    case "require-tenant-parameter":
    case "require-boundary-parse":
    case "require-governed-operation":
    case "require-call-argument":
      return check.files.some((glob) => matchesGlob(filePath, glob));
    case "restrict-property-write":
      return check.targetType.file === filePath || check.files.some((glob) => matchesGlob(filePath, glob));
    case "require-closed-registry":
      return filePath === check.registryFile || check.declarationFiles.some((glob) => matchesGlob(filePath, glob));
  }
}
