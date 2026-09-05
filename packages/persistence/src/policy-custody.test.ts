/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createSignedPolicyApproval, type PolicyApproval } from "@kernel-zero/contracts";

import {
  approvePolicyRevisionWithCustody,
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

describe("approval with custody", () => {
  const AUTHORITY_ID = "0195f000-0000-7000-8000-000000000030";
  const NOW = new Date("2026-09-04T12:00:00.000Z");
  const draft = { authorId: "0195f000-0000-7000-8000-000000000010", canonicalJson: JSON.stringify({ apiVersion: "kernel-zero.dev/v1", kind: "RepositoryPolicy", metadata: { description: "d", name: "service-boundaries", revision: 3 }, rules: [{ check: { kind: "require-import" }, id: "server-only", level: "error", remediation: "r", title: "t" }] }), id: REVISION, revision: 3, state: "draft", workspaceId: WORKSPACE };
  const validKey = { id: AUTHORITY_ID, keyId: "authority-1", revokedFrom: null, validFrom: VALID_FROM, validUntil: null };

  function signerFor(pair: ReturnType<typeof keyPair>, keyId = "authority-1") {
    return { keyId, sign: vi.fn((digest: Uint8Array) => Promise.resolve(new Uint8Array(sign(null, digest, pair.privateKey)))) };
  }

  function transaction(pair: ReturnType<typeof keyPair>, overrides: Record<string, unknown> = {}) {
    const artifacts: Record<string, unknown>[] = [];
    return {
      $queryRaw: vi.fn().mockResolvedValue([{ now: NOW }]),
      auditRecord: { create: vi.fn() },
      policyApprovalArtifact: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { artifacts.push(data); return { id: data.id }; }),
        findFirst: vi.fn(async () => artifacts[0] ?? null),
      },
      policyAuthorityKey: { findFirst: vi.fn().mockResolvedValue({ ...validKey, publicKeyX: pair.x }) },
      policyRevision: { findFirst: vi.fn().mockResolvedValue(draft), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      ...overrides,
    };
  }

  const actor = { actorUserId: "0195f000-0000-7000-8000-000000000011", correlationId: CORRELATION, keyId: "authority-1", revisionId: REVISION, workspaceId: WORKSPACE };

  it("approves, signs at the database clock, self-verifies, files the artifact, and audits in one transaction", async () => {
    const pair = keyPair();
    const tx = transaction(pair);
    const signer = signerFor(pair);
    const result = await approvePolicyRevisionWithCustody(client(tx), { ...actor, signer });
    expect(result.created).toBe(true);
    expect(result.approval).toMatchObject({ approvedAt: NOW.toISOString(), approverId: actor.actorUserId, authorId: draft.authorId, policy: { kind: "RepositoryPolicy", name: "service-boundaries", revision: 3 }, signature: { keyId: "authority-1" }, workspace: WORKSPACE });
    expect(signer.sign).toHaveBeenCalledTimes(1);
    expect(tx.policyRevision.updateMany.mock.calls[0]?.[0]).toMatchObject({ data: { approvedAt: NOW, state: "approved" }, where: { state: "draft", workspaceId: WORKSPACE } });
    expect(tx.policyApprovalArtifact.create).toHaveBeenCalledTimes(1);
    expect(tx.auditRecord.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tx.auditRecord.create.mock.calls[0]?.[0])).toContain("policy.revision-approved-with-custody");
  });

  it("refuses the author, a mismatched or foreign signer, an unauthorized key window, and a bad signature before anything persists", async () => {
    const pair = keyPair();
    const other = keyPair();
    await expect(approvePolicyRevisionWithCustody(client(transaction(pair)), { ...actor, signer: signerFor(pair, "other-key") })).rejects.toThrow("signer_key_mismatch");
    await expect(approvePolicyRevisionWithCustody(client(transaction(pair)), { ...actor, actorUserId: draft.authorId, signer: signerFor(pair) })).rejects.toThrow("maker_checker");
    const revoked = transaction(pair, { policyAuthorityKey: { findFirst: vi.fn().mockResolvedValue({ ...validKey, publicKeyX: pair.x, revokedFrom: NOW }) } });
    await expect(approvePolicyRevisionWithCustody(client(revoked), { ...actor, signer: signerFor(pair) })).rejects.toThrow("authority_not_valid");
    const foreignSigner = transaction(pair);
    await expect(approvePolicyRevisionWithCustody(client(foreignSigner), { ...actor, signer: signerFor(other) })).rejects.toThrow("signature_invalid");
    expect(foreignSigner.policyApprovalArtifact.create).not.toHaveBeenCalled();
    expect(foreignSigner.auditRecord.create).not.toHaveBeenCalled();
    const missingKey = transaction(pair, { policyAuthorityKey: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(approvePolicyRevisionWithCustody(client(missingKey), { ...actor, signer: signerFor(pair) })).rejects.toThrow("authority_key");
  });

  it("returns the stored artifact on retry without signing again, and refuses custody for a plainly approved revision", async () => {
    const pair = keyPair();
    const approval = approvalFor(pair.privateKey);
    const approvedRevision = { ...draft, state: "approved" };
    const tx = transaction(pair, {
      policyApprovalArtifact: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue({ canonicalJson: JSON.stringify(approval) }) },
      policyRevision: { findFirst: vi.fn().mockResolvedValue(approvedRevision), updateMany: vi.fn() },
    });
    const signer = signerFor(pair);
    await expect(approvePolicyRevisionWithCustody(client(tx), { ...actor, signer })).resolves.toEqual({ approval, created: false });
    expect(signer.sign).not.toHaveBeenCalled();
    const plain = transaction(pair, {
      policyApprovalArtifact: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
      policyRevision: { findFirst: vi.fn().mockResolvedValue(approvedRevision), updateMany: vi.fn() },
    });
    await expect(approvePolicyRevisionWithCustody(client(plain), { ...actor, signer })).rejects.toThrow("approved_without_custody");
  });
});

describe("policy approval artifacts", () => {
  it("persists the canonical signed artifact once and returns the same id on an identical retry", async () => {
    const { privateKey } = keyPair();
    const approval = approvalFor(privateKey);
    const create = vi.fn<(input: { data: Record<string, unknown> & { id: string } }) => Promise<{ id: string }>>().mockImplementation(async ({ data }) => ({ id: data.id }));
    const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ digest: approval.integrity.digest, id: approval.approvalId });
    const tx = { policyApprovalArtifact: { create, findFirst } } as never;
    const input = { authorityKeyId: "0195f000-0000-7000-8000-000000000030", revisionId: REVISION, workspaceId: WORKSPACE };
    await expect(createPolicyApprovalArtifact(tx, approval, input)).resolves.toEqual({ approvalId: approval.approvalId, created: true });
    await expect(createPolicyApprovalArtifact(tx, approval, input)).resolves.toEqual({ approvalId: approval.approvalId, created: false });
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]?.[0].data ?? { canonicalJson: "" };
    expect(data).toMatchObject({ digest: approval.integrity.digest, policyDigest: approval.policy.digest, revisionId: REVISION, workspaceId: WORKSPACE });
    expect(JSON.parse(data.canonicalJson as string)).toEqual(approval);
  });

  it("refuses a different artifact for an already-approved revision and a foreign-workspace approval", async () => {
    const { privateKey } = keyPair();
    const approval = approvalFor(privateKey);
    const tx = { policyApprovalArtifact: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue({ digest: `sha256:${"9".repeat(64)}`, id: "other" }) } } as never;
    const input = { authorityKeyId: "0195f000-0000-7000-8000-000000000030", revisionId: REVISION, workspaceId: WORKSPACE };
    await expect(createPolicyApprovalArtifact(tx, approval, input)).rejects.toThrow("CONFLICT:approval_artifact_exists");
    await expect(createPolicyApprovalArtifact(tx, approvalFor(privateKey, "0195f000-0000-7000-8000-000000000009"), input)).rejects.toThrow("approval_workspace");
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
