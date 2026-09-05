import ts from "typescript";

import { forEachMatchingSource, nodeLocation, rawFinding, type CheckEvaluator, type RawFindingLocation } from "../findings";
import { analyzeStaticRegistry, collectDeclarationCalls } from "../static-registry";

const REGISTRY_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/u;
const INVALID = "<invalid>";

// Generic adapter over the shared static-registry prover. Unlike the governed
// check, entries must themselves be direct or frozen object literals, IDs are
// validated, and declarations are collected across every configured file.
export const evaluateClosedRegistry: CheckEvaluator<"require-closed-registry"> = (rule, repository, failedPaths, findings) => {
  const { registryExport, registryFile } = rule.check;
  const subject = (family: "entry" | "declaration" | "proof", id: string, key?: string): string =>
    `registry:${registryExport}:${family}:${renderId(id)}${key === undefined ? "" : `:${key}`}`;
  const checker = repository.program.getTypeChecker();
  const registrySource = failedPaths.has(registryFile) ? undefined : repository.sourceFiles.get(registryFile);
  const entryIds = new Set<string>();
  // Only the calls that analyzeStaticRegistry accepted as entry values are exempt from declaration checks.
  const entryCalls = new Set<ts.CallExpression>();

  if (registrySource === undefined) {
    if (!failedPaths.has(registryFile)) {
      findings.push(rawFinding(rule, "CLOSED_REGISTRY_PROOF_FAILED", subject("proof", "registry"), registryFile, undefined));
    }
  } else {
    const analysis = analyzeStaticRegistry(registrySource, checker, registryExport, rule.check.declarationCalls);
    const at = (node: ts.Node): RawFindingLocation => nodeLocation(registrySource, node);
    if (analysis.registry === undefined) {
      findings.push(rawFinding(rule, "CLOSED_REGISTRY_PROOF_FAILED", subject("proof", "registry"), registryFile, at(analysis.locationNode)));
    }
    for (const property of analysis.dynamicProperties) {
      findings.push(rawFinding(rule, "CLOSED_REGISTRY_PROOF_FAILED", subject("proof", "registry"), registryFile, at(property)));
    }
    const seen = new Set<string>();
    for (const entry of analysis.entries) {
      if (entry.declarationCall !== undefined) entryCalls.add(entry.declarationCall);
      if (!REGISTRY_ID.test(entry.id)) {
        findings.push(rawFinding(rule, "CLOSED_REGISTRY_ENTRY_INVALID", subject("entry", INVALID, "id"), registryFile, at(entry.property)));
        continue;
      }
      if (seen.has(entry.id)) {
        findings.push(rawFinding(rule, "CLOSED_REGISTRY_ENTRY_INVALID", subject("entry", entry.id, "id"), registryFile, at(entry.property)));
        continue;
      }
      seen.add(entry.id);
      entryIds.add(entry.id);
      if (entry.declarationCall !== undefined && entry.declaredId !== entry.id) {
        findings.push(rawFinding(rule, "CLOSED_REGISTRY_ENTRY_INVALID", subject("entry", entry.id, "id"), registryFile, at(entry.property)));
      }
      if (entry.metadata === undefined || entry.metadataProofBlocked || !isDirectDataObject(entry.metadata)) {
        findings.push(rawFinding(rule, "CLOSED_REGISTRY_PROOF_FAILED", subject("proof", entry.id), registryFile, at(entry.property)));
        continue;
      }
      for (const requiredKey of rule.check.requiredKeys) {
        if (!entry.metadataKeys.has(requiredKey)) {
          findings.push(rawFinding(rule, "CLOSED_REGISTRY_ENTRY_INVALID", subject("entry", entry.id, requiredKey), registryFile, at(entry.property)));
        }
      }
    }
  }

  const declared = new Set<string>();
  forEachMatchingSource(repository, rule.check.declarationFiles, failedPaths, (filePath, sourceFile) => {
    for (const call of collectDeclarationCalls(sourceFile, rule.check.declarationCalls)) {
      const location = nodeLocation(sourceFile, call.node);
      if (call.id === undefined) {
        findings.push(rawFinding(rule, "CLOSED_REGISTRY_PROOF_FAILED", subject("proof", "declaration"), filePath, location));
      } else if (!REGISTRY_ID.test(call.id)) {
        findings.push(rawFinding(rule, "UNREGISTERED_DECLARATION", subject("declaration", INVALID), filePath, location));
      } else if (entryCalls.has(call.node)) {
        continue;
      } else if (declared.has(call.id)) {
        findings.push(rawFinding(rule, "CLOSED_REGISTRY_PROOF_FAILED", subject("proof", "declaration"), filePath, location));
      } else {
        declared.add(call.id);
        if (!entryIds.has(call.id)) {
          findings.push(rawFinding(rule, "UNREGISTERED_DECLARATION", subject("declaration", call.id), filePath, location));
        }
      }
    }
  });
};

function renderId(id: string): string {
  return REGISTRY_ID.test(id) || id === "registry" || id === "declaration" || id === INVALID ? id : INVALID;
}

/** Accessors and methods are not data; a closed registry entry must be plain provable metadata. */
function isDirectDataObject(object: ts.ObjectLiteralExpression): boolean {
  return object.properties.every((property) => ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property));
}

