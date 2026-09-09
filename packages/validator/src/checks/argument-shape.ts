import ts from "typescript";

import {
  containsUnsafeType,
  expressionRootName,
  literalText,
  propertyInitializer,
  propertyName,
  resolveCalleeName,
  unwrapExpression,
} from "../ast";
import { matchesGlob } from "../findings";

/**
 * Shared static prover for call-argument shapes: whether a dotted path is
 * provably present inside a call argument, and which callee chain a call
 * reaches. Adapters map this analysis onto their own codes; this module never
 * emits findings.
 */
export type PathProof =
  | { readonly kind: "present"; readonly value: ts.Expression; readonly literal: string | undefined }
  | { readonly kind: "missing" }
  | { readonly kind: "unprovable"; readonly reason: "not-literal" | "spread" | "computed" | "cycle" };

export interface CallChain {
  /** The textual callee chain `restrict-call-site` matches. */
  readonly chain: string;
  /** True when the innermost raw receiver expression has an unsafe (any/unknown/undefined/void) type. */
  readonly unsafeReceiver: boolean;
}

const MISSING: PathProof = Object.freeze({ kind: "missing" });

function unprovable(reason: Extract<PathProof, { kind: "unprovable" }>["reason"]): PathProof {
  return { kind: "unprovable", reason };
}

export function proveObjectPath(
  argument: ts.Expression | undefined,
  path: readonly string[],
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): PathProof {
  return prove(argument, path, checker, sourceFile, new Set());
}

function prove(
  expression: ts.Expression | undefined,
  path: readonly string[],
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  seen: Set<ts.Symbol>,
): PathProof {
  if (expression === undefined) {
    return MISSING;
  }
  const value = unwrapValue(expression);
  const [head, ...rest] = path;
  if (head === undefined) {
    return isUndefinedValue(value) ? MISSING : { kind: "present", value, literal: literalText(value) };
  }
  // ponytail: a conditional in the key's own position is unprovable; branch-wise proof is the upgrade.
  if (ts.isConditionalExpression(value)) {
    return unprovable("not-literal");
  }
  if (ts.isIdentifier(value)) {
    const initializer = constInitializer(value, checker, sourceFile, seen);
    if (initializer === "cycle") {
      return unprovable("cycle");
    }
    return initializer === undefined ? unprovable("not-literal") : prove(initializer, path, checker, sourceFile, seen);
  }
  if (!ts.isObjectLiteralExpression(value)) {
    return unprovable("not-literal");
  }

  let keyIndex = -1;
  for (const [index, property] of value.properties.entries()) {
    if (ts.isSpreadAssignment(property)) {
      continue;
    }
    const name = memberName(property);
    if (name === undefined) {
      return unprovable("computed");
    }
    if (name === head) {
      keyIndex = index;
    }
  }
  const keyProperty = keyIndex < 0 ? undefined : value.properties[keyIndex];
  if (keyProperty === undefined) {
    return value.properties.some(ts.isSpreadAssignment) ? unprovable("spread") : MISSING;
  }
  // Spreads before the key are always harmless: the later literal key wins.
  for (const property of value.properties.slice(keyIndex + 1)) {
    if (ts.isSpreadAssignment(property) && !isHarmlessSpread(property.expression, head)) {
      return unprovable("spread");
    }
  }
  const initializer = propertyInitializer(keyProperty);
  if (initializer === undefined) {
    return unprovable("not-literal");
  }
  return prove(initializer, rest, checker, sourceFile, seen);
}

/** `unwrapExpression` plus an exact `Object.freeze(<expr>)` wrapper. */
function unwrapValue(expression: ts.Expression): ts.Expression {
  const value = unwrapExpression(expression);
  if (
    ts.isCallExpression(value)
    && value.arguments.length === 1
    && ts.isPropertyAccessExpression(value.expression)
    && value.expression.questionDotToken === undefined
    && ts.isIdentifier(value.expression.expression)
    && value.expression.expression.text === "Object"
    && value.expression.name.text === "freeze"
  ) {
    const wrapped = value.arguments[0];
    return wrapped === undefined ? value : unwrapValue(wrapped);
  }
  return value;
}

function isUndefinedValue(value: ts.Expression): boolean {
  return (ts.isIdentifier(value) && value.text === "undefined") || ts.isVoidExpression(value);
}

/** The member's own name; undefined for a computed key that is not a string literal. */
function memberName(property: Exclude<ts.ObjectLiteralElementLike, ts.SpreadAssignment>): string | undefined {
  return ts.isComputedPropertyName(property.name) ? literalText(property.name.expression) : propertyName(property.name);
}

/**
 * A spread is harmless for `key` when its operand is an object literal, or a conditional
 * whose branches are both object literals, and each literal's own top-level members have no
 * spread, no computed key, and no member named `key`. Nested values are not inspected.
 */
function isHarmlessSpread(operand: ts.Expression, key: string): boolean {
  const value = unwrapValue(operand);
  if (ts.isConditionalExpression(value)) {
    return isHarmlessLiteral(unwrapValue(value.whenTrue), key) && isHarmlessLiteral(unwrapValue(value.whenFalse), key);
  }
  return isHarmlessLiteral(value, key);
}

function isHarmlessLiteral(value: ts.Expression, key: string): boolean {
  if (!ts.isObjectLiteralExpression(value)) {
    return false;
  }
  return value.properties.every((property) => {
    if (ts.isSpreadAssignment(property)) {
      return false;
    }
    const name = memberName(property);
    return name !== undefined && name !== key;
  });
}

/** The initializer of a same-file `const` with exactly one declaration; "cycle" when the binding was already followed. */
function constInitializer(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  seen: Set<ts.Symbol>,
): ts.Expression | "cycle" | undefined {
  const symbol = ts.isShorthandPropertyAssignment(identifier.parent)
    ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
    : checker.getSymbolAtLocation(identifier);
  if (symbol === undefined) {
    return undefined;
  }
  if (seen.has(symbol)) {
    return "cycle";
  }
  seen.add(symbol);
  const declarations = symbol.declarations ?? [];
  const declaration = declarations.length === 1 ? declarations[0] : undefined;
  if (
    declaration === undefined
    || !ts.isVariableDeclaration(declaration)
    || declaration.initializer === undefined
    || declaration.getSourceFile() !== sourceFile
    || (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) === 0
  ) {
    return undefined;
  }
  return declaration.initializer;
}

export function resolveCallChain(call: ts.CallExpression, checker: ts.TypeChecker): CallChain | undefined {
  const chain = resolveCalleeName(call.expression, checker, new Set());
  if (chain === undefined) {
    return undefined;
  }
  // Raw descent, no unwrapping: `(db as any).policy.findMany` must expose the `any` receiver.
  let innermost: ts.Expression = call.expression;
  while (ts.isPropertyAccessExpression(innermost) || ts.isElementAccessExpression(innermost)) {
    innermost = innermost.expression;
  }
  return { chain, unsafeReceiver: containsUnsafeType(checker.getTypeAtLocation(innermost)) };
}

/** `*` spans dots because a chain has no `/`. */
export function chainMatches(chain: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(chain, glob));
}

/**
 * Unresolved-callee heuristic: the first glob whose first segment is `*` or the callee's root
 * identifier and whose last segment is `*` or the accessed name. Both ends must agree.
 */
export function couldMatchCallee(call: ts.CallExpression, globs: readonly string[]): string | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return undefined;
  }
  const root = expressionRootName(call.expression);
  const last = call.expression.name.text;
  return globs.find((glob) => {
    const segments = glob.split(".");
    const first = segments[0];
    const end = segments.at(-1);
    return (first === "*" || (root !== undefined && first === root)) && (end === "*" || end === last);
  });
}
