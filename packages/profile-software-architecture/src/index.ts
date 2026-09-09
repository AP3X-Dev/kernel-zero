import type { Profile } from "@kernel-zero/contracts";

import { findingCompatibilityReason } from "./compatibility";
import { diffPolicyRules } from "./diff";
import { RepositoryEvidenceSchema, repositoryEvidenceJsonSchema, type RepositoryEvidence } from "./evidence";
import { RepositoryPolicySchema, repositoryPolicyJsonSchema, type RepositoryPolicy } from "./policy";

export * from "./compatibility";
export * from "./diff";
export * from "./evidence";
export * from "./layers";
export * from "./policy";

export const softwareArchitectureProfile: Profile<RepositoryPolicy, RepositoryEvidence> = Object.freeze({
  policyKind: "RepositoryPolicy",
  evidenceKind: "RepositoryEvidence",
  toolName: "kernel-zero-validator",
  policySchema: RepositoryPolicySchema,
  evidenceSchema: RepositoryEvidenceSchema,
  findingCompatibilityReason,
  diffRules: diffPolicyRules,
  policyJsonSchema: repositoryPolicyJsonSchema,
  evidenceJsonSchema: repositoryEvidenceJsonSchema,
});
