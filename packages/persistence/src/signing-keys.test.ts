/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { exportExceptionGrantSet, registerSigningKey, revokeSigningKey } from "./signing-keys";

const WORKSPACE = "0195f000-0000-7000-8000-000000000002";
const ACTOR = "0195f000-0000-7000-8000-000000000003";
const CORRELATION = "0195f000-0000-7000-8000-000000000001";
const DIGEST = `sha256:${"1".repeat(64)}`;
function client(tx: object) { return { $transaction: vi.fn(async (operation) => operation(tx)) } as never; }

describe("workspace Ed25519 signing keys and exception export", () => {
  it("registers only normalized Ed25519 public material and never private material", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const create = vi.fn<(input: { data: { publicKey: string } }) => Promise<{ keyId: string }>>().mockResolvedValue({ keyId: "key-1" });
    const tx = { auditRecord: { create: vi.fn() }, signingKey: { create } };
    await expect(registerSigningKey(client(tx), { actorUserId: ACTOR, correlationId: CORRELATION, keyId: "key-1", label: "Local validation", publicKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(), workspaceId: WORKSPACE })).rejects.toThrow("publicKey");
    await registerSigningKey(client(tx), { actorUserId: ACTOR, correlationId: CORRELATION, keyId: "key-1", label: "Local validation", publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(), workspaceId: WORKSPACE });
    const stored = create.mock.calls[0]?.[0].data.publicKey;
    expect(stored).toContain("BEGIN PUBLIC KEY");
    expect(stored).not.toContain("PRIVATE");
  });

  it("revokes idempotently and audits only the state change", async () => {
    const tx = { auditRecord: { create: vi.fn() }, signingKey: { updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }) } };
    const input = { actorUserId: ACTOR, correlationId: CORRELATION, keyId: "key-1", workspaceId: WORKSPACE };
    await expect(revokeSigningKey(client(tx), input)).resolves.toEqual({ revoked: true });
    await expect(revokeSigningKey(client(tx), input)).resolves.toEqual({ revoked: false });
    expect(tx.auditRecord.create).toHaveBeenCalledTimes(1);
  });

  it("exports approved current grants in a verified bundle without personal fields", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const tx = {
      exceptionRequest: { findMany: vi.fn().mockResolvedValue([{ id: "0195f000-0000-7000-8000-000000000004", ruleId: "rule-one", findingFingerprint: `sha256:${"2".repeat(64)}`, validUntil: new Date("2026-09-10T00:00:00Z") }]) },
      signingKey: { findFirst: vi.fn().mockResolvedValue({ publicKey: publicKey.export({ format: "pem", type: "spki" }).toString() }) },
    };
    const bundle = await exportExceptionGrantSet(client(tx), {
      keyId: "key-1", policyDigest: DIGEST, privateKey, workspaceId: WORKSPACE,
    }, new Date("2026-09-01T00:00:00Z"));
    expect(bundle.expiresAt).toBe("2026-09-02T00:00:00.000Z");
    expect(JSON.stringify(bundle)).not.toMatch(/requester|decider|rationale|issueUrl/u);
  });
});
