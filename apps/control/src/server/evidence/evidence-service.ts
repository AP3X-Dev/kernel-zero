import "server-only";

import { RepositoryEvidenceSchema, RepositoryPolicySchema, type RepositoryEvidence } from "@kernel-zero/contracts";

import { requireCapability, type WorkspaceAuthoritySource } from "../authorization/workspace";
import { verifyEvidenceAttestation } from "./attestation";
import { EvidenceIngressError, invalidEvidence } from "./errors";
import type { EvidenceRepository } from "./repository";
import { findingCompatibilityReason } from "./rule-compatibility";

const MAXIMUM_FUTURE_SKEW_MS = 15 * 60 * 1_000;

export type EvidenceActor = WorkspaceAuthoritySource & Readonly<{ userId: string }>;

export type EvidenceSubmissionResult = Readonly<{
  attestationState: "attested" | "recorded";
  kind: "created" | "duplicate";
  runId: string;
}>;

export class EvidenceService {
  readonly #repository: EvidenceRepository;

  constructor(repository: EvidenceRepository) {
    this.#repository = repository;
  }

  async submit(input: Readonly<{
    actor: EvidenceActor;
    correlationId: string;
    document: unknown;
    workspaceId: string;
  }>, now = new Date()): Promise<EvidenceSubmissionResult> {
    const denied = requireCapability(input.actor, "evidence.submit");
    if (denied !== null) throw new EvidenceIngressError(403, denied.code, "capability_denied");

    const parsed = RepositoryEvidenceSchema.safeParse(input.document);
    if (!parsed.success) throw invalidEvidence("contract");
    const evidence: RepositoryEvidence = parsed.data;
    if (evidence.workspace !== input.workspaceId) throw invalidEvidence("workspace_mismatch");
    const generatedAt = new Date(evidence.generatedAt);
    if (generatedAt.getTime() > now.getTime() + MAXIMUM_FUTURE_SKEW_MS) throw invalidEvidence("generated_at_future");

    const resolved = await this.#repository.resolveApprovedPolicy({ digest: evidence.policy.digest, workspaceId: input.workspaceId });
    if (resolved === null) throw invalidEvidence("approved_policy_not_found");
    const policyResult = RepositoryPolicySchema.safeParse(resolved.document);
    if (!policyResult.success) throw invalidEvidence("resolved_policy_invalid");
    const policy = policyResult.data;
    if (resolved.digest !== evidence.policy.digest || policy.metadata.name !== evidence.policy.name || policy.metadata.revision !== evidence.policy.revision) {
      throw invalidEvidence("policy_identity_mismatch");
    }

    for (const finding of evidence.findings) {
      const reason = findingCompatibilityReason(policy, finding);
      if (reason !== null) throw invalidEvidence(reason);
    }
    await validateExceptionApplications(this.#repository, evidence, generatedAt);
    const attestationState = await verifyEvidenceAttestation(this.#repository, evidence);
    const saved = await this.#repository.saveEvidence({
      attestationState,
      correlationId: input.correlationId,
      evidence,
      submitterId: input.actor.userId,
      workspaceId: input.workspaceId,
    });
    if (saved.kind === "conflict") throw new EvidenceIngressError(409, "CONFLICT", "run_id_digest_conflict");
    return Object.freeze({ attestationState, kind: saved.kind, runId: evidence.runId });
  }
}

async function validateExceptionApplications(repository: EvidenceRepository, evidence: RepositoryEvidence, generatedAt: Date): Promise<void> {
  const applications = evidence.findings.filter((finding): finding is typeof finding & { exceptionId: string } => finding.exceptionId !== null);
  if (applications.length === 0) return;
  if (evidence.exceptionBundleDigest === null) throw invalidEvidence("exception_bundle_digest_missing");
  const ids = [...new Set(applications.map((finding) => finding.exceptionId))].sort();
  const grants = await repository.findCurrentExceptions({ exceptionIds: ids, workspaceId: evidence.workspace });
  const byId = new Map(grants.map((grant) => [grant.id, grant]));
  for (const finding of applications) {
    const grant = byId.get(finding.exceptionId);
    if (
      grant?.workspaceId !== evidence.workspace
      || grant.decisionState !== "approved"
      || grant.decidedAt === null
      || grant.decidedAt.getTime() > generatedAt.getTime()
      || grant.revokedAt !== null
      || grant.validUntil.getTime() <= generatedAt.getTime()
      || grant.policyDigest !== evidence.policy.digest
      || grant.ruleId !== finding.ruleId
      || grant.findingFingerprint !== finding.fingerprint
    ) throw invalidEvidence("exception_invalid");
  }
}
