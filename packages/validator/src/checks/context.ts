import ts from "typescript";

import { collectExportedFunctions, containsUnsafeType } from "../ast";
import { forEachMatchingSource, matchesGlob, nodeLocation, rawFinding, type CheckEvaluator, type RawFindingMessageCode, type RuleOf } from "../findings";
import type { RepositoryProgram } from "../program";

type ExpectedType = NonNullable<RuleOf<"require-context-parameter">["check"]["expectedType"]>;

/** Answers whether a candidate type carries the configured identity; undefined means no type obligation. */
type TypeMatcher = (type: ts.Type) => "match" | "mismatch" | "unprovable";

const INTRINSIC_FLAGS: Readonly<Record<Extract<ExpectedType, { kind: "intrinsic" }>["name"], ts.TypeFlags>> = {
  bigint: ts.TypeFlags.BigInt,
  boolean: ts.TypeFlags.Boolean,
  number: ts.TypeFlags.Number,
  string: ts.TypeFlags.String,
};

export const evaluateContextParameters: CheckEvaluator<"require-context-parameter"> = (rule, repository, failedPaths, findings) => {
  const checker = repository.program.getTypeChecker();
  const expected = rule.check.expectedType;
  // A configured type file that failed to parse already carries its PARSE_FAILURE; do not prove from its recovered AST.
  const matcher = expected === null || (expected.kind === "export" && failedPaths.has(expected.file))
    ? undefined
    : createMatcher(expected, repository, checker);
  if (expected?.kind === "export" && matcher === undefined) {
    findings.push(rawFinding(rule, "CONTEXT_TYPE_UNRESOLVED", `type:${expected.file}#${expected.exportName}`, expected.file, undefined));
    return;
  }
  forEachMatchingSource(repository, rule.check.files, failedPaths, (filePath, sourceFile) => {
    for (const candidate of collectExportedFunctions(sourceFile, checker)) {
      const symbolName = candidate.qualifiedName.split(".").at(-1) ?? candidate.qualifiedName;
      if (!matchesGlob(symbolName, rule.check.symbols) && !matchesGlob(candidate.qualifiedName, rule.check.symbols)) {
        continue;
      }
      const code = classifyContextParameter(candidate.node, rule.check.parameter, checker, matcher);
      if (code !== undefined) {
        findings.push(rawFinding(
          rule,
          code,
          `symbol:${candidate.qualifiedName}:parameter:${rule.check.parameter}`,
          filePath,
          nodeLocation(sourceFile, candidate.node.name ?? candidate.node),
        ));
      }
    }
  });
};

function classifyContextParameter(
  node: ts.FunctionLikeDeclaration,
  parameterName: string,
  checker: ts.TypeChecker,
  matcher: TypeMatcher | undefined,
): RawFindingMessageCode | undefined {
  const named = node.parameters.find((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === parameterName);
  if (named !== undefined) {
    if (named.questionToken !== undefined || named.initializer !== undefined || named.dotDotDotToken !== undefined) {
      return "CONTEXT_PARAMETER_UNSAFE";
    }
    return classifyType(checker.getTypeAtLocation(named), matcher);
  }
  const first = node.parameters[0];
  if (first === undefined) {
    return "CONTEXT_PARAMETER_MISSING";
  }
  const inputType = checker.getTypeAtLocation(first);
  if (containsUnsafeType(inputType)) {
    return "CONTEXT_PARAMETER_UNSAFE";
  }
  // getPropertyOfType ignores index signatures, so an index-signature-only match reads as missing.
  const property = checker.getPropertyOfType(inputType, parameterName);
  if (property === undefined) {
    return "CONTEXT_PARAMETER_MISSING";
  }
  if ((property.flags & ts.SymbolFlags.Optional) !== 0) {
    return "CONTEXT_PARAMETER_UNSAFE";
  }
  return classifyType(checker.getTypeOfSymbolAtLocation(property, first), matcher);
}

function classifyType(type: ts.Type, matcher: TypeMatcher | undefined): RawFindingMessageCode | undefined {
  if (containsUnsafeType(type)) {
    return "CONTEXT_PARAMETER_UNSAFE";
  }
  if (matcher === undefined) {
    return undefined;
  }
  switch (matcher(type)) {
    case "match": return undefined;
    case "mismatch": return "CONTEXT_PARAMETER_TYPE_MISMATCH";
    case "unprovable": return "CONTEXT_PARAMETER_UNRESOLVED";
  }
}

function createMatcher(expected: ExpectedType, repository: RepositoryProgram, checker: ts.TypeChecker): TypeMatcher | undefined {
  if (expected.kind === "intrinsic") {
    const flag = INTRINSIC_FLAGS[expected.name];
    // Exact intrinsic only: literal subtypes such as "admin" or 42 are deliberately not accepted.
    return (type) => everyMember(type, (member) => ((member.flags & flag) !== 0 ? "match" : "mismatch"));
  }
  const symbol = resolveExportedTypeSymbol(expected, repository, checker);
  if (symbol === undefined) {
    return undefined;
  }
  const matches = (type: ts.Type): TypeMatcher extends (t: ts.Type) => infer R ? R : never => everyMember(type, (member) => {
    if (member.aliasSymbol === symbol || member.symbol === symbol) {
      return "match";
    }
    // ponytail: only the non-weakening lib mapped types keep identity; Partial/Pick/Omit change the shape and stay mismatches.
    const mappedTarget = member.aliasTypeArguments?.[0];
    if (mappedTarget !== undefined && (member.aliasSymbol?.name === "Readonly" || member.aliasSymbol?.name === "Required")) {
      return matches(mappedTarget);
    }
    if (member.isIntersection()) {
      return member.types.some((part) => matches(part) === "match") ? "match" : "mismatch";
    }
    if (member.isTypeParameter()) {
      const constraint = checker.getBaseConstraintOfType(member);
      return constraint === undefined ? "unprovable" : matches(constraint);
    }
    // Predicate narrowing above would collapse `member` to never; re-widen before the object checks.
    const candidate: ts.Type = member;
    if ((candidate.flags & ts.TypeFlags.Object) !== 0) {
      const objectType = candidate as ts.ObjectType;
      // A generic instantiation carries its declaration's symbol on the reference target.
      const declared: ts.ObjectType = (objectType.objectFlags & ts.ObjectFlags.Reference) !== 0 ? (objectType as ts.TypeReference).target : objectType;
      if (declared.symbol === symbol) {
        return "match";
      }
      if ((declared.objectFlags & ts.ObjectFlags.ClassOrInterface) !== 0) {
        return checker.getBaseTypes(declared as ts.InterfaceType).some((base) => matches(base) === "match") ? "match" : "mismatch";
      }
    }
    return "mismatch";
  });
  return matches;
}

/** Every non-never union member must satisfy; a single unprovable member makes the whole type unprovable. */
function everyMember(type: ts.Type, judge: (member: ts.Type) => ReturnType<TypeMatcher>): ReturnType<TypeMatcher> {
  if ((type.flags & ts.TypeFlags.Boolean) !== 0 || !type.isUnion()) {
    return judge(type);
  }
  let verdict: ReturnType<TypeMatcher> = "match";
  for (const member of type.types) {
    if ((member.flags & ts.TypeFlags.Never) !== 0) {
      continue;
    }
    const result = judge(member);
    if (result === "mismatch") {
      return "mismatch";
    }
    if (result === "unprovable") {
      verdict = "unprovable";
    }
  }
  return verdict;
}

function resolveExportedTypeSymbol(
  expected: Extract<ExpectedType, { kind: "export" }>,
  repository: RepositoryProgram,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const sourceFile = repository.sourceFiles.get(expected.file);
  const moduleSymbol = sourceFile === undefined ? undefined : checker.getSymbolAtLocation(sourceFile);
  const exported = moduleSymbol === undefined
    ? undefined
    : checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === expected.exportName);
  if (exported === undefined) {
    return undefined;
  }
  const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  return (target.flags & ts.SymbolFlags.Type) !== 0 ? target : undefined;
}
