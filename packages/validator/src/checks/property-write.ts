import ts from "typescript";

import { containsUnsafeType, literalText, propertyName, unwrapExpression, walk } from "../ast";
import { forEachMatchingSource, matchesGlob, nodeLocation, rawFinding, type CheckEvaluator, type RawFindingMessageCode } from "../findings";
import type { RepositoryProgram } from "../program";

/**
 * One write site found by the per-program index. `receiverType` is the type
 * the written property belongs to (the object being mutated, the class being
 * declared, or the literal's contextual type). `proofBlocked` marks forms that
 * cannot be judged statically: an unresolved computed key, or a spread whose
 * shape is unknown.
 */
interface WriteSite {
  readonly node: ts.Node;
  readonly property: string | undefined;
  readonly receiverType: ts.Type | undefined;
  readonly proofBlocked: boolean;
  /** For a spread inside a target-typed literal: the spread source type, judged per rule for the protected property. */
  readonly spreadType?: ts.Type;
}

type FileWrites = ReadonlyMap<string, readonly WriteSite[]>;

// ponytail: one index per program keyed by identity; rebuilt only when a new program is created.
const indexes = new WeakMap<ts.Program, FileWrites>();

const ASSIGNMENT_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

export const evaluatePropertyWrites: CheckEvaluator<"restrict-property-write"> = (rule, repository, failedPaths, findings) => {
  const { targetType, property } = rule.check;
  const subject = `property:${targetType.file}#${targetType.exportName}.${property}`;
  const checker = repository.program.getTypeChecker();
  // A type file that failed to parse already carries its PARSE_FAILURE; never prove anything from its recovered AST.
  const target = failedPaths.has(targetType.file) ? undefined : resolveTargetSymbol(repository, checker, targetType.file, targetType.exportName, property);
  if (target === undefined) {
    findings.push(rawFinding(rule, "PROPERTY_TARGET_UNRESOLVED", subject, targetType.file, undefined));
    return;
  }
  const mayContain = createContainment(target, checker);
  const writes = writeIndex(repository, checker);

  forEachMatchingSource(repository, rule.check.files, failedPaths, (filePath, sourceFile) => {
    if (rule.check.allowFrom.some((glob) => matchesGlob(filePath, glob))) {
      return;
    }
    for (const site of writes.get(filePath) ?? []) {
      const code = classifyWrite(site, property, mayContain, checker);
      if (code !== undefined) {
        findings.push(rawFinding(rule, code, subject, filePath, nodeLocation(sourceFile, site.node)));
      }
    }
  });
};

function classifyWrite(
  site: WriteSite,
  property: string,
  mayContain: (type: ts.Type) => "yes" | "no" | "unknown",
  checker: ts.TypeChecker,
): RawFindingMessageCode | undefined {
  if (site.property !== undefined && site.property !== property) {
    return undefined;
  }
  const containment = site.receiverType === undefined ? "unknown" : mayContain(site.receiverType);
  if (containment === "no") {
    return undefined;
  }
  if (site.spreadType !== undefined) {
    if (spreadAuthors(site.spreadType)) {
      return "PROPERTY_WRITE_UNRESOLVED";
    }
    if (!typeHasProperty(site.spreadType, property, checker)) {
      return undefined;
    }
  }
  if (site.proofBlocked || containment === "unknown") {
    return "PROPERTY_WRITE_UNRESOLVED";
  }
  return "PROPERTY_WRITE_DENIED";
}

function typeHasProperty(type: ts.Type, property: string, checker: ts.TypeChecker): boolean {
  if (type.isUnion()) {
    return type.types.some((member) => typeHasProperty(member, property, checker));
  }
  return checker.getPropertyOfType(type, property) !== undefined;
}

function writeIndex(repository: RepositoryProgram, checker: ts.TypeChecker): FileWrites {
  const cached = indexes.get(repository.program);
  if (cached !== undefined) {
    return cached;
  }
  const index = new Map<string, WriteSite[]>();
  for (const [filePath, sourceFile] of repository.sourceFiles) {
    const sites: WriteSite[] = [];
    walk(sourceFile, (node) => collectWriteSites(node, checker, sites));
    if (sites.length > 0) {
      index.set(filePath, sites);
    }
  }
  indexes.set(repository.program, index);
  return index;
}

function collectWriteSites(node: ts.Node, checker: ts.TypeChecker, sites: WriteSite[]): void {
  if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)) {
    // A default inside a destructuring pattern is not a write of its own; the pattern walk records the real target.
    if (isDestructuringDefault(node)) {
      return;
    }
    if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken && (ts.isObjectLiteralExpression(node.left) || ts.isArrayLiteralExpression(node.left))) {
      collectDestructuringTargets(node.left, checker, sites);
    } else {
      pushAccessWrite(node.left, node, checker, sites);
    }
    return;
  }
  if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
    && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
    pushAccessWrite(node.operand, node, checker, sites);
    return;
  }
  if (ts.isDeleteExpression(node)) {
    pushAccessWrite(node.expression, node, checker, sites);
    return;
  }
  if (ts.isPropertyDeclaration(node) && node.initializer !== undefined && ts.isClassLike(node.parent)) {
    sites.push({ node, property: propertyName(node.name), receiverType: instanceType(node.parent, checker), proofBlocked: ts.isComputedPropertyName(node.name) });
    return;
  }
  if (ts.isParameter(node) && ts.isConstructorDeclaration(node.parent) && ts.isClassLike(node.parent.parent)
    && ts.getCombinedModifierFlags(node) & ts.ModifierFlags.ParameterPropertyModifier) {
    sites.push({ node, property: propertyName(node.name), receiverType: instanceType(node.parent.parent, checker), proofBlocked: false });
    return;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const literalType = literalTargetType(node, checker);
    if (literalType === undefined) {
      return;
    }
    for (const element of node.properties) {
      if (ts.isSpreadAssignment(element)) {
        sites.push({ node: element, property: undefined, receiverType: literalType, proofBlocked: false, spreadType: checker.getTypeAtLocation(element.expression) });
      } else if (ts.isPropertyAssignment(element) || ts.isShorthandPropertyAssignment(element) || ts.isMethodDeclaration(element) || ts.isAccessor(element)) {
        sites.push({ node: element, property: propertyName(element.name), receiverType: literalType, proofBlocked: ts.isComputedPropertyName(element.name) });
      }
    }
  }
}

function pushAccessWrite(targetExpression: ts.Expression, writeNode: ts.Node, checker: ts.TypeChecker, sites: WriteSite[]): void {
  const access = unwrapExpression(targetExpression);
  if (ts.isPropertyAccessExpression(access)) {
    if (ts.isPrivateIdentifier(access.name)) {
      return;
    }
    sites.push({ node: writeNode, property: access.name.text, receiverType: checker.getTypeAtLocation(access.expression), proofBlocked: false });
    return;
  }
  if (ts.isElementAccessExpression(access)) {
    const key = literalText(access.argumentExpression) ?? constantKey(access.argumentExpression, checker);
    sites.push({ node: writeNode, property: key, receiverType: checker.getTypeAtLocation(access.expression), proofBlocked: key === undefined });
  }
}

function isDestructuringDefault(node: ts.BinaryExpression): boolean {
  if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  let current: ts.Node = node;
  while (
    ts.isPropertyAssignment(current.parent) || ts.isShorthandPropertyAssignment(current.parent) || ts.isSpreadAssignment(current.parent)
    || ts.isSpreadElement(current.parent) || ts.isArrayLiteralExpression(current.parent) || ts.isObjectLiteralExpression(current.parent)
    || ts.isParenthesizedExpression(current.parent)
  ) {
    current = current.parent;
  }
  return current !== node
    && (ts.isObjectLiteralExpression(current) || ts.isArrayLiteralExpression(current))
    && ts.isBinaryExpression(current.parent)
    && current.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && current.parent.left === current;
}

function collectDestructuringTargets(pattern: ts.ObjectLiteralExpression | ts.ArrayLiteralExpression, checker: ts.TypeChecker, sites: WriteSite[]): void {
  const elements: readonly ts.Node[] = ts.isObjectLiteralExpression(pattern) ? pattern.properties : pattern.elements;
  for (const element of elements) {
    let targetExpression: ts.Expression | undefined;
    if (ts.isPropertyAssignment(element)) targetExpression = element.initializer;
    else if (ts.isSpreadAssignment(element) || ts.isSpreadElement(element)) targetExpression = element.expression;
    else if (ts.isExpression(element)) targetExpression = element;
    if (targetExpression === undefined) continue;
    let unwrapped = unwrapExpression(targetExpression);
    // A default value (`{ a: obj.x = 1 } = source`) wraps the real target in an assignment; unwrap it first.
    if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      unwrapped = unwrapExpression(unwrapped.left);
    }
    if (ts.isObjectLiteralExpression(unwrapped) || ts.isArrayLiteralExpression(unwrapped)) {
      collectDestructuringTargets(unwrapped, checker, sites);
    } else {
      pushAccessWrite(unwrapped, element, checker, sites);
    }
  }
}

/** The instance type of a class declaration or expression; anonymous class expressions are unresolved. */
function instanceType(classNode: ts.ClassLikeDeclaration, checker: ts.TypeChecker): ts.Type | undefined {
  const symbol = classNode.name === undefined ? undefined : checker.getSymbolAtLocation(classNode.name);
  return symbol === undefined ? undefined : checker.getDeclaredTypeOfSymbol(symbol);
}

/** The type an object literal is being authored as, when a contextual type, assertion, or satisfies clause names one. */
function literalTargetType(literal: ts.ObjectLiteralExpression, checker: ts.TypeChecker): ts.Type | undefined {
  let outer: ts.Node = literal;
  while (ts.isParenthesizedExpression(outer.parent)) outer = outer.parent;
  const parent = outer.parent;
  if (ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) || ts.isTypeAssertionExpression(parent)) {
    return checker.getTypeFromTypeNode(parent.type);
  }
  return checker.getContextualType(literal);
}

/** A spread whose shape is not a resolved object may author any property, including the protected one. */
function spreadAuthors(spreadType: ts.Type): boolean {
  if (containsUnsafeType(spreadType) || spreadType.isTypeParameter()) {
    return true;
  }
  const candidate: ts.Type = spreadType;
  return (candidate.flags & ts.TypeFlags.Object) === 0 && !candidate.isUnionOrIntersection();
}

function constantKey(expression: ts.Expression, checker: ts.TypeChecker): string | undefined {
  const type = checker.getTypeAtLocation(expression);
  return type.isStringLiteral() ? type.value : undefined;
}

function resolveTargetSymbol(repository: RepositoryProgram, checker: ts.TypeChecker, file: string, exportName: string, property: string): ts.Symbol | undefined {
  const sourceFile = repository.sourceFiles.get(file);
  const moduleSymbol = sourceFile === undefined ? undefined : checker.getSymbolAtLocation(sourceFile);
  const exported = moduleSymbol === undefined ? undefined : checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === exportName);
  if (exported === undefined) return undefined;
  const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  if ((symbol.flags & ts.SymbolFlags.Type) === 0) return undefined;
  const declaration = symbol.declarations?.[0];
  if (declaration === undefined) return undefined;
  const type = checker.getDeclaredTypeOfSymbol(symbol);
  return checker.getPropertyOfType(type, property) === undefined ? undefined : symbol;
}

/** Types named in implements clauses; extends is already covered by the checker's base types. */
function implementedTypes(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): readonly ts.Type[] {
  const types: ts.Type[] = [];
  for (const declaration of symbol?.declarations ?? []) {
    if (!ts.isClassLike(declaration)) continue;
    for (const clause of declaration.heritageClauses ?? []) {
      if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue;
      for (const expression of clause.types) types.push(checker.getTypeAtLocation(expression));
    }
  }
  return types;
}

/** Whether a receiver type may be the target: by symbol through aliases, references, bases, intersections, unions, and constrained generics. */
function createContainment(target: ts.Symbol, checker: ts.TypeChecker): (type: ts.Type) => "yes" | "no" | "unknown" {
  const judge = (type: ts.Type, seen: Set<ts.Type>): "yes" | "no" | "unknown" => {
    if (seen.has(type)) return "no";
    seen.add(type);
    if (containsUnsafeType(type) && !type.isUnionOrIntersection()) return "unknown";
    if (type.aliasSymbol === target || type.symbol === target) return "yes";
    if (type.isUnionOrIntersection()) {
      let verdict: "yes" | "no" | "unknown" = "no";
      for (const member of type.types) {
        const result = judge(member, seen);
        if (result === "yes") return "yes";
        if (result === "unknown") verdict = "unknown";
      }
      return verdict;
    }
    if (type.isTypeParameter()) {
      const constraint = checker.getBaseConstraintOfType(type);
      return constraint === undefined ? "unknown" : judge(constraint, seen);
    }
    const candidate: ts.Type = type;
    if ((candidate.flags & ts.TypeFlags.Object) !== 0) {
      const objectType = candidate as ts.ObjectType;
      const declared: ts.ObjectType = (objectType.objectFlags & ts.ObjectFlags.Reference) !== 0 ? (objectType as ts.TypeReference).target : objectType;
      if (declared.symbol === target) return "yes";
      if ((declared.objectFlags & ts.ObjectFlags.ClassOrInterface) !== 0) {
        const heritage = [...checker.getBaseTypes(declared as ts.InterfaceType), ...implementedTypes(declared.symbol, checker)];
        return heritage.some((base) => judge(base, seen) === "yes") ? "yes" : "no";
      }
    }
    return "no";
  };
  return (type) => judge(type, new Set());
}
