import ts from "typescript";

import { collectExportedFunctions, containsUnsafeType } from "../ast";
import { forEachMatchingSource, matchesGlob, nodeLocation, rawFinding, type CheckEvaluator } from "../findings";

export const evaluateTenantParameters: CheckEvaluator<"require-tenant-parameter"> = (rule, repository, failedPaths, findings) => {
  const checker = repository.program.getTypeChecker();
  forEachMatchingSource(repository, rule.check.files, failedPaths, (filePath, sourceFile) => {
    for (const candidate of collectExportedFunctions(sourceFile, checker)) {
      const symbolName = candidate.qualifiedName.split(".").at(-1) ?? candidate.qualifiedName;
      if (!matchesGlob(symbolName, rule.check.symbols) && !matchesGlob(candidate.qualifiedName, rule.check.symbols)) {
        continue;
      }
      if (!hasTenantParameter(candidate.node, rule.check.parameter, checker)) {
        findings.push(rawFinding(
          rule,
          "MISSING_TENANT_PARAMETER",
          `symbol:${candidate.qualifiedName}`,
          filePath,
          nodeLocation(sourceFile, candidate.node.name ?? candidate.node),
        ));
      }
    }
  });
};

function hasTenantParameter(node: ts.FunctionLikeDeclaration, parameterName: string, checker: ts.TypeChecker): boolean {
  if (node.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === parameterName)) {
    return true;
  }
  const first = node.parameters[0];
  if (first === undefined) {
    return false;
  }
  const inputType = checker.getTypeAtLocation(first);
  if (containsUnsafeType(inputType)) {
    return false;
  }
  const property = checker.getPropertyOfType(inputType, parameterName);
  if (property === undefined || (property.flags & ts.SymbolFlags.Optional) !== 0) {
    return false;
  }
  const propertyType = checker.getTypeOfSymbolAtLocation(property, first);
  return !containsUnsafeType(propertyType) && checker.isTypeAssignableTo(propertyType, checker.getStringType());
}
