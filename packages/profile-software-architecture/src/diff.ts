import type { PolicyRuleDiff } from "@kernel-zero/contracts";
import { canonicalJson } from "@kernel-zero/domain";

import type { RepositoryPolicy } from "./policy";

// ponytail: duplicated in profile-manifest/src/index.ts; lift to contracts as diffRulesById when a third profile needs it
export function diffPolicyRules(before: RepositoryPolicy, after: RepositoryPolicy): readonly PolicyRuleDiff[] {
  const left = new Map(before.rules.map((rule) => [rule.id, rule]));
  const right = new Map(after.rules.map((rule) => [rule.id, rule]));
  const result: PolicyRuleDiff[] = [];
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const beforeRule = left.get(id) ?? null;
    const afterRule = right.get(id) ?? null;
    if (beforeRule === null) result.push(Object.freeze({ after: afterRule, before: null, id, status: "added" }));
    else if (afterRule === null) result.push(Object.freeze({ after: null, before: beforeRule, id, status: "removed" }));
    else if (canonicalJson(beforeRule) !== canonicalJson(afterRule)) result.push(Object.freeze({ after: afterRule, before: beforeRule, id, status: "changed" }));
  }
  return Object.freeze(result);
}
