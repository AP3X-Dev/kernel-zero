import ts from "typescript";

import { literalText, walk } from "../ast";
import { forEachMatchingSource, fileLocation, matchesGlob, nodeLocation, rawFinding, type CheckEvaluator } from "../findings";
import { resolveRepositoryModule } from "../program";

interface StaticImportReference {
  readonly node: ts.Node;
  readonly specifier: string;
  readonly typeOnly: boolean;
}

interface DynamicImportReference {
  readonly node: ts.Node;
}

export const evaluateForbiddenImports: CheckEvaluator<"forbid-import-edge"> = (rule, repository, failedPaths, findings) => {
  forEachMatchingSource(repository, rule.check.from, failedPaths, (filePath, sourceFile) => {
    const references = collectImportReferences(sourceFile);
    for (const reference of references.staticReferences) {
      let matchedSubject: string | undefined;
      for (const denial of rule.check.deny) {
        if (denial.startsWith("module:") && reference.specifier === denial.slice("module:".length)) {
          matchedSubject = reference.specifier;
          break;
        }
        if (denial.startsWith("module-prefix:") && reference.specifier.startsWith(denial.slice("module-prefix:".length))) {
          matchedSubject = reference.specifier;
          break;
        }
        if (denial.startsWith("path:")) {
          const resolvedPath = resolveRepositoryModule(repository, sourceFile, reference.specifier);
          if (resolvedPath !== undefined && matchesGlob(resolvedPath, denial.slice("path:".length))) {
            matchedSubject = resolvedPath;
            break;
          }
        }
      }
      if (matchedSubject !== undefined) {
        findings.push(rawFinding(rule, "DENIED_IMPORT", matchedSubject, filePath, nodeLocation(sourceFile, reference.node)));
      } else if (
        rule.level === "error"
        && rule.check.deny.some((denial) => denial.startsWith("path:"))
        && resolveRepositoryModule(repository, sourceFile, reference.specifier) === undefined
        && isRelativeModule(reference.specifier)
      ) {
        findings.push(rawFinding(rule, "IMPORT_RESOLUTION_FAILED", reference.specifier, filePath, nodeLocation(sourceFile, reference.node)));
      }
    }
    if (rule.level === "error") {
      for (const reference of references.dynamicReferences) {
        findings.push(rawFinding(rule, "IMPORT_RESOLUTION_FAILED", "dynamic-import", filePath, nodeLocation(sourceFile, reference.node)));
      }
    }
  });
};

export const evaluateRequiredImports: CheckEvaluator<"require-import"> = (rule, repository, failedPaths, findings) => {
  forEachMatchingSource(repository, rule.check.files, failedPaths, (filePath, sourceFile) => {
    const found = collectImportReferences(sourceFile).staticReferences.some((reference) =>
      ts.isImportDeclaration(reference.node)
      && reference.specifier === rule.check.module
      && (rule.check.allowTypeOnly || !reference.typeOnly));
    if (!found) {
      findings.push(rawFinding(rule, "MISSING_REQUIRED_IMPORT", "file", filePath, fileLocation(sourceFile)));
    }
  });
};

function collectImportReferences(sourceFile: ts.SourceFile): {
  readonly staticReferences: readonly StaticImportReference[];
  readonly dynamicReferences: readonly DynamicImportReference[];
} {
  const staticReferences: StaticImportReference[] = [];
  const dynamicReferences: DynamicImportReference[] = [];
  walk(sourceFile, (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      staticReferences.push({ node, specifier: node.moduleSpecifier.text, typeOnly: importIsTypeOnly(node) });
      return;
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) {
      staticReferences.push({ node, specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
      return;
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (ts.isStringLiteralLike(expression)) {
        staticReferences.push({ node, specifier: expression.text, typeOnly: node.isTypeOnly });
      }
      return;
    }
    if (!ts.isCallExpression(node)) {
      return;
    }
    const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
    if (!isImport && !isRequire) {
      return;
    }
    const specifier = literalText(node.arguments[0]);
    if (specifier === undefined) {
      dynamicReferences.push({ node });
    } else {
      staticReferences.push({ node, specifier, typeOnly: false });
    }
  });
  return { staticReferences, dynamicReferences };
}

function importIsTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) {
    return false;
  }
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) {
    return true;
  }
  if (clause.name !== undefined || clause.namedBindings === undefined) {
    return false;
  }
  return ts.isNamedImports(clause.namedBindings)
    && clause.namedBindings.elements.length > 0
    && clause.namedBindings.elements.every((element) => element.isTypeOnly);
}

function isRelativeModule(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}
