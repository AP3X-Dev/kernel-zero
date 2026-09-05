import ts from "typescript";

import { collectFunctions, isNodeWithin, propertyChainName, unwrapExpression } from "../ast";
import { forEachMatchingSource, nodeLocation, rawFinding, type CheckEvaluator } from "../findings";

export const evaluateBoundaryParses: CheckEvaluator<"require-boundary-parse"> = (rule, repository, failedPaths, findings) => {
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
};

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
