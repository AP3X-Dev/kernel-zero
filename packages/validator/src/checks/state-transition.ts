import ts from "typescript";

import { walk } from "../ast";
import { forEachMatchingSource, matchesGlob, nodeLocation, rawFinding, type CheckEvaluator, type RawFindingMessageCode } from "../findings";
import { chainMatches, couldMatchCallee, proveObjectPath, resolveCallChain } from "./argument-shape";

/**
 * Every call in scope whose callee matches is inspected; a call whose argument provably
 * writes `field` must come from `allowFrom`, and when `transitions` are listed its literal
 * `field` value paired with the literal predicate value (`field` with `where` as its first
 * segment) must be one of them. Anything not provable is a proof failure, never a pass.
 */
export const evaluateStateTransitions: CheckEvaluator<"restrict-state-transition"> = (rule, repository, failedPaths, findings) => {
  const checker = repository.program.getTypeChecker();
  const { allowFrom, argument, callee, field, transitions } = rule.check;
  const fieldPath = field.split(".");
  const predicatePath = ["where", ...fieldPath.slice(1)];
  const subjectFor = (target: string): string => `transition:${fieldPath.at(-1) ?? field}:${target}`;
  forEachMatchingSource(repository, ["**/*"], failedPaths, (filePath, sourceFile) => {
    const allowedWriter = allowFrom.some((glob) => matchesGlob(filePath, glob));
    walk(sourceFile, (node) => {
      if (!ts.isCallExpression(node)) {
        return;
      }
      const push = (code: RawFindingMessageCode, subject: string): void => {
        findings.push(rawFinding(rule, code, subject, filePath, nodeLocation(sourceFile, node)));
      };
      const resolved = resolveCallChain(node, checker);
      if (resolved === undefined) {
        const glob = rule.level === "error" ? couldMatchCallee(node, callee) : undefined;
        if (glob !== undefined) {
          push("STATE_TRANSITION_UNPROVABLE", subjectFor(glob));
        }
        return;
      }
      if (!chainMatches(resolved.chain, callee)) {
        return;
      }
      const chainSubject = subjectFor(resolved.chain);
      if (resolved.unsafeReceiver) {
        push("STATE_TRANSITION_UNPROVABLE", chainSubject);
        return;
      }
      const target = node.arguments[argument];
      const write = proveObjectPath(target, fieldPath, checker, sourceFile);
      if (write.kind === "missing") {
        return;
      }
      if (write.kind === "unprovable") {
        push("STATE_TRANSITION_UNPROVABLE", chainSubject);
        return;
      }
      if (!allowedWriter) {
        push("STATE_TRANSITION_DENIED_WRITER", chainSubject);
        return;
      }
      if (transitions.length === 0) {
        return;
      }
      const to = write.literal;
      const from = proveObjectPath(target, predicatePath, checker, sourceFile);
      if (to === undefined || from.kind !== "present" || from.literal === undefined) {
        push("STATE_TRANSITION_UNPROVABLE", chainSubject);
        return;
      }
      const fromLiteral = from.literal;
      if (!transitions.some((transition) => (transition.from === "*" || transition.from === fromLiteral) && transition.to === to)) {
        push("STATE_TRANSITION_DENIED_PAIR", subjectFor(`${fromLiteral}->${to}`));
      }
    });
  });
};
