import "server-only";

import { isSha256Digest } from "@kernel-zero/domain";
import {
  storeEvidenceRun,
  type PersistenceClient,
} from "@kernel-zero/persistence";

import type { EvidenceRepository } from "./repository";

export function createEvidenceRepository(client: PersistenceClient): EvidenceRepository {
  const repository: EvidenceRepository = {
    async findActiveSigningKey(input) {
      const key = await client.signingKey.findFirst({
        select: { publicKey: true },
        where: { active: true, keyId: input.keyId, workspaceId: input.workspaceId },
      });
      return key?.publicKey ?? null;
    },
    async findCurrentExceptions(input) {
      return client.exceptionRequest.findMany({
        orderBy: { id: "asc" },
        select: {
          decidedAt: true,
          decisionState: true,
          findingFingerprint: true,
          id: true,
          policyDigest: true,
          revokedAt: true,
          ruleId: true,
          validUntil: true,
          workspaceId: true,
        },
        where: { id: { in: [...input.exceptionIds] }, workspaceId: input.workspaceId },
      });
    },
    async resolveApprovedPolicy(input) {
      const revision = await client.policyRevision.findFirst({
        select: { canonicalJson: true, digest: true, state: true },
        where: {
          digest: input.digest,
          state: { in: ["approved", "active"] },
          workspaceId: input.workspaceId,
        },
      });
      if (revision === null || !isSha256Digest(revision.digest) || (revision.state !== "approved" && revision.state !== "active")) return null;
      return {
        digest: revision.digest,
        document: JSON.parse(revision.canonicalJson) as unknown,
        state: revision.state,
      };
    },
    async saveEvidence(input) {
      try {
        const result = await storeEvidenceRun(client, {
          attestationState: input.attestationState,
          correlationId: input.correlationId,
          document: input.evidence,
          submitterId: input.submitterId,
          workspaceId: input.workspaceId,
        });
        return { kind: result.created ? "created" : "duplicate" };
      } catch (error) {
        if (error instanceof Error && error.message === "CONFLICT:run_digest") return { kind: "conflict" };
        throw error;
      }
    },
  };
  return Object.freeze(repository);
}
