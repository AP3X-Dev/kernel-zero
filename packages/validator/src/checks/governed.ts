import { forEachMatchingSource, nodeLocation, rawFinding, type CheckEvaluator } from "../findings";
import { analyzeStaticRegistry, collectDeclarationCalls } from "../static-registry";

// Adapter over the shared static-registry prover. Its raw codes, subjects, and
// accepted syntax are frozen by the golden baseline and must not drift.
export const evaluateGovernedOperations: CheckEvaluator<"require-governed-operation"> = (rule, repository, failedPaths, findings) => {
  const checker = repository.program.getTypeChecker();
  forEachMatchingSource(repository, rule.check.files, failedPaths, (filePath, sourceFile) => {
    const analysis = analyzeStaticRegistry(sourceFile, checker, rule.check.registryExport, rule.check.declarationCalls);

    if (analysis.registry === undefined) {
      findings.push(rawFinding(rule, "GOVERNED_REGISTRY_PROOF_FAILED", "action:<registry>:registry", filePath, nodeLocation(sourceFile, analysis.locationNode)));
    }
    for (const property of analysis.dynamicProperties) {
      findings.push(rawFinding(rule, "GOVERNED_REGISTRY_PROOF_FAILED", "action:<dynamic>:registry", filePath, nodeLocation(sourceFile, property)));
    }
    for (const entry of analysis.entries) {
      const location = nodeLocation(sourceFile, entry.property);
      if (entry.declarationCall !== undefined && entry.declaredId !== entry.id) {
        findings.push(rawFinding(rule, "INVALID_GOVERNED_KEY", `action:${entry.id}:actionId`, filePath, location));
      }
      for (const requiredKey of rule.check.requiredKeys) {
        if (entry.metadataKeys.has(requiredKey)) {
          continue;
        }
        findings.push(rawFinding(
          rule,
          entry.metadataProofBlocked || entry.metadata === undefined ? "INVALID_GOVERNED_KEY" : "MISSING_GOVERNED_KEY",
          `action:${entry.id}:${requiredKey}`,
          filePath,
          location,
        ));
      }
    }

    for (const call of collectDeclarationCalls(sourceFile, rule.check.declarationCalls)) {
      const location = nodeLocation(sourceFile, call.node);
      if (call.id === undefined) {
        findings.push(rawFinding(rule, "GOVERNED_DECLARATION_PROOF_FAILED", "action:<dynamic>:actionId", filePath, location));
      } else if (!analysis.entryIds.has(call.id)) {
        findings.push(rawFinding(rule, "UNKNOWN_GOVERNED_ACTION", `action:${call.id}:registry`, filePath, location));
      }
    }
  });
};
