import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import { digestBytes } from "@kernel-zero/domain";

import {
  ExceptionGrantSetSchema,
  createSignedExceptionGrantSet,
  verifyExceptionGrantSet,
} from "./exceptions";

const WORKSPACE = "0195f000-0000-7000-8000-000000000002";
const POLICY_DIGEST = `sha256:${"1".repeat(64)}` as const;

describe("ExceptionGrantSet v1", () => {
  it("creates a sorted, private-data-free, deterministic Ed25519 bundle", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const bundle = createSignedExceptionGrantSet({
      expiresAt: new Date("2026-01-16T12:00:00.000Z"),
      generatedAt: new Date("2026-01-15T12:00:00.000Z"),
      grants: [
        { exceptionId: "0195f000-0000-7000-8000-000000000004", ruleId: "rule-b", fingerprint: `sha256:${"3".repeat(64)}`, validUntil: new Date("2026-01-17T10:00:00.000Z") },
        { exceptionId: "0195f000-0000-7000-8000-000000000003", ruleId: "rule-a", fingerprint: `sha256:${"2".repeat(64)}`, validUntil: new Date("2026-01-17T11:00:00.000Z") },
      ],
      keyId: "workspace-key-1",
      policyDigest: POLICY_DIGEST,
      privateKey,
      workspace: WORKSPACE,
    });
    expect(bundle.grants.map((grant) => grant.exceptionId)).toEqual([
      "0195f000-0000-7000-8000-000000000003",
      "0195f000-0000-7000-8000-000000000004",
    ]);
    expect(JSON.stringify(bundle)).not.toMatch(/rationale|email|displayName|issueUrl/u);
    expect(verifyExceptionGrantSet(bundle, publicKey, {
      now: new Date("2026-01-15T13:00:00.000Z"), policyDigest: POLICY_DIGEST, workspace: WORKSPACE,
    })).toEqual({ ok: true });
    expect(sign(null, digestBytes(bundle.integrity.digest), privateKey).toString("base64")).toBe(bundle.signature.value);
  });

  it("rejects unknown fields, duplicate grants, excessive lifetime, and grant extension", () => {
    const base = {
      apiVersion: "kernel-zero.dev/exceptions/v1", kind: "ExceptionGrantSet",
      workspace: WORKSPACE, policyDigest: POLICY_DIGEST,
      generatedAt: "2026-01-15T12:00:00.000Z", expiresAt: "2026-01-16T12:00:00.000Z",
      grants: [{ exceptionId: "0195f000-0000-7000-8000-000000000003", ruleId: "rule-a", fingerprint: `sha256:${"2".repeat(64)}`, validUntil: "2026-01-16T12:00:00.000Z" }],
      integrity: { algorithm: "sha256", digest: `sha256:${"5".repeat(64)}` },
      signature: { algorithm: "ed25519", keyId: "key", value: Buffer.alloc(64).toString("base64") },
    } as const;
    expect(ExceptionGrantSetSchema.safeParse({ ...base, rationale: "private" }).success).toBe(false);
    expect(ExceptionGrantSetSchema.safeParse({ ...base, grants: [base.grants[0], base.grants[0]] }).success).toBe(false);
    expect(ExceptionGrantSetSchema.safeParse({ ...base, expiresAt: "2026-01-16T12:00:00.001Z" }).success).toBe(false);
    expect(ExceptionGrantSetSchema.safeParse({
      ...base,
      expiresAt: "2026-01-16T11:00:00.000Z",
      grants: [{ ...base.grants[0], validUntil: "2026-01-16T10:00:00.000Z" }],
    }).success).toBe(false);
  });
});
