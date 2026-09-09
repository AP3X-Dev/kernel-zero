import ts from "typescript";

import { isFunctionWithBody, isNodeWithin, unwrapExpression, walk } from "../ast";
import { forEachMatchingSource, matchesGlob, nodeLocation, rawFinding, type CheckEvaluator, type RawFindingMessageCode } from "../findings";
import { resolveCallChain } from "./argument-shape";

/**
 * Every exported function matching `symbols` is an ingress: its parameters are untrusted, and
 * untrusted values may reach only `parserCalls`, `readerCalls`, and `allowedCalls` before the
 * function ends. Anything the single forward pass cannot follow is a proof failure, never a pass.
 */
export const evaluateIngressParses: CheckEvaluator<"require-ingress-parse"> = (rule, repository, failedPaths, findings) => {
  const checker = repository.program.getTypeChecker();
  forEachMatchingSource(repository, rule.check.files, failedPaths, (filePath, sourceFile) => {
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol === undefined) {
      return;
    }
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      if (!matchesGlob(exported.name, rule.check.symbols)) {
        continue;
      }
      const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      // A type-only export has no runtime entry point, so it is not an ingress.
      if ((target.flags & ts.SymbolFlags.Value) === 0) {
        continue;
      }
      const push = (code: RawFindingMessageCode, subject: string, node: ts.Node): void => {
        findings.push(rawFinding(rule, code, `symbol:${exported.name}:${subject}`, filePath, nodeLocation(sourceFile, node)));
      };
      const provable = provableFunction(target);
      if (provable === undefined) {
        const location = [...(exported.declarations ?? []), ...(target.declarations ?? [])].find((declaration) => declaration.getSourceFile() === sourceFile) ?? sourceFile;
        push("INGRESS_UNRESOLVED", "proof", location);
        continue;
      }
      analyzeIngress(provable, rule.check, checker, sourceFile, push);
    }
  });
};

interface ProvableFunction {
  readonly node: ts.FunctionLikeDeclaration & { readonly body: ts.ConciseBody };
  readonly nameNode: ts.Node;
}

/** A function declaration with a body, or a `const` bound directly to an arrow or function expression. */
function provableFunction(symbol: ts.Symbol): ProvableFunction | undefined {
  for (const declaration of symbol.declarations ?? []) {
    if (ts.isFunctionDeclaration(declaration) && declaration.body !== undefined) {
      return { node: declaration as ProvableFunction["node"], nameNode: declaration.name ?? declaration };
    }
    if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
      const initializer = unwrapExpression(declaration.initializer);
      if ((ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) && isFunctionWithBody(initializer)) {
        return { node: initializer, nameNode: declaration.name };
      }
    }
  }
  return undefined;
}

type IngressCheck = Extract<Parameters<CheckEvaluator<"require-ingress-parse">>[0]["check"], { kind: "require-ingress-parse" }>;

// ponytail: intra-procedural only; every parameter is untrusted and nothing crosses a call boundary. Inter-procedural flow is the upgrade.
function analyzeIngress(
  { node: fn, nameNode }: ProvableFunction,
  check: IngressCheck,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  push: (code: RawFindingMessageCode, subject: string, node: ts.Node) => void,
): void {
  const untrusted = new Set<ts.Symbol>();
  const closures: ts.Node[] = [];
  // Object properties stay `boolean` where closure-assigned locals would narrow to their initial literal.
  const state = { failed: false, parsed: false, recorded: false };

  const record = (code: RawFindingMessageCode, subject: string, node: ts.Node): void => {
    push(code, subject, node);
    state.recorded = true;
    state.failed ||= code === "INGRESS_UNRESOLVED";
  };
  const symbolOf = (identifier: ts.Identifier): ts.Symbol | undefined => (
    ts.isShorthandPropertyAssignment(identifier.parent) && identifier.parent.name === identifier
      ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
      : checker.getSymbolAtLocation(identifier)
  );
  const isUntrusted = (identifier: ts.Identifier): boolean => {
    const symbol = symbolOf(identifier);
    return symbol !== undefined && untrusted.has(symbol);
  };
  const isLocal = (symbol: ts.Symbol): boolean => (
    symbol.declarations?.some((declaration) => declaration.getSourceFile() === sourceFile && isNodeWithin(declaration, fn)) ?? false
  );
  const chainOf = (call: ts.CallExpression): string | undefined => resolveCallChain(call, checker)?.chain;

  const carries = (expression: ts.Expression): boolean => {
    if (
      ts.isParenthesizedExpression(expression)
      || ts.isAsExpression(expression)
      || ts.isTypeAssertionExpression(expression)
      || ts.isNonNullExpression(expression)
      || ts.isSatisfiesExpression(expression)
      || ts.isAwaitExpression(expression)
      || ts.isSpreadElement(expression)
    ) {
      return carries(expression.expression);
    }
    if (ts.isIdentifier(expression)) {
      return isUntrusted(expression);
    }
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      return carries(expression.expression);
    }
    if (ts.isCallExpression(expression)) {
      const chain = chainOf(expression);
      return chain !== undefined && check.readerCalls.includes(chain);
    }
    if (ts.isObjectLiteralExpression(expression)) {
      return expression.properties.some((property) => {
        if (ts.isPropertyAssignment(property)) return carries(property.initializer);
        if (ts.isShorthandPropertyAssignment(property)) return isUntrusted(property.name);
        return ts.isSpreadAssignment(property) && carries(property.expression);
      });
    }
    if (ts.isArrayLiteralExpression(expression)) {
      return expression.elements.some(carries);
    }
    // Fail-closed widening beyond the enumerated forms: a value chosen or derived from untrusted input stays untrusted.
    if (ts.isConditionalExpression(expression)) {
      return carries(expression.whenTrue) || carries(expression.whenFalse);
    }
    if (ts.isBinaryExpression(expression) && isValueSelectingOperator(expression.operatorToken.kind)) {
      return carries(expression.left) || carries(expression.right);
    }
    if (ts.isTemplateExpression(expression)) {
      return expression.templateSpans.some((span) => carries(span.expression));
    }
    return false;
  };

  const addBinding = (identifier: ts.Identifier): void => {
    const symbol = checker.getSymbolAtLocation(identifier);
    if (symbol !== undefined) {
      untrusted.add(symbol);
    }
  };
  /** One level of destructuring is followed; a nested pattern is not provable. */
  const addOneLevel = (name: ts.BindingName): boolean => {
    if (ts.isIdentifier(name)) {
      addBinding(name);
      return true;
    }
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (!ts.isIdentifier(element.name)) return false;
      addBinding(element.name);
    }
    return true;
  };
  const rootIdentifier = (expression: ts.Expression): ts.Identifier | undefined => {
    let current = unwrapExpression(expression);
    while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = unwrapExpression(current.expression);
    }
    return ts.isIdentifier(current) ? current : undefined;
  };

  const visit = (node: ts.Node): void => {
    if (state.failed) {
      return;
    }
    if (node !== fn && isFunctionWithBody(node)) {
      closures.push(node);
      return;
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      record("INGRESS_UNRESOLVED", "proof", node);
      return;
    }
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined && carries(node.initializer) && !addOneLevel(node.name)) {
      record("INGRESS_UNRESOLVED", "proof", node);
      return;
    }
    if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind) && carries(node.right)) {
      const left = unwrapExpression(node.left);
      if (ts.isIdentifier(left)) {
        const symbol = checker.getSymbolAtLocation(left);
        if (symbol !== undefined && isLocal(symbol)) {
          untrusted.add(symbol);
        } else {
          record("INGRESS_ESCAPE", `escape:${left.text}`, node);
        }
      } else {
        // A property write widens a local object; any other target is a sink the pass cannot follow.
        const root = ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left) ? rootIdentifier(left) : undefined;
        const symbol = root === undefined ? undefined : checker.getSymbolAtLocation(root);
        if (symbol !== undefined && isLocal(symbol)) {
          untrusted.add(symbol);
        } else {
          record("INGRESS_UNRESOLVED", "proof", node);
          return;
        }
      }
    }
    if (ts.isCallExpression(node) && (node.arguments.some(carries) || carries(node.expression))) {
      const chain = chainOf(node);
      if (chain === undefined) {
        record("INGRESS_UNRESOLVED", "proof", node);
        return;
      }
      if (check.parserCalls.includes(chain)) {
        state.parsed = true;
      } else if (!check.readerCalls.includes(chain) && !check.allowedCalls.includes(chain)) {
        record("INGRESS_ESCAPE", `escape:${chain}`, node);
      }
    }
    if (ts.isReturnStatement(node) && node.expression !== undefined && carries(node.expression)) {
      record("INGRESS_ESCAPE", "escape:return", node);
    }
    if (
      (ts.isNewExpression(node) && (node.arguments?.some(carries) ?? false))
      || (ts.isTaggedTemplateExpression(node) && carries(node.template))
      || (ts.isThrowStatement(node) && carries(node.expression))
      || (ts.isYieldExpression(node) && node.expression !== undefined && carries(node.expression))
    ) {
      record("INGRESS_UNRESOLVED", "proof", node);
      return;
    }
    node.forEachChild(visit);
  };

  for (const parameter of fn.parameters) {
    walk(parameter.name, (child) => {
      if (ts.isIdentifier(child) && (ts.isParameter(child.parent) || ts.isBindingElement(child.parent)) && child.parent.name === child) {
        addBinding(child);
      }
    });
  }
  if (ts.isBlock(fn.body)) {
    visit(fn.body);
  } else if (carries(fn.body)) {
    record("INGRESS_ESCAPE", "escape:return", fn.body);
  } else {
    visit(fn.body);
  }

  // Closures seen before any proof failure are judged against the final set, which only ever grows.
  for (const closure of closures) {
    if (ts.isCallExpression(closure.parent) && closure.parent.arguments.includes(closure as ts.Expression)) {
      const chain = chainOf(closure.parent);
      if (chain !== undefined && check.allowedCalls.includes(chain)) continue;
    }
    const identifiers: ts.Identifier[] = [];
    walk(closure, (child) => {
      if (ts.isIdentifier(child)) identifiers.push(child);
    });
    if (identifiers.some(isUntrusted)) {
      record("INGRESS_ESCAPE", "escape:closure", closure);
    }
  }
  if (!state.parsed && !state.recorded) {
    record("INGRESS_PARSE_MISSING", "parser", nameNode);
  }
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function isValueSelectingOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.QuestionQuestionToken || kind === ts.SyntaxKind.BarBarToken || kind === ts.SyntaxKind.AmpersandAmpersandToken;
}
