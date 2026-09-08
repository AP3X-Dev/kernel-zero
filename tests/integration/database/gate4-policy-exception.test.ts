import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@kernel-zero/domain";
import {
  activatePolicyRevision,
  approvePolicyRevision,
  createPersistenceClient,
  createPolicyPack,
  decideException,
  exportExceptionGrantSet,
  registerSigningKey,
  requestException,
  savePolicyDraft,
  type PersistenceClient,
} from "@kernel-zero/persistence";

import { isolatedTestDatabaseUrl } from "./environment";

const correlationId = "0195f000-0000-7000-8000-000000000001";

const document = (revision: number) => ({
  apiVersion: "kernel-zero.dev/v1" as const, kind: "RepositoryPolicy",
  metadata: { description: "Gate 4 database policy", name: "gate-four-policy", revision },
  scope: { exclude: [], include: ["packages/**/*.ts"], languages: ["typescript"] },
  rules: [{ check: { allowTypeOnly: false, files: ["packages/**"], kind: "require-import", module: "server-only" }, id: "server-only-rule", level: "error" as const, remediation: "Add the server-only marker.", title: "Server-only marker" }],
});

describe("Gate 4 isolated PostgreSQL policy and exception authority", () => {
  let prisma: PersistenceClient;
  let workspaceId: string;
  let packId: string;
  let revisionId: string;
  let policyDigest: string;

  beforeAll(async () => {
    prisma = createPersistenceClient(isolatedTestDatabaseUrl());
    workspaceId = generateUuidV7();
    ({ packId, revisionId } = await createPolicyPack(prisma, {
      correlationId, description: "Gate 4 database policy", displayName: "Gate Four Policy",
      document: document(1), slug: "gate-four-policy", workspaceId,
    }));
  });

  afterAll(async () => { await prisma.$disconnect(); });

  it("freezes approved bytes and permits only one active revision", async () => {
    policyDigest = (await approvePolicyRevision(prisma, { correlationId, revisionId, workspaceId })).digest;
    await expect(prisma.policyRevision.update({ data: { canonicalJson: "{}" }, where: { id: revisionId } })).rejects.toBeDefined();
    await activatePolicyRevision(prisma, { correlationId, revisionId, workspaceId });
    const second = await savePolicyDraft(prisma, { correlationId, document: document(2), packId, workspaceId });
    policyDigest = (await approvePolicyRevision(prisma, { correlationId, revisionId: second.revisionId, workspaceId })).digest;
    await activatePolicyRevision(prisma, { correlationId, revisionId: second.revisionId, workspaceId });
    await expect(prisma.policyRevision.count({ where: { packId, state: "active" } })).resolves.toBe(1);
  });

  it("lets exactly one concurrent decision win", async () => {
    const request = await requestException(prisma, {
      correlationId, findingFingerprint: `sha256:${"2".repeat(64)}`,
      policyDigest, rationale: "Temporary database migration.", ruleId: "server-only-rule",
      validUntil: new Date(Date.now() + 30 * 86_400_000), workspaceId,
    });
    const outcomes = await Promise.allSettled([
      decideException(prisma, { correlationId, decision: "denied", decisionNote: "first", exceptionId: request.id, workspaceId }),
      decideException(prisma, { correlationId, decision: "approved", decisionNote: "second", exceptionId: request.id, workspaceId }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const stored = await prisma.exceptionRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(stored.decisionState).not.toBe("pending");
    expect(stored.decidedAt).not.toBeNull();
  });

  it("stores only an Ed25519 public key and exports a private-data-free signed bundle", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();
    await registerSigningKey(prisma, { correlationId, keyId: "gate4-key", label: "Gate 4", publicKey: publicPem, workspaceId });
    const bundle = await exportExceptionGrantSet(prisma, { keyId: "gate4-key", policyDigest, privateKey, workspaceId });
    expect(JSON.stringify(bundle)).not.toMatch(/rationale|email|displayName|issueUrl/u);
    await expect(prisma.signingKey.findFirstOrThrow({ where: { keyId: "gate4-key", workspaceId } })).resolves.toMatchObject({ publicKey: publicPem });
  });
});
