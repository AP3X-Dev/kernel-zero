import { asObjectLiteral, findExportedInitializer, isProofBlockingProperty, objectLiteralKeys } from "../ast";
import { forEachMatchingSource, nodeLocation, rawFinding, type CheckEvaluator, type RawFindingMessageCode } from "../findings";

export const evaluateExportKeys: CheckEvaluator<"require-export-keys"> = (rule, repository, failedPaths, findings) => {
  const checker = repository.program.getTypeChecker();
  forEachMatchingSource(repository, rule.check.files, failedPaths, (filePath, sourceFile) => {
    const exported = findExportedInitializer(sourceFile, checker, rule.check.exportName);
    const object = exported === undefined ? undefined : asObjectLiteral(exported.initializer);
    const keys = object === undefined ? new Set<string>() : objectLiteralKeys(object);
    const proofBlocked = object?.properties.some(isProofBlockingProperty) ?? false;
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
};
