import "server-only";

import type { StoredEvidence } from "@kernel-zero/persistence";

export type EvidenceAttestationState = "attested" | "recorded";

export type ResolvedEvidencePolicy = Readonly<{
  digest: StoredEvidence["policy"]["digest"];
  document: unknown;
  state: "active" | "approved";
}>;

export type CurrentExceptionGrant = Readonly<{
  decidedAt: Date | null;
  decisionState: "approved" | "denied" | "pending";
  findingFingerprint: string;
  id: string;
  policyDigest: string;
  revokedAt: Date | null;
  ruleId: string;
  validUntil: Date;
  workspaceId: string;
}>;

export type EvidenceSaveInput = Readonly<{
  attestationState: EvidenceAttestationState;
  correlationId: string;
  evidence: StoredEvidence;
  submitterId: string;
  workspaceId: string;
}>;

export type EvidenceSaveResult = Readonly<{
  kind: "conflict" | "created" | "duplicate";
}>;

export interface EvidenceRepository {
  findActiveSigningKey(input: Readonly<{ keyId: string; workspaceId: string }>): Promise<string | null>;
  findCurrentExceptions(input: Readonly<{ exceptionIds: readonly string[]; workspaceId: string }>): Promise<readonly CurrentExceptionGrant[]>;
  resolveApprovedPolicy(input: Readonly<{ digest: string; workspaceId: string }>): Promise<ResolvedEvidencePolicy | null>;
  saveEvidence(input: EvidenceSaveInput): Promise<EvidenceSaveResult>;
}
