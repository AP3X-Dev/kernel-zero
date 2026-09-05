import "server-only";

import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

import { appError } from "@kernel-zero/domain";
import type { PolicyAuthoritySigner } from "@kernel-zero/persistence";

export type EphemeralPolicyAuthority = Readonly<{
  publicKeyX: string;
  signer: PolicyAuthoritySigner;
}>;

/**
 * Fixture composition only: a fresh in-memory Ed25519 pair whose private half lives in this
 * process and is never persisted or exported. Register `publicKeyX` as the workspace authority
 * key, then pass `signer` to approve-with-custody.
 */
export function createEphemeralPolicyAuthority(keyId: string): EphemeralPolicyAuthority {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  if (jwk.x === undefined) throw new TypeError("Ed25519 public key export produced no coordinate.");
  return Object.freeze({ publicKeyX: jwk.x, signer: localSigner(keyId, privateKey) });
}

/**
 * Production composition is deliberately unavailable: no remote signer, no environment-loaded
 * private key. Activating a real workspace authority is a separate human decision (ADR, FR-CUS-008).
 */
export function productionPolicyAuthoritySigner(keyId: string): PolicyAuthoritySigner {
  return Object.freeze({
    keyId,
    sign: () => Promise.reject(new PolicySignerUnavailableError()),
  });
}

export class PolicySignerUnavailableError extends Error {
  readonly code = "FEATURE_UNAVAILABLE" as const;
  readonly retryable = false;

  constructor() {
    super(appError("FEATURE_UNAVAILABLE").message);
    this.name = "PolicySignerUnavailableError";
  }
}

function localSigner(keyId: string, privateKey: KeyObject): PolicyAuthoritySigner {
  return Object.freeze({
    keyId,
    sign: (digest: Uint8Array) => Promise.resolve(new Uint8Array(sign(null, digest, privateKey))),
  });
}
