import ts from "typescript";

import { walk } from "../ast";
import { forEachMatchingSource, matchesGlob, nodeLocation, rawFinding, type CheckEvaluator, type RawFindingMessageCode } from "../findings";
import { chainMatches, couldMatchCallee, proveObjectPath, resolveCallChain, type PathProof } from "./argument-shape";

export const evaluateCallArguments: CheckEvaluator<"require-call-argument"> = (rule, repository, failedPaths, findings) => {
  const checker = repository.program.getTypeChecker();
  const { allowFrom, argument, callee, requiredPath } = rule.check;
  const path = requiredPath.split(".");
  const subjectFor = (chain: string): string => `call:${chain}:argument:${String(argument)}:${requiredPath}`;
  forEachMatchingSource(repository, rule.check.files, failedPaths, (filePath, sourceFile) => {
    if (allowFrom.some((glob) => matchesGlob(filePath, glob))) {
      return;
    }
    walk(sourceFile, (node) => {
      if (!ts.isCallExpression(node)) {
        return;
      }
      const resolved = resolveCallChain(node, checker);
      if (resolved === undefined) {
        const glob = rule.level === "error" ? couldMatchCallee(node, callee) : undefined;
        if (glob !== undefined) {
          findings.push(rawFinding(rule, "CALL_ARGUMENT_UNRESOLVED", subjectFor(glob), filePath, nodeLocation(sourceFile, node)));
        }
        return;
      }
      if (!chainMatches(resolved.chain, callee)) {
        return;
      }
      const code = resolved.unsafeReceiver
        ? "CALL_ARGUMENT_UNPROVABLE"
        : proofCode(proveObjectPath(node.arguments[argument], path, checker, sourceFile));
      if (code !== undefined) {
        findings.push(rawFinding(rule, code, subjectFor(resolved.chain), filePath, nodeLocation(sourceFile, node)));
      }
    });
  });
};

function proofCode(proof: PathProof): RawFindingMessageCode | undefined {
  switch (proof.kind) {
    case "present": return undefined;
    case "missing": return "CALL_ARGUMENT_MISSING";
    case "unprovable": return "CALL_ARGUMENT_UNPROVABLE";
  }
}
