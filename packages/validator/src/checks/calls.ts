import ts from "typescript";

import { expressionRootName, resolveCalleeName, walk } from "../ast";
import { forEachMatchingSource, matchesGlob, nodeLocation, rawFinding, type CheckEvaluator } from "../findings";

export const evaluateRestrictedCalls: CheckEvaluator<"restrict-call-site"> = (rule, repository, failedPaths, findings) => {
  const checker = repository.program.getTypeChecker();
  forEachMatchingSource(repository, ["**/*"], failedPaths, (filePath, sourceFile) => {
    if (rule.check.allowFrom.some((glob) => matchesGlob(filePath, glob))) {
      return;
    }
    walk(sourceFile, (node) => {
      if (!ts.isCallExpression(node)) {
        return;
      }
      const callee = resolveCalleeName(node.expression, checker, new Set());
      if (callee !== undefined && rule.check.callee.includes(callee)) {
        findings.push(rawFinding(rule, "RESTRICTED_CALL_SITE", callee, filePath, nodeLocation(sourceFile, node.expression)));
        return;
      }
      if (callee === undefined && rule.check.requireResolution && rule.level === "error") {
        const root = expressionRootName(node.expression);
        const possible = root === undefined ? undefined : rule.check.callee.find((restricted) => restricted.startsWith(`${root}.`));
        if (possible !== undefined) {
          findings.push(rawFinding(rule, "CALL_RESOLUTION_FAILED", possible, filePath, nodeLocation(sourceFile, node.expression)));
        }
      }
    });
  });
};
