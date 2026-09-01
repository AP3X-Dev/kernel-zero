import "server-only";

import { createPublicKey, verify } from "node:crypto";

import type { RepositoryEvidence } from "@kernel-zero/contracts";

import { invalidEvidence } from "./errors";
import type { EvidenceAttestationState, EvidenceRepository } from "./repository";

export async function verifyEvidenceAttestation(
  repository: EvidenceRepository,
  evidence: RepositoryEvidence,
): Promise<EvidenceAttestationState> {
  if (evidence.signature === null) return "recorded";
  const publicKey = await repository.findActiveSigningKey({ keyId: evidence.signature.keyId, workspaceId: evidence.workspace });
  if (publicKey === null) throw invalidEvidence("signing_key_inactive");
  try {
    const key = createPublicKey(publicKey);
    if (key.asymmetricKeyType !== "ed25519") throw new TypeError("Signing key is not Ed25519.");
    const digestBytes = Buffer.from(evidence.integrity.digest.slice("sha256:".length), "hex");
    const signatureBytes = Buffer.from(evidence.signature.value, "base64");
    if (!verify(null, digestBytes, key, signatureBytes)) throw invalidEvidence("signature_invalid");
  } catch (error) {
    if (error instanceof Error && error.name === "EvidenceIngressError") throw error;
    throw invalidEvidence("signature_invalid");
  }
  return "attested";
}
