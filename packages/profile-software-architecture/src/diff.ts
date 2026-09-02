import type { PolicyRuleDiff } from "@kernel-zero/contracts";
import { diffRulesById } from "@kernel-zero/contracts";

import type { RepositoryPolicy } from "./policy";

export function diffPolicyRules(before: RepositoryPolicy, after: RepositoryPolicy): readonly PolicyRuleDiff[] {
  return diffRulesById(before, after);
}
