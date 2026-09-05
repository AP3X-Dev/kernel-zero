import ts from "typescript";

export interface NamedFunction {
  readonly node: ts.FunctionLikeDeclaration;
  readonly qualifiedName: string;
}

export interface ExportedInitializer {
  readonly initializer: ts.Expression;
  readonly locationNode: ts.Node;
}

export function walk(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node);
  node.forEachChild((child) => walk(child, visitor));
}

export function walkWithStructuralParent(
  node: ts.Node,
  parent: ts.Node | undefined,
  visitor: (node: ts.Node, parent: ts.Node | undefined) => void,
): void {
  visitor(node, parent);
  node.forEachChild((child) => walkWithStructuralParent(child, node, visitor));
}

export function isFunctionWithBody(node: ts.Node): node is ts.FunctionLikeDeclaration & { readonly body: ts.ConciseBody } {
  return ts.isFunctionLike(node) && "body" in node && node.body !== undefined;
}

export function isNodeWithin(node: ts.Node, ancestor: ts.Node): boolean {
  return node.pos >= ancestor.pos && node.end <= ancestor.end;
}

export function unwrapExpression(expression: ts.Expression): ts.Expression {
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

/** A direct object literal or an exact `Object.freeze({...})`; anything else is not statically provable. */
export function asObjectLiteral(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
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

export function isProofBlockingProperty(property: ts.ObjectLiteralElementLike): boolean {
  return ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name);
}

export function objectLiteralKeys(object: ts.ObjectLiteralExpression): Set<string> {
  const keys = new Set<string>();
  for (const property of object.properties) {
    if (!isProofBlockingProperty(property)) {
      const key = propertyName(property.name);
      if (key !== undefined) {
        keys.add(key);
      }
    }
  }
  return keys;
}

export function propertyInitializer(property: ts.ObjectLiteralElementLike): ts.Expression | undefined {
  if (ts.isPropertyAssignment(property)) {
    return property.initializer;
  }
  if (ts.isShorthandPropertyAssignment(property)) {
    return property.name;
  }
  return undefined;
}

export function propertyName(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (name === undefined) {
    return undefined;
  }
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

export function literalText(expression: ts.Expression | undefined): string | undefined {
  if (expression === undefined) {
    return undefined;
  }
  const value = unwrapExpression(expression);
  return ts.isStringLiteralLike(value) ? value.text : undefined;
}

export function propertyChainName(expression: ts.Expression, checker?: ts.TypeChecker): string | undefined {
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

export function expressionRootName(expression: ts.Expression): string | undefined {
  let current = unwrapExpression(expression);
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = unwrapExpression(current.expression);
  }
  return ts.isIdentifier(current) ? current.text : undefined;
}

export function resolveCalleeName(expression: ts.Expression, checker: ts.TypeChecker, seen: Set<ts.Symbol>): string | undefined {
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

export function findExportedInitializer(sourceFile: ts.SourceFile, checker: ts.TypeChecker, exportName: string): ExportedInitializer | undefined {
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

export function collectExportedFunctions(sourceFile: ts.SourceFile, checker: ts.TypeChecker): readonly NamedFunction[] {
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

export function collectFunctions(sourceFile: ts.SourceFile): readonly NamedFunction[] {
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

export function containsUnsafeType(type: ts.Type): boolean {
  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0) {
    return true;
  }
  return type.isUnionOrIntersection() && type.types.some(containsUnsafeType);
}
