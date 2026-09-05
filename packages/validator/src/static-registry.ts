import ts from "typescript";

import {
  asObjectLiteral,
  findExportedInitializer,
  isProofBlockingProperty,
  literalText,
  objectLiteralKeys,
  propertyChainName,
  propertyInitializer,
  propertyName,
  unwrapExpression,
  walk,
} from "./ast";

/**
 * Shared static prover for closed registries: one exported object literal whose
 * entries may be declared through configured calls, plus every configured
 * declaration call in the file. Adapters map this analysis onto their own
 * public codes; this module never emits findings.
 */
export interface RegistryEntry {
  readonly id: string;
  readonly property: ts.ObjectLiteralElementLike;
  /** The configured declaration call used as the entry value, when there is one. */
  readonly declarationCall: ts.CallExpression | undefined;
  /** Literal first argument of the declaration call; undefined when absent or not a literal. */
  readonly declaredId: string | undefined;
  /** The metadata object: the call's second argument when declared, otherwise the entry value. */
  readonly metadata: ts.ObjectLiteralExpression | undefined;
  readonly metadataKeys: ReadonlySet<string>;
  /** True when a spread or computed key makes the metadata keys unprovable. */
  readonly metadataProofBlocked: boolean;
}

export interface RegistryAnalysis {
  /** Undefined when the export is missing or is not a direct or frozen object literal. */
  readonly registry: ts.ObjectLiteralExpression | undefined;
  readonly locationNode: ts.Node;
  /** Spread or computed-key properties, in source order. */
  readonly dynamicProperties: readonly ts.ObjectLiteralElementLike[];
  /** Named entries in source order. */
  readonly entries: readonly RegistryEntry[];
  readonly entryIds: ReadonlySet<string>;
}

export interface DeclarationCall {
  readonly node: ts.CallExpression;
  /** Literal first argument; undefined when the identifier is not a literal. */
  readonly id: string | undefined;
}

export function analyzeStaticRegistry(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  registryExport: string,
  declarationCalls: readonly string[],
): RegistryAnalysis {
  const exported = findExportedInitializer(sourceFile, checker, registryExport);
  const registry = exported === undefined ? undefined : asObjectLiteral(exported.initializer);
  const locationNode = exported?.locationNode ?? sourceFile;
  const dynamicProperties: ts.ObjectLiteralElementLike[] = [];
  const entries: RegistryEntry[] = [];
  const entryIds = new Set<string>();

  for (const property of registry?.properties ?? []) {
    if (isProofBlockingProperty(property)) {
      dynamicProperties.push(property);
      continue;
    }
    const id = propertyName(property.name);
    if (id === undefined) {
      continue;
    }
    entryIds.add(id);
    const value = propertyInitializer(property);
    const declarationCall = value === undefined ? undefined : asConfiguredDeclarationCall(value, declarationCalls);
    const metadataExpression = declarationCall?.arguments[1] ?? value;
    const metadata = metadataExpression === undefined ? undefined : asObjectLiteral(metadataExpression);
    entries.push({
      id,
      property,
      declarationCall,
      declaredId: declarationCall === undefined ? undefined : literalText(declarationCall.arguments[0]),
      metadata,
      metadataKeys: metadata === undefined ? new Set() : objectLiteralKeys(metadata),
      metadataProofBlocked: metadata?.properties.some(isProofBlockingProperty) ?? false,
    });
  }

  return { registry, locationNode, dynamicProperties, entries, entryIds };
}

export function collectDeclarationCalls(sourceFile: ts.SourceFile, declarationCalls: readonly string[]): readonly DeclarationCall[] {
  const calls: DeclarationCall[] = [];
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) {
      return;
    }
    const callee = propertyChainName(node.expression);
    if (callee === undefined || !declarationCalls.includes(callee)) {
      return;
    }
    calls.push({ node, id: literalText(node.arguments[0]) });
  });
  return calls;
}

function asConfiguredDeclarationCall(expression: ts.Expression, declarationCalls: readonly string[]): ts.CallExpression | undefined {
  const value = unwrapExpression(expression);
  if (!ts.isCallExpression(value)) {
    return undefined;
  }
  const callee = propertyChainName(value.expression);
  return callee !== undefined && declarationCalls.includes(callee) ? value : undefined;
}
