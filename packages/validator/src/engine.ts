import path from "node:path";

import type { RepositoryPolicy } from "@kernel-zero/profile-software-architecture";
import ts from "typescript";

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
  | "UNKNOWN_GOVERNED_ACTION";

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

export interface RepositoryProgram {
  readonly rootPath: string;
  readonly filePaths: readonly string[];
  readonly program: ts.Program;
  readonly sourceFiles: ReadonlyMap<string, ts.SourceFile>;
  readonly parseDiagnostics: ReadonlyMap<string, readonly ts.Diagnostic[]>;
}

export interface CreateRepositoryProgramOptions {
  readonly rootPath: string;
  readonly filePaths: readonly string[];
  readonly compilerOptions?: ts.CompilerOptions;
}

type PolicyRule = RepositoryPolicy["rules"][number];
type PolicyCheck = PolicyRule["check"];

interface NamedFunction {
  readonly node: ts.FunctionLikeDeclaration;
  readonly qualifiedName: string;
}

interface StaticImportReference {
  readonly node: ts.Node;
  readonly specifier: string;
  readonly typeOnly: boolean;
}

interface DynamicImportReference {
  readonly node: ts.Node;
}

interface ExportedInitializer {
  readonly initializer: ts.Expression;
  readonly locationNode: ts.Node;
}

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  allowJs: false,
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
};

export class RepositoryProgramError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RepositoryProgramError";
  }
}

export function createRepositoryProgram(options: CreateRepositoryProgramOptions): RepositoryProgram {
  const rootPath = path.resolve(options.rootPath);
  const filePaths = [...new Set(options.filePaths.map((filePath) => normalizeContainedPath(rootPath, filePath)))].sort();
  const absoluteFiles = filePaths.map((filePath) => path.join(rootPath, ...filePath.split("/")));
  const compilerOptions = { ...DEFAULT_COMPILER_OPTIONS, ...options.compilerOptions, noEmit: true };
  const program = ts.createProgram({ rootNames: absoluteFiles, options: compilerOptions });
  const sourceFiles = new Map<string, ts.SourceFile>();
  const parseDiagnostics = new Map<string, readonly ts.Diagnostic[]>();

  for (const [index, absoluteFile] of absoluteFiles.entries()) {
    const filePath = filePaths[index];
    if (filePath === undefined) {
      throw new RepositoryProgramError("A normalized repository path could not be paired with its source file.");
    }
    const sourceFile = program.getSourceFile(absoluteFile);
    if (sourceFile === undefined) {
      throw new RepositoryProgramError(`Repository input is unreadable: ${filePath}`);
    }
    sourceFiles.set(filePath, sourceFile);
    parseDiagnostics.set(filePath, program.getSyntacticDiagnostics(sourceFile));
  }

  return { rootPath, filePaths, program, sourceFiles, parseDiagnostics };
}

export function evaluatePolicyChecks(policy: RepositoryPolicy, repository: RepositoryProgram): RawValidatorFinding[] {
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
  }
}

function evaluateForbiddenImports(
  rule: PolicyRule & { readonly check: Extract<PolicyCheck, { kind: "forbid-import-edge" }> },
  repository: RepositoryProgram,
  failedPaths: ReadonlySet<string>,
  findings: RawValidatorFinding[],
): void {
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
}

function evaluateRequiredImports(
  rule: PolicyRule & { readonly check: Extract<PolicyCheck, { kind: "require-import" }> },
  repository: RepositoryProgram,
  failedPaths: ReadonlySet<string>,
  findings: RawValidatorFinding[],
): void {
  forEachMatchingSource(repository, rule.check.files, failedPaths, (filePath, sourceFile) => {
    const found = collectImportReferences(sourceFile).staticReferences.some((reference) =>
      ts.isImportDeclaration(reference.node)
      && reference.specifier === rule.check.module
      && (rule.check.allowTypeOnly || !reference.typeOnly));
    if (!found) {
      findings.push(rawFinding(rule, "MISSING_REQUIRED_IMPORT", "file", filePath, fileLocation(sourceFile)));
    }
  });
}

function evaluateRestrictedCalls(
  rule: PolicyRule & { readonly check: Extract<PolicyCheck, { kind: "restrict-call-site" }> },
  repository: RepositoryProgram,
  failedPaths: ReadonlySet<string>,
  findings: RawValidatorFinding[],
): void {
  const checker = repository.program.getTypeChecker();
  forEachMatchingSource(repository, ["**/*"], failedPaths, (filePath, sourceFile) => {
    if (rule.check.allowFrom.some((glob) => matchesGlob(filePath, glob))) {
      return;
    }
    walk(sourceFile, (node) => {
      if (!ts.isCallExpression(node)) {
        return;
      }
      const callee = resolveCalleeName(node.expression, checker, new Set());
      if (callee !== undefined && rule.check.callee.includes(callee)) {
        findings.push(rawFinding(rule, "RESTRICTED_CALL_SITE", callee, filePath, nodeLocation(sourceFile, node.expression)));
        return;
      }
      if (callee === undefined && rule.check.requireResolution && rule.level === "error") {
        const root = expressionRootName(node.expression);
        const possible = root === undefined ? undefined : rule.check.callee.find((restricted) => restricted.startsWith(`${root}.`));
        if (possible !== undefined) {
          findings.push(rawFinding(rule, "CALL_RESOLUTION_FAILED", possible, filePath, nodeLocation(sourceFile, node.expression)));
        }
      }
    });
  });
}

function evaluateExportKeys(
  rule: PolicyRule & { readonly check: Extract<PolicyCheck, { kind: "require-export-keys" }> },
  repository: RepositoryProgram,
  failedPaths: ReadonlySet<string>,
  findings: RawValidatorFinding[],
): void {
  const checker = repository.program.getTypeChecker();
  forEachMatchingSource(repository, rule.check.files, failedPaths, (filePath, sourceFile) => {
    const exported = findExportedInitializer(sourceFile, checker, rule.check.exportName);
    const object = exported === undefined ? undefined : asObjectLiteral(exported.initializer);
    const keys = object === undefined ? new Set<string>() : objectLiteralKeys(object);
    const proofBlocked = object?.properties.some((property) => ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name)) ?? false;
    for (const requiredKey of rule.check.requiredKeys) {
      if (keys.has(requiredKey)) {
        continue;
      }
      const code: RawFindingMessageCode = proofBlocked ? "EXPORT_PROOF_FAILED" : "MISSING_EXPORT_KEY";
      findings.push(rawFinding(
        rule,
        code,
        `export:${rule.check.exportName}:${requiredKey}`,
        filePath,
        nodeLocation(sourceFile, exported?.locationNode ?? sourceFile),
      ));
    }
  });
}

function evaluateTenantParameters(
  rule: PolicyRule & { readonly check: Extract<PolicyCheck, { kind: "require-tenant-parameter" }> },
  repository: RepositoryProgram,
  failedPaths: ReadonlySet<string>,
  findings: RawValidatorFinding[],
): void {
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
}

function evaluateBoundaryParses(
  rule: PolicyRule & { readonly check: Extract<PolicyCheck, { kind: "require-boundary-parse" }> },
  repository: RepositoryProgram,
  failedPaths: ReadonlySet<string>,
  findings: RawValidatorFinding[],
): void {
  forEachMatchingSource(repository, rule.check.files, failedPaths, (filePath, sourceFile) => {
    for (const candidate of collectFunctions(sourceFile)) {
      visitFunctionBodyWithGuards(candidate.node, (node, successGuards) => {
        if (!ts.isCallExpression(node)) {
          return;
        }
        const boundaryCall = propertyChainName(node.expression);
        if (boundaryCall === undefined || !rule.check.boundaryCalls.includes(boundaryCall)) {
          return;
        }
        const proven = node.arguments.some((argument) => isParsedValue(
          argument,
          node,
          candidate.node,
          rule.check.parserCalls,
          successGuards,
        ));
        if (!proven) {
          findings.push(rawFinding(
            rule,
            "UNPARSED_BOUNDARY",
            `symbol:${candidate.qualifiedName}:${boundaryCall}`,
            filePath,
            nodeLocation(sourceFile, node),
          ));
        }
      });
    }
  });
}

function evaluateGovernedOperations(
  rule: PolicyRule & { readonly check: Extract<PolicyCheck, { kind: "require-governed-operation" }> },
  repository: RepositoryProgram,
  failedPaths: ReadonlySet<string>,
  findings: RawValidatorFinding[],
): void {
  const checker = repository.program.getTypeChecker();
  forEachMatchingSource(repository, rule.check.files, failedPaths, (filePath, sourceFile) => {
    const exported = findExportedInitializer(sourceFile, checker, rule.check.registryExport);
    const registry = exported === undefined ? undefined : asObjectLiteral(exported.initializer);
    const actionIds = new Set<string>();

    if (registry === undefined) {
      findings.push(rawFinding(
        rule,
        "GOVERNED_REGISTRY_PROOF_FAILED",
        `action:<registry>:registry`,
        filePath,
        nodeLocation(sourceFile, exported?.locationNode ?? sourceFile),
      ));
    } else {
      for (const property of registry.properties) {
        if (ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name)) {
          findings.push(rawFinding(
            rule,
            "GOVERNED_REGISTRY_PROOF_FAILED",
            "action:<dynamic>:registry",
            filePath,
            nodeLocation(sourceFile, property),
          ));
          continue;
        }
        const actionId = propertyName(property.name);
        if (actionId === undefined) {
          continue;
        }
        actionIds.add(actionId);
        const entry = propertyInitializer(property);
        const entryCall = entry === undefined ? undefined : asConfiguredDeclarationCall(entry, rule.check.declarationCalls);
        if (entryCall !== undefined) {
          const declaredActionId = literalText(entryCall.arguments[0]);
          if (declaredActionId !== actionId) {
            findings.push(rawFinding(
              rule,
              "INVALID_GOVERNED_KEY",
              `action:${actionId}:actionId`,
              filePath,
              nodeLocation(sourceFile, property),
            ));
          }
        }
        const metadataExpression = entryCall?.arguments[1] ?? entry;
        const object = metadataExpression === undefined ? undefined : asObjectLiteral(metadataExpression);
        const keys = object === undefined ? new Set<string>() : objectLiteralKeys(object);
        const proofBlocked = object?.properties.some((child) => ts.isSpreadAssignment(child) || ts.isComputedPropertyName(child.name)) ?? false;
        for (const requiredKey of rule.check.requiredKeys) {
          if (keys.has(requiredKey)) {
            continue;
          }
          findings.push(rawFinding(
            rule,
            proofBlocked || object === undefined ? "INVALID_GOVERNED_KEY" : "MISSING_GOVERNED_KEY",
            `action:${actionId}:${requiredKey}`,
            filePath,
            nodeLocation(sourceFile, property),
          ));
        }
      }
    }

    walk(sourceFile, (node) => {
      if (!ts.isCallExpression(node)) {
        return;
      }
      const callee = propertyChainName(node.expression);
      if (callee === undefined || !rule.check.declarationCalls.includes(callee)) {
        return;
      }
      const actionId = literalText(node.arguments[0]);
      if (actionId === undefined) {
        findings.push(rawFinding(
          rule,
          "GOVERNED_DECLARATION_PROOF_FAILED",
          "action:<dynamic>:actionId",
          filePath,
          nodeLocation(sourceFile, node),
        ));
      } else if (!actionIds.has(actionId)) {
        findings.push(rawFinding(
          rule,
          "UNKNOWN_GOVERNED_ACTION",
          `action:${actionId}:registry`,
          filePath,
          nodeLocation(sourceFile, node),
        ));
      }
    });
  });
}

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

function resolveRepositoryModule(repository: RepositoryProgram, sourceFile: ts.SourceFile, specifier: string): string | undefined {
  const resolved = ts.resolveModuleName(
    specifier,
    sourceFile.fileName,
    repository.program.getCompilerOptions(),
    ts.sys,
  ).resolvedModule?.resolvedFileName;
  if (resolved === undefined) {
    return undefined;
  }
  return containedRelativePath(repository.rootPath, resolved);
}

function resolveCalleeName(expression: ts.Expression, checker: ts.TypeChecker, seen: Set<ts.Symbol>): string | undefined {
  const direct = propertyChainName(expression, checker);
  if (direct !== undefined) {
    return direct;
  }
  const unwrapped = unwrapExpression(expression);
  if (!ts.isIdentifier(unwrapped)) {
    return undefined;
  }
  const symbol = checker.getSymbolAtLocation(unwrapped);
  if (symbol === undefined || seen.has(symbol)) {
    return undefined;
  }
  seen.add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
      const resolved = resolveCalleeName(declaration.initializer, checker, seen);
      if (resolved !== undefined) {
        return resolved;
      }
    }
  }
  return undefined;
}

function propertyChainName(expression: ts.Expression, checker?: ts.TypeChecker): string | undefined {
  const node = unwrapExpression(expression);
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  if (node.kind === ts.SyntaxKind.ThisKeyword) {
    return "this";
  }
  if (ts.isPropertyAccessExpression(node)) {
    const parent = propertyChainName(node.expression, checker);
    return parent === undefined ? undefined : `${parent}.${node.name.text}`;
  }
  if (ts.isElementAccessExpression(node)) {
    const parent = propertyChainName(node.expression, checker);
    const key = literalText(node.argumentExpression) ?? (checker === undefined ? undefined : constantString(node.argumentExpression, checker));
    return parent === undefined || key === undefined ? undefined : `${parent}.${key}`;
  }
  return undefined;
}

function constantString(expression: ts.Expression, checker: ts.TypeChecker): string | undefined {
  if (!ts.isIdentifier(expression)) {
    return undefined;
  }
  const symbol = checker.getSymbolAtLocation(expression);
  for (const declaration of symbol?.declarations ?? []) {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
      return literalText(declaration.initializer);
    }
  }
  return undefined;
}

function expressionRootName(expression: ts.Expression): string | undefined {
  let current = unwrapExpression(expression);
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = unwrapExpression(current.expression);
  }
  return ts.isIdentifier(current) ? current.text : undefined;
}

function findExportedInitializer(sourceFile: ts.SourceFile, checker: ts.TypeChecker, exportName: string): ExportedInitializer | undefined {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  const exported = moduleSymbol === undefined
    ? undefined
    : checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === exportName);
  if (exported === undefined) {
    return undefined;
  }
  const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  for (const declaration of target.declarations ?? []) {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
      return { initializer: declaration.initializer, locationNode: declaration };
    }
    if (ts.isPropertyAssignment(declaration)) {
      return { initializer: declaration.initializer, locationNode: declaration };
    }
  }
  return undefined;
}

function collectExportedFunctions(sourceFile: ts.SourceFile, checker: ts.TypeChecker): readonly NamedFunction[] {
  const found = new Map<string, NamedFunction>();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) {
    return [];
  }
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    for (const declaration of target.declarations ?? []) {
      if (ts.isFunctionDeclaration(declaration) && declaration.body !== undefined) {
        found.set(exported.name, { node: declaration, qualifiedName: exported.name });
      } else if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
        collectInitializerFunctions(declaration.initializer, exported.name, found);
      } else if (ts.isClassDeclaration(declaration)) {
        for (const member of declaration.members) {
          if (ts.isMethodDeclaration(member) && member.body !== undefined) {
            const name = propertyName(member.name);
            if (name !== undefined) {
              found.set(`${exported.name}.${name}`, { node: member, qualifiedName: `${exported.name}.${name}` });
            }
          }
        }
      }
    }
  }
  return [...found.values()].sort((left, right) => left.node.getStart(sourceFile) - right.node.getStart(sourceFile));
}

function collectInitializerFunctions(expression: ts.Expression, prefix: string, found: Map<string, NamedFunction>): void {
  const initializer = unwrapExpression(expression);
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    found.set(prefix, { node: initializer, qualifiedName: prefix });
    return;
  }
  if (!ts.isObjectLiteralExpression(initializer)) {
    return;
  }
  for (const property of initializer.properties) {
    const name = ts.isSpreadAssignment(property) ? undefined : propertyName(property.name);
    if (name === undefined) {
      continue;
    }
    const qualifiedName = `${prefix}.${name}`;
    if (ts.isMethodDeclaration(property)) {
      found.set(qualifiedName, { node: property, qualifiedName });
    } else if (ts.isPropertyAssignment(property)) {
      collectInitializerFunctions(property.initializer, qualifiedName, found);
    }
  }
}

function collectFunctions(sourceFile: ts.SourceFile): readonly NamedFunction[] {
  const functions: NamedFunction[] = [];
  walkWithStructuralParent(sourceFile, undefined, (node, parent) => {
    if (!isFunctionWithBody(node)) {
      return;
    }
    functions.push({ node, qualifiedName: functionQualifiedName(node, parent, sourceFile) });
  });
  return functions;
}

function functionQualifiedName(
  node: ts.FunctionLikeDeclaration,
  parent: ts.Node | undefined,
  sourceFile: ts.SourceFile,
): string {
  if (node.name !== undefined) {
    const name = propertyName(node.name);
    if (name !== undefined) {
      if (
        ts.isMethodDeclaration(node)
        && parent !== undefined
        && (ts.isClassDeclaration(parent) || ts.isClassExpression(parent))
      ) {
        const owner = parent.name?.text ?? "<anonymous-class>";
        return `${owner}.${name}`;
      }
      return name;
    }
  }
  if (parent !== undefined && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `<anonymous@${String(location.line + 1)}:${String(location.character + 1)}>`;
}

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

function containsUnsafeType(type: ts.Type): boolean {
  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0) {
    return true;
  }
  return type.isUnionOrIntersection() && type.types.some(containsUnsafeType);
}

function isParsedValue(
  expression: ts.Expression,
  useNode: ts.Node,
  functionNode: ts.FunctionLikeDeclaration,
  parserCalls: readonly string[],
  successGuards: ReadonlySet<string>,
  seen = new Set<string>(),
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (ts.isCallExpression(unwrapped)) {
    const callName = propertyChainName(unwrapped.expression);
    return callName !== undefined && parserCalls.includes(callName) && !callName.endsWith("safeParse");
  }
  if (ts.isPropertyAccessExpression(unwrapped) && unwrapped.name.text === "data" && ts.isIdentifier(unwrapped.expression)) {
    const resultName = unwrapped.expression.text;
    const initializer = findDominatingInitializer(resultName, useNode, functionNode);
    if (
      initializer !== undefined
      && ts.isCallExpression(unwrapExpression(initializer))
      && parserCalls.includes(propertyChainName((unwrapExpression(initializer) as ts.CallExpression).expression) ?? "")
      && successGuards.has(resultName)
    ) {
      return true;
    }
  }
  if (!ts.isIdentifier(unwrapped) || seen.has(unwrapped.text)) {
    return false;
  }
  seen.add(unwrapped.text);
  const initializer = findDominatingInitializer(unwrapped.text, useNode, functionNode);
  return initializer !== undefined && isParsedValue(initializer, useNode, functionNode, parserCalls, successGuards, seen);
}

function findDominatingInitializer(
  identifier: string,
  useNode: ts.Node,
  functionNode: ts.FunctionLikeDeclaration,
): ts.Expression | undefined {
  let best: { readonly position: number; readonly expression: ts.Expression } | undefined;
  visitFunctionBody(functionNode, (node) => {
    let candidate: ts.Expression | undefined;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === identifier) {
      candidate = node.initializer;
    } else if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left)
      && node.left.text === identifier
    ) {
      candidate = node.right;
    }
    if (candidate === undefined || node.pos >= useNode.pos || !lexicallyDominates(node, useNode, functionNode)) {
      return;
    }
    if (best === undefined || node.pos > best.position) {
      best = { position: node.pos, expression: candidate };
    }
  });
  return best?.expression;
}

function lexicallyDominates(candidate: ts.Node, useNode: ts.Node, functionNode: ts.FunctionLikeDeclaration): boolean {
  const candidateBlock = enclosingBlock(candidate, functionNode);
  const useBlock = enclosingBlock(useNode, functionNode);
  return candidateBlock === useBlock || isNodeWithin(useNode, candidateBlock);
}

function enclosingBlock(node: ts.Node, functionNode: ts.FunctionLikeDeclaration): ts.Node {
  let smallest: ts.Node = functionNode;
  visitFunctionBody(functionNode, (candidate) => {
    if (
      (ts.isBlock(candidate) || ts.isCaseBlock(candidate))
      && isNodeWithin(node, candidate)
      && candidate.end - candidate.pos < smallest.end - smallest.pos
    ) {
      smallest = candidate;
    }
  });
  return smallest;
}

function successfulParseIdentifiers(expression: ts.Expression): ReadonlySet<string> {
  const identifiers = new Set<string>();
  collectSuccessfulParseIdentifiers(expression, identifiers);
  return identifiers;
}

function successfulParseIdentifiersWhenFalse(expression: ts.Expression): ReadonlySet<string> {
  const identifiers = new Set<string>();
  collectSuccessfulParseIdentifiersWhenFalse(expression, identifiers);
  return identifiers;
}

function collectSuccessfulParseIdentifiers(expression: ts.Expression, identifiers: Set<string>): void {
  const value = unwrapExpression(expression);
  if (
    ts.isPropertyAccessExpression(value)
    && value.name.text === "success"
    && ts.isIdentifier(value.expression)
  ) {
    identifiers.add(value.expression.text);
    return;
  }
  if (ts.isBinaryExpression(value) && (value.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || value.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)) {
    if (value.right.kind === ts.SyntaxKind.TrueKeyword) {
      collectSuccessfulParseIdentifiers(value.left, identifiers);
    }
    if (value.left.kind === ts.SyntaxKind.TrueKeyword) {
      collectSuccessfulParseIdentifiers(value.right, identifiers);
    }
    return;
  }
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    collectSuccessfulParseIdentifiers(value.left, identifiers);
    collectSuccessfulParseIdentifiers(value.right, identifiers);
  }
}

function collectSuccessfulParseIdentifiersWhenFalse(expression: ts.Expression, identifiers: Set<string>): void {
  const value = unwrapExpression(expression);
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.ExclamationToken) {
    collectSuccessfulParseIdentifiers(value.operand, identifiers);
    return;
  }
  if (ts.isBinaryExpression(value)) {
    if (value.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      collectSuccessfulParseIdentifiersWhenFalse(value.left, identifiers);
      collectSuccessfulParseIdentifiersWhenFalse(value.right, identifiers);
      return;
    }
    if (value.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || value.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken) {
      if (value.right.kind === ts.SyntaxKind.FalseKeyword) {
        collectSuccessfulParseIdentifiers(value.left, identifiers);
      }
      if (value.left.kind === ts.SyntaxKind.FalseKeyword) {
        collectSuccessfulParseIdentifiers(value.right, identifiers);
      }
      return;
    }
    if (value.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken || value.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken) {
      if (value.right.kind === ts.SyntaxKind.TrueKeyword) {
        collectSuccessfulParseIdentifiers(value.left, identifiers);
      }
      if (value.left.kind === ts.SyntaxKind.TrueKeyword) {
        collectSuccessfulParseIdentifiers(value.right, identifiers);
      }
    }
  }
}

function visitFunctionBody(node: ts.FunctionLikeDeclaration, visitor: (node: ts.Node) => void): void {
  const body = node.body;
  if (body === undefined) {
    return;
  }
  const visit = (child: ts.Node): void => {
    if (child !== body && ts.isFunctionLike(child)) {
      return;
    }
    visitor(child);
    child.forEachChild(visit);
  };
  visit(body);
}

function visitFunctionBodyWithGuards(
  node: ts.FunctionLikeDeclaration,
  visitor: (node: ts.Node, successGuards: ReadonlySet<string>) => void,
): void {
  const body = node.body;
  if (body === undefined) {
    return;
  }
  const visit = (child: ts.Node, successGuards: ReadonlySet<string>): void => {
    if (child !== body && ts.isFunctionLike(child)) {
      return;
    }
    visitor(child, successGuards);
    if (ts.isBlock(child)) {
      const followingGuards = new Set(successGuards);
      for (const statement of child.statements) {
        visit(statement, followingGuards);
        if (ts.isIfStatement(statement)) {
          if (statementDefinitelyTerminates(statement.thenStatement)) {
            for (const identifier of successfulParseIdentifiersWhenFalse(statement.expression)) {
              followingGuards.add(identifier);
            }
          }
          if (statement.elseStatement !== undefined && statementDefinitelyTerminates(statement.elseStatement)) {
            for (const identifier of successfulParseIdentifiers(statement.expression)) {
              followingGuards.add(identifier);
            }
          }
        }
        if (statementDefinitelyTerminates(statement)) {
          break;
        }
      }
      return;
    }
    if (ts.isIfStatement(child)) {
      visit(child.expression, successGuards);
      const guardedThen = new Set(successGuards);
      for (const identifier of successfulParseIdentifiers(child.expression)) {
        guardedThen.add(identifier);
      }
      visit(child.thenStatement, guardedThen);
      if (child.elseStatement !== undefined) {
        const guardedElse = new Set(successGuards);
        for (const identifier of successfulParseIdentifiersWhenFalse(child.expression)) {
          guardedElse.add(identifier);
        }
        visit(child.elseStatement, guardedElse);
      }
      return;
    }
    child.forEachChild((descendant) => visit(descendant, successGuards));
  };
  visit(body, new Set());
}

function statementDefinitelyTerminates(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
    return true;
  }
  if (ts.isBlock(statement)) {
    return statement.statements.some(statementDefinitelyTerminates);
  }
  return ts.isIfStatement(statement)
    && statement.elseStatement !== undefined
    && statementDefinitelyTerminates(statement.thenStatement)
    && statementDefinitelyTerminates(statement.elseStatement);
}

function forEachMatchingSource(
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

function ruleClaimsPath(check: PolicyCheck, filePath: string): boolean {
  switch (check.kind) {
    case "forbid-import-edge":
      return check.from.some((glob) => matchesGlob(filePath, glob));
    case "restrict-call-site":
      return true;
    case "require-import":
    case "require-export-keys":
    case "require-tenant-parameter":
    case "require-boundary-parse":
    case "require-governed-operation":
      return check.files.some((glob) => matchesGlob(filePath, glob));
  }
}

function matchesGlob(value: string, glob: string): boolean {
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

function normalizeContainedPath(rootPath: string, filePath: string): string {
  const posixPath = filePath.replaceAll("\\", "/");
  if (posixPath.length === 0 || path.posix.isAbsolute(posixPath) || /^[A-Za-z]:/u.test(posixPath)) {
    throw new RepositoryProgramError(`Repository input must be a contained relative path: ${filePath}`);
  }
  const normalized = path.posix.normalize(posixPath);
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("\0")) {
    throw new RepositoryProgramError(`Repository input must be a contained relative path: ${filePath}`);
  }
  const absolutePath = path.resolve(rootPath, ...normalized.split("/"));
  if (containedRelativePath(rootPath, absolutePath) === undefined) {
    throw new RepositoryProgramError(`Repository input must be a contained relative path: ${filePath}`);
  }
  return normalized;
}

function containedRelativePath(rootPath: string, absolutePath: string): string | undefined {
  const relative = path.relative(rootPath, path.resolve(absolutePath));
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.replaceAll("\\", "/");
}

function rawFinding(
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

function nodeLocation(sourceFile: ts.SourceFile, node: ts.Node): RawFindingLocation {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

function diagnosticLocation(sourceFile: ts.SourceFile, diagnostic: ts.Diagnostic): RawFindingLocation {
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

function fileLocation(sourceFile: ts.SourceFile): RawFindingLocation {
  return nodeLocation(sourceFile, sourceFile);
}

function compareFindings(left: RawValidatorFinding, right: RawValidatorFinding): number {
  return left.ruleId.localeCompare(right.ruleId)
    || left.path.localeCompare(right.path)
    || left.location.startLine - right.location.startLine
    || left.location.startColumn - right.location.startColumn
    || left.messageCode.localeCompare(right.messageCode)
    || left.subject.localeCompare(right.subject);
}

function walk(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node);
  node.forEachChild((child) => walk(child, visitor));
}

function walkWithStructuralParent(
  node: ts.Node,
  parent: ts.Node | undefined,
  visitor: (node: ts.Node, parent: ts.Node | undefined) => void,
): void {
  visitor(node, parent);
  node.forEachChild((child) => walkWithStructuralParent(child, node, visitor));
}

function isFunctionWithBody(node: ts.Node): node is ts.FunctionLikeDeclaration & { readonly body: ts.ConciseBody } {
  return ts.isFunctionLike(node) && "body" in node && node.body !== undefined;
}

function isNodeWithin(node: ts.Node, ancestor: ts.Node): boolean {
  return node.pos >= ancestor.pos && node.end <= ancestor.end;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function asObjectLiteral(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  const value = unwrapExpression(expression);
  if (ts.isObjectLiteralExpression(value)) {
    return value;
  }
  if (
    ts.isCallExpression(value)
    && value.arguments.length === 1
    && ts.isPropertyAccessExpression(value.expression)
    && value.expression.questionDotToken === undefined
    && ts.isIdentifier(value.expression.expression)
    && value.expression.expression.text === "Object"
    && value.expression.name.text === "freeze"
  ) {
    const wrappedExpression = value.arguments.at(0);
    if (wrappedExpression === undefined) {
      return undefined;
    }
    const wrapped = unwrapExpression(wrappedExpression);
    return ts.isObjectLiteralExpression(wrapped) ? wrapped : undefined;
  }
  return undefined;
}

function objectLiteralKeys(object: ts.ObjectLiteralExpression): Set<string> {
  const keys = new Set<string>();
  for (const property of object.properties) {
    if (!ts.isSpreadAssignment(property) && !ts.isComputedPropertyName(property.name)) {
      const key = propertyName(property.name);
      if (key !== undefined) {
        keys.add(key);
      }
    }
  }
  return keys;
}

function propertyInitializer(property: ts.ObjectLiteralElementLike): ts.Expression | undefined {
  if (ts.isPropertyAssignment(property)) {
    return property.initializer;
  }
  if (ts.isShorthandPropertyAssignment(property)) {
    return property.name;
  }
  return undefined;
}

function asConfiguredDeclarationCall(
  expression: ts.Expression,
  declarationCalls: readonly string[],
): ts.CallExpression | undefined {
  const value = unwrapExpression(expression);
  if (!ts.isCallExpression(value)) {
    return undefined;
  }
  const callee = propertyChainName(value.expression);
  return callee !== undefined && declarationCalls.includes(callee) ? value : undefined;
}

function propertyName(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (name === undefined) {
    return undefined;
  }
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function literalText(expression: ts.Expression | undefined): string | undefined {
  if (expression === undefined) {
    return undefined;
  }
  const value = unwrapExpression(expression);
  return ts.isStringLiteralLike(value) ? value.text : undefined;
}

function isRelativeModule(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}
