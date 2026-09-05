import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSignedPolicyApproval, verifyPolicyCustody, type PolicyApproval } from "@kernel-zero/contracts";
import { generateUuidV7 } from "@kernel-zero/domain";
import {
  approvePolicyRevision,
  createPersistenceClient,
  createPolicyApprovalArtifact,
  createPolicyPack,
  createWorkspace,
  findPolicyApprovalArtifact,
  readWorkspaceTrustBundle,
  registerPolicyAuthorityKey,
  revokePolicyAuthorityKey,
  type PersistenceClient,
} from "@kernel-zero/persistence";

import { isolatedTestDatabaseUrl } from "./environment";

const correlationId = "0195f000-0000-7000-8000-000000000001";
const document = {
  apiVersion: "kernel-zero.dev/v1" as const, kind: "RepositoryPolicy",
  metadata: { description: "Gate 5 custody policy", name: "gate-five-policy", revision: 1 },
  scope: { exclude: [], include: ["packages/**/*.ts"], languages: ["typescript"] },
  rules: [{ check: { allowTypeOnly: false, files: ["packages/**"], kind: "require-import", module: "server-only" }, id: "server-only-rule", level: "error" as const, remediation: "Add the server-only marker.", title: "Server-only marker" }],
};

describe("Gate 5 isolated PostgreSQL policy custody", () => {
  let prisma: PersistenceClient;
  let authorId: string;
  let checkerId: string;
  let workspaceId: string;
  let siblingWorkspaceId: string;
  let revisionId: string;
  let policyDigest: string;
  let authorityKeyId: string;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicX = publicKey.export({ format: "jwk" }).x ?? "";

  function approval(overrides: Partial<Parameters<typeof createSignedPolicyApproval>[0]> = {}): PolicyApproval {
    return createSignedPolicyApproval({
      approvalId: generateUuidV7(), approvedAt: new Date("2026-09-04T12:00:00.000Z"), approverId: checkerId, authorId,
      keyId: "gate5-authority", policy: { digest: policyDigest as `sha256:${string}`, kind: "RepositoryPolicy", name: "gate-five-policy", revision: 1 },
      privateKey, workspace: workspaceId, ...overrides,
    });
  }

  beforeAll(async () => {
    prisma = createPersistenceClient(isolatedTestDatabaseUrl());
    authorId = generateUuidV7();
    checkerId = generateUuidV7();
    await prisma.user.createMany({ data: [authorId, checkerId].map((id, index) => ({
      displayName: `Gate 5 user ${String(index)}`, email: `gate5-${id}@example.test`, id, normalizedEmail: `gate5-${id}@example.test`,
    })) });
    workspaceId = (await createWorkspace(prisma, { correlationId, name: `Gate 5 ${authorId}`, userId: authorId })).workspace.id;
    siblingWorkspaceId = (await createWorkspace(prisma, { correlationId, name: `Gate 5 sibling ${authorId}`, userId: checkerId })).workspace.id;
    ({ revisionId } = await createPolicyPack(prisma, {
      actorUserId: authorId, correlationId, description: "Gate 5 custody policy", displayName: "Gate Five Policy",
      document, slug: "gate-five-policy", workspaceId,
    }));
    policyDigest = (await approvePolicyRevision(prisma, { actorUserId: checkerId, correlationId, revisionId, workspaceId })).digest;
  });

  afterAll(async () => { await prisma.$disconnect(); });

  it("registers a public-only authority key, enforces the timeline checks, and exposes a verifiable trust bundle", async () => {
    ({ id: authorityKeyId } = await registerPolicyAuthorityKey(prisma, {
      actorUserId: authorId, correlationId, keyId: "gate5-authority", label: "Gate 5", publicKeyX: publicX,
      validFrom: new Date("2026-01-01T00:00:00.000Z"), validUntil: null, workspaceId,
    }));
    await expect(registerPolicyAuthorityKey(prisma, {
      actorUserId: authorId, correlationId, keyId: "gate5-authority", label: "Duplicate", publicKeyX: publicX,
      validFrom: new Date("2026-01-01T00:00:00.000Z"), validUntil: null, workspaceId,
    })).rejects.toBeDefined();
    await expect(prisma.policyAuthorityKey.update({ data: { validUntil: new Date("2025-01-01T00:00:00.000Z") }, where: { id: authorityKeyId } })).rejects.toBeDefined();
    await expect(prisma.policyAuthorityKey.update({ data: { publicKeyX: "!".repeat(43) }, where: { id: authorityKeyId } })).rejects.toBeDefined();
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'PolicyAuthorityKey'`;
    expect(columns.map((column) => column.column_name).join(",")).not.toMatch(/private|secret|seed/iu);

    const trust = await readWorkspaceTrustBundle(prisma, workspaceId);
    if (trust === null) throw new Error("Expected a trust bundle.");
    const custody = verifyPolicyCustody({ approval: approval(), policy: { digest: policyDigest as `sha256:${string}`, kind: "RepositoryPolicy", name: "gate-five-policy", revision: 1 }, toolVersion: "0.1.0", trust, workspace: workspaceId });
    expect(custody.result).toEqual({ status: "pass", errors: 0 });
    await expect(readWorkspaceTrustBundle(prisma, siblingWorkspaceId)).resolves.toBeNull();
  });

  it("stores one immutable artifact per revision, returns it on identical retry, and lets exactly one concurrent writer win", async () => {
    const signed = approval();
    const input = { approval: signed, authorityKeyId, revisionId, workspaceId };
    const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () =>
      prisma.$transaction((tx) => createPolicyApprovalArtifact(tx, { ...input, approval: approval() }), { isolationLevel: "Serializable" })));
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    await expect(prisma.policyApprovalArtifact.count({ where: { revisionId, workspaceId } })).resolves.toBe(1);

    const stored = await findPolicyApprovalArtifact(prisma, { revisionId, workspaceId });
    if (stored === null) throw new Error("Expected the stored artifact.");
    await expect(prisma.$transaction((tx) => createPolicyApprovalArtifact(tx, { ...input, approval: stored }))).resolves.toEqual({ approvalId: stored.approvalId, created: false });
    await expect(prisma.$transaction((tx) => createPolicyApprovalArtifact(tx, { ...input, approval: approval() }))).rejects.toThrow("approval_artifact_exists");
    await expect(prisma.policyApprovalArtifact.update({ data: { approvedAt: new Date() }, where: { id: stored.approvalId } })).rejects.toBeDefined();
    await expect(findPolicyApprovalArtifact(prisma, { revisionId, workspaceId: siblingWorkspaceId })).resolves.toBeNull();
    await expect(prisma.$transaction((tx) => createPolicyApprovalArtifact(tx, { ...input, workspaceId: siblingWorkspaceId, approval: approval({ workspace: siblingWorkspaceId }) }))).rejects.toBeDefined();
  });

  it("revokes retroactively and the trust bundle revision advances so later verification fails at the signed time", async () => {
    await expect(revokePolicyAuthorityKey(prisma, { actorUserId: authorId, correlationId, keyId: "gate5-authority", revokedFrom: new Date("2026-09-01T00:00:00.000Z"), workspaceId: siblingWorkspaceId })).resolves.toEqual({ revoked: false });
    await expect(revokePolicyAuthorityKey(prisma, { actorUserId: authorId, correlationId, keyId: "gate5-authority", revokedFrom: new Date("2026-09-01T00:00:00.000Z"), workspaceId })).resolves.toEqual({ revoked: true });
    const trust = await readWorkspaceTrustBundle(prisma, workspaceId);
    if (trust === null) throw new Error("Expected a trust bundle.");
    expect(trust.revision).toBe(2);
    const stored = await findPolicyApprovalArtifact(prisma, { revisionId, workspaceId });
    if (stored === null) throw new Error("Expected the stored artifact.");
    const custody = verifyPolicyCustody({ approval: stored, policy: { digest: policyDigest as `sha256:${string}`, kind: "RepositoryPolicy", name: "gate-five-policy", revision: 1 }, toolVersion: "0.1.0", trust, workspace: workspaceId });
    expect(custody.findings.map((finding) => finding.code)).toEqual(["CUSTODY_AUTHORITY_TIME_INVALID"]);
  });
});
