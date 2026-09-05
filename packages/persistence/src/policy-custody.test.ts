/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createSignedPolicyApproval, type PolicyApproval } from "@kernel-zero/contracts";

import {
  createPolicyApprovalArtifact,
  findPolicyApprovalArtifact,
  readWorkspaceTrustBundle,
  registerPolicyAuthorityKey,
  revokePolicyAuthorityKey,
} from "./policy-custody";

const WORKSPACE = "0195f000-0000-7000-8000-000000000002";
const ACTOR = "0195f000-0000-7000-8000-000000000003";
const CORRELATION = "0195f000-0000-7000-8000-000000000001";
const REVISION = "0195f000-0000-7000-8000-000000000020";
const VALID_FROM = new Date("2026-01-01T00:00:00.000Z");

function client(tx: object) { return { $transaction: vi.fn(async (operation) => operation(tx)) } as never; }

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  if (jwk.x === undefined) throw new Error("Expected an Ed25519 JWK.");
  return { privateKey, x: jwk.x };
}

function approvalFor(privateKey: ReturnType<typeof keyPair>["privateKey"], workspace = WORKSPACE): PolicyApproval {
  return createSignedPolicyApproval({
    approvalId: "0195f000-0000-7000-8000-000000000012", approvedAt: new Date("2026-09-04T12:00:00.000Z"),
    approverId: "0195f000-0000-7000-8000-000000000011", authorId: "0195f000-0000-7000-8000-000000000010",
    keyId: "authority-1", policy: { digest: `sha256:${"1".repeat(64)}`, kind: "RepositoryPolicy", name: "service-boundaries", revision: 3 },
    privateKey, workspace,
  });
}

describe("policy authority keys", () => {
  it("stores only the validated Ed25519 public coordinate and audits the registration", async () => {
    const { x } = keyPair();
    const create = vi.fn<(input: { data: Record<string, unknown> }) => Promise<{ id: string; keyId: string }>>().mockResolvedValue({ id: "0195f000-0000-7000-8000-000000000030", keyId: "authority-1" });
    const tx = { auditRecord: { create: vi.fn() }, policyAuthorityKey: { create } };
    const base = { actorUserId: ACTOR, correlationId: CORRELATION, keyId: "authority-1", label: "Workspace authority", validFrom: VALID_FROM, validUntil: null, workspaceId: WORKSPACE };
    await expect(registerPolicyAuthorityKey(client(tx), { ...base, publicKeyX: "not-base64url" })).rejects.toThrow("publicKeyX");
    await expect(registerPolicyAuthorityKey(client(tx), { ...base, publicKeyX: x, validUntil: VALID_FROM })).rejects.toThrow("validUntil");
    await expect(registerPolicyAuthorityKey(client(tx), { ...base, publicKeyX: x })).resolves.toEqual({ id: "0195f000-0000-7000-8000-000000000030", keyId: "authority-1" });
    const data = create.mock.calls[0]?.[0].data ?? {};
    expect(data).toMatchObject({ publicKeyX: x, revokedFrom: null, workspaceId: WORKSPACE });
    expect(Object.keys(data).join(",")).not.toMatch(/private/iu);
    expect(tx.auditRecord.create).toHaveBeenCalledTimes(1);
  });

  it("revokes once with a workspace-scoped selector and audits only the state change", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const tx = { auditRecord: { create: vi.fn() }, policyAuthorityKey: { updateMany } };
    const input = { actorUserId: ACTOR, correlationId: CORRELATION, keyId: "authority-1", revokedFrom: new Date("2026-09-05T00:00:00.000Z"), workspaceId: WORKSPACE };
    await expect(revokePolicyAuthorityKey(client(tx), input)).resolves.toEqual({ revoked: true });
    await expect(revokePolicyAuthorityKey(client(tx), input)).resolves.toEqual({ revoked: false });
    expect(updateMany.mock.calls[0]?.[0]).toMatchObject({ where: { keyId: "authority-1", revokedFrom: null, workspaceId: WORKSPACE } });
    expect(tx.auditRecord.create).toHaveBeenCalledTimes(1);
  });

  it("builds a sorted, integrity-carrying trust bundle whose revision counts keys and revocations", async () => {
    const a = keyPair();
    const b = keyPair();
    const rows = [
      { keyId: "zeta", publicKeyX: a.x, revokedFrom: new Date("2026-06-01T00:00:00.000Z"), validFrom: VALID_FROM, validUntil: null },
      { keyId: "alpha", publicKeyX: b.x, revokedFrom: null, validFrom: VALID_FROM, validUntil: new Date("2027-01-01T00:00:00.000Z") },
    ];
    const findMany = vi.fn().mockResolvedValue(rows);
    const bundle = await readWorkspaceTrustBundle({ policyAuthorityKey: { findMany } } as never, WORKSPACE);
    expect(bundle?.keys.map((key) => key.keyId)).toEqual(["alpha", "zeta"]);
    expect(bundle?.revision).toBe(3);
    expect(bundle?.integrity.digest).toMatch(/^sha256:/u);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { workspaceId: WORKSPACE } });
    findMany.mockResolvedValue([]);
    await expect(readWorkspaceTrustBundle({ policyAuthorityKey: { findMany } } as never, WORKSPACE)).resolves.toBeNull();
  });
});

describe("policy approval artifacts", () => {
  it("persists the canonical signed artifact once and returns the same id on an identical retry", async () => {
    const { privateKey } = keyPair();
    const approval = approvalFor(privateKey);
    const create = vi.fn<(input: { data: Record<string, unknown> & { id: string } }) => Promise<{ id: string }>>().mockImplementation(async ({ data }) => ({ id: data.id }));
    const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ digest: approval.integrity.digest, id: approval.approvalId });
    const tx = { policyApprovalArtifact: { create, findFirst } } as never;
    const input = { approval, authorityKeyId: "0195f000-0000-7000-8000-000000000030", revisionId: REVISION, workspaceId: WORKSPACE };
    await expect(createPolicyApprovalArtifact(tx, input)).resolves.toEqual({ approvalId: approval.approvalId, created: true });
    await expect(createPolicyApprovalArtifact(tx, input)).resolves.toEqual({ approvalId: approval.approvalId, created: false });
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]?.[0].data ?? { canonicalJson: "" };
    expect(data).toMatchObject({ digest: approval.integrity.digest, policyDigest: approval.policy.digest, revisionId: REVISION, workspaceId: WORKSPACE });
    expect(JSON.parse(data.canonicalJson as string)).toEqual(approval);
  });

  it("refuses a different artifact for an already-approved revision and a foreign-workspace approval", async () => {
    const { privateKey } = keyPair();
    const approval = approvalFor(privateKey);
    const tx = { policyApprovalArtifact: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue({ digest: `sha256:${"9".repeat(64)}`, id: "other" }) } } as never;
    const input = { approval, authorityKeyId: "0195f000-0000-7000-8000-000000000030", revisionId: REVISION, workspaceId: WORKSPACE };
    await expect(createPolicyApprovalArtifact(tx, input)).rejects.toThrow("CONFLICT:approval_artifact_exists");
    await expect(createPolicyApprovalArtifact(tx, { ...input, approval: approvalFor(privateKey, "0195f000-0000-7000-8000-000000000009") })).rejects.toThrow("approval_workspace");
  });

  it("reads back a strictly parsed artifact by workspace and revision, and nothing across workspaces", async () => {
    const { privateKey } = keyPair();
    const approval = approvalFor(privateKey);
    const findFirst = vi.fn().mockImplementation(async ({ where }: { where: { workspaceId: string } }) =>
      where.workspaceId === WORKSPACE ? { canonicalJson: JSON.stringify(approval) } : null);
    const client = { policyApprovalArtifact: { findFirst } } as never;
    await expect(findPolicyApprovalArtifact(client, { revisionId: REVISION, workspaceId: WORKSPACE })).resolves.toEqual(approval);
    await expect(findPolicyApprovalArtifact(client, { revisionId: REVISION, workspaceId: "0195f000-0000-7000-8000-000000000009" })).resolves.toBeNull();
  });
});
