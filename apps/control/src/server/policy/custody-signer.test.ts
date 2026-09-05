import { createPublicKey, verify } from "node:crypto";

import { describe, expect, it } from "vitest";

import { PolicySignerUnavailableError, createEphemeralPolicyAuthority, productionPolicyAuthoritySigner } from "./custody-signer";

describe("policy authority signer composition", () => {
  it("produces an ephemeral signer whose signatures verify against its public coordinate and nothing else", async () => {
    const authority = createEphemeralPolicyAuthority("authority-1");
    const digest = new Uint8Array(32).fill(7);
    const signature = await authority.signer.sign(digest);
    const publicKey = createPublicKey({ format: "jwk", key: { crv: "Ed25519", kty: "OKP", x: authority.publicKeyX } });
    expect(verify(null, digest, publicKey, signature)).toBe(true);
    expect(verify(null, new Uint8Array(32).fill(8), publicKey, signature)).toBe(false);
    expect(authority.signer.keyId).toBe("authority-1");
    expect(Object.keys(authority)).toEqual(["publicKeyX", "signer"]);
    expect(Object.keys(authority.signer)).toEqual(["keyId", "sign"]);
  });

  it("fails production composition explicitly as unavailable", async () => {
    const signer = productionPolicyAuthoritySigner("authority-1");
    await expect(signer.sign(new Uint8Array(32))).rejects.toBeInstanceOf(PolicySignerUnavailableError);
    await expect(signer.sign(new Uint8Array(32))).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE", retryable: false });
  });
});
