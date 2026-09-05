import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { canonicalJson, generateUuidV7 } from "@kernel-zero/domain";
import {
  approvePolicyRevisionWithCustody,
  createPersistenceClient,
  createPolicyPack,
  createWorkspace,
  readWorkspaceTrustBundle,
  registerPolicyAuthorityKey,
  type PersistenceClient,
} from "@kernel-zero/persistence";
import { CustodyRejectedError } from "../../../packages/validator/src/cli";
import { runValidation } from "../../../packages/validator/src/runner";

import { createEphemeralPolicyAuthority } from "../../../apps/control/src/server/policy/custody-signer";
import { isolatedTestDatabaseUrl } from "./environment";

const correlationId = "0195f000-0000-7000-8000-000000000001";
const document = {
  apiVersion: "kernel-zero.dev/v1" as const, kind: "RepositoryPolicy",
  metadata: { description: "Gate 6 end-to-end custody policy", name: "gate-six-policy", revision: 1 },
  scope: { exclude: [], include: ["src/**/*.ts"], languages: ["typescript"] },
  rules: [{ check: { allowTypeOnly: false, files: ["src/**"], kind: "require-import", module: "server-only" }, id: "server-only-rule", level: "error" as const, remediation: "Add the server-only marker.", title: "Server-only marker" }],
};

describe("Gate 6 end-to-end custody: propose, approve with custody, prove offline, validate source", () => {
  let prisma: PersistenceClient;
  let makerId: string;
  let checkerId: string;
  let workspaceId: string;
  let root: string;
  let files: Readonly<{ custodyOut: string; out: string; policy: string; policyApproval: string; workspaceTrust: string }>;

  beforeAll(async () => {
    prisma = createPersistenceClient(isolatedTestDatabaseUrl());
    makerId = generateUuidV7();
    checkerId = generateUuidV7();
    await prisma.user.createMany({ data: [makerId, checkerId].map((id, index) => ({
      displayName: `Gate 6 user ${String(index)}`, email: `gate6-${id}@example.test`, id, normalizedEmail: `gate6-${id}@example.test`,
    })) });
    workspaceId = (await createWorkspace(prisma, { correlationId, name: `Gate 6 ${makerId}`, userId: makerId })).workspace.id;

    // The workspace authority key lives only in this process; the database stores its public coordinate.
    const authority = createEphemeralPolicyAuthority("gate6-authority");
    await registerPolicyAuthorityKey(prisma, { actorUserId: makerId, correlationId, keyId: "gate6-authority", label: "Gate 6", publicKeyX: authority.publicKeyX, validFrom: new Date("2026-01-01T00:00:00.000Z"), validUntil: null, workspaceId });

    // Maker proposes; a different checker approves with custody.
    const { revisionId } = await createPolicyPack(prisma, { actorUserId: makerId, correlationId, description: "Gate 6", displayName: "Gate Six", document, slug: "gate-six-policy", workspaceId });
    const approved = await approvePolicyRevisionWithCustody(prisma, { actorUserId: checkerId, correlationId, keyId: "gate6-authority", revisionId, signer: authority.signer, workspaceId });
    const revision = await prisma.policyRevision.findUniqueOrThrow({ where: { id: revisionId } });
    const trust = await readWorkspaceTrustBundle(prisma, workspaceId);
    if (trust === null) throw new Error("Expected a trust bundle.");

    // Orchestration hands the validator the approved policy bytes and both custody artifacts; nothing is fetched.
    root = await mkdtemp(path.join(tmpdir(), "kernel-zero-gate6-"));
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "entry.ts"), 'import "server-only";\nexport const value = 1;\n', "utf8");
    files = {
      custodyOut: path.join(root, "custody.json"), out: path.join(root, "evidence.json"), policy: path.join(root, "policy.json"),
      policyApproval: path.join(root, "approval.json"), workspaceTrust: path.join(root, "trust.json"),
    };
    await writeFile(files.policy, revision.canonicalJson, "utf8");
    await writeFile(files.policyApproval, canonicalJson(approved.approval), "utf8");
    await writeFile(files.workspaceTrust, canonicalJson(trust), "utf8");
  });

  afterAll(async () => { await prisma.$disconnect(); });

  it("proves custody offline, validates the repository, and reproduces both artifacts byte for byte", async () => {
    const options = { generatedAt: new Date("2026-09-05T12:00:00.000Z"), runId: "0195f000-0000-7000-8000-000000000060" };
    const first = await runValidation({ command: "validate", ...files, root, workspace: workspaceId }, options);
    expect(first.outcome).toBe("pass");
    expect(first.custody?.result).toEqual({ status: "pass", errors: 0 });
    expect(first.evidence.policy.digest).toBe(first.custody?.policy.digest);
    const custodyBytes = await readFile(files.custodyOut, "utf8");
    const evidenceBytes = JSON.parse(await readFile(files.out, "utf8")) as { integrity: { digest: string } };
    const second = await runValidation({ command: "validate", ...files, root, workspace: workspaceId }, options);
    expect(await readFile(files.custodyOut, "utf8")).toBe(custodyBytes);
    expect(second.evidence.integrity.digest).toBe(evidenceBytes.integrity.digest);
  });

  it("fails custody on tampering and on the wrong workspace without touching repository evidence", async () => {
    await writeFile(files.out, "preserve-me\n", "utf8");
    const approval = JSON.parse(await readFile(files.policyApproval, "utf8")) as { approverId: string };
    const tampered = path.join(root, "approval-tampered.json");
    await writeFile(tampered, JSON.stringify({ ...approval, approverId: approval.approverId.replace(/.$/u, (c) => (c === "0" ? "1" : "0")) }), "utf8");
    const tamper = await runValidation({ command: "validate", ...files, policyApproval: tampered, root, workspace: workspaceId }).catch((error: unknown) => error);
    expect(tamper).toBeInstanceOf(CustodyRejectedError);
    if (tamper instanceof CustodyRejectedError) {
      expect(tamper.custody.findings.map((finding) => finding.code)).toEqual(["CUSTODY_APPROVAL_INTEGRITY_INVALID", "CUSTODY_APPROVAL_SIGNATURE_INVALID"]);
    }
    const wrongWorkspace = await runValidation({ command: "validate", ...files, root, workspace: "0195f000-0000-7000-8000-000000000009" }).catch((error: unknown) => error);
    expect(wrongWorkspace).toBeInstanceOf(CustodyRejectedError);
    if (wrongWorkspace instanceof CustodyRejectedError) {
      expect(wrongWorkspace.custody.findings.map((finding) => finding.code)).toEqual(["CUSTODY_WORKSPACE_MISMATCH"]);
    }
    expect(await readFile(files.out, "utf8")).toBe("preserve-me\n");
  });
});
