import { generateKeyPairSync } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  PolicyCustodyEvidenceSchema,
  createSignedPolicyApproval,
  createWorkspaceTrustBundle,
  type PolicyApproval,
  type WorkspaceTrustBundle,
} from "@kernel-zero/contracts";
import { canonicalJson, canonicalSha256 } from "@kernel-zero/domain";

import { CustodyRejectedError, parseCliArguments, runCli } from "./cli";
import { runValidation } from "./runner";

const WORKSPACE = "0195f000-0000-7000-8000-000000000002";
const OTHER_WORKSPACE = "0195f000-0000-7000-8000-000000000009";
const VALIDATOR_TEST_TIMEOUT_MS = 30_000;
const POLICY = {
  apiVersion: "kernel-zero.dev/v1",
  kind: "RepositoryPolicy",
  metadata: { description: "Custody fixture policy", name: "custody-policy", revision: 2 },
  rules: [{
    check: { deny: ["module:@prisma/client"], from: ["src/**/*.ts"], kind: "forbid-import-edge" },
    id: "no-raw-prisma", level: "error", remediation: "Use the repository boundary.", title: "No raw Prisma",
  }],
  scope: { exclude: [], include: ["src/**/*.ts"], languages: ["typescript"] },
};

async function fixture(options: Readonly<{ approvalWorkspace?: string; source?: string }> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "kernel-zero-custody-flow-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "entry.ts"), options.source ?? "export const value = 1;\n", "utf8");
  const policy = path.join(root, "policy.json");
  await writeFile(policy, canonicalJson(POLICY), "utf8");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  if (jwk.x === undefined) throw new Error("Expected an Ed25519 JWK.");
  const trust: WorkspaceTrustBundle = createWorkspaceTrustBundle({
    keys: [{ crv: "Ed25519", keyId: "authority-1", kty: "OKP", revokedFrom: null, validFrom: "2026-01-01T00:00:00.000Z", validUntil: null, x: jwk.x }],
    revision: 1,
    workspace: WORKSPACE,
  });
  const approval: PolicyApproval = createSignedPolicyApproval({
    approvalId: "0195f000-0000-7000-8000-000000000012",
    approvedAt: new Date("2026-09-04T12:00:00.000Z"),
    approverId: "0195f000-0000-7000-8000-000000000011",
    authorId: "0195f000-0000-7000-8000-000000000010",
    keyId: "authority-1",
    policy: { digest: canonicalSha256(POLICY), kind: "RepositoryPolicy", name: "custody-policy", revision: 2 },
    privateKey,
    workspace: options.approvalWorkspace ?? WORKSPACE,
  });
  const policyApproval = path.join(root, "approval.json");
  const workspaceTrust = path.join(root, "trust.json");
  await writeFile(policyApproval, canonicalJson(approval), "utf8");
  await writeFile(workspaceTrust, canonicalJson(trust), "utf8");
  return {
    custodyOut: path.join(root, "custody.json"),
    out: path.join(root, "evidence.json"),
    policy,
    policyApproval,
    root,
    workspaceTrust,
  };
}

describe("custody-first validation", { timeout: VALIDATOR_TEST_TIMEOUT_MS }, () => {
  it("parses the all-or-none custody option group", () => {
    const base = ["validate", "--policy", "p.json", "--root", ".", "--workspace", WORKSPACE, "--out", "r.json"];
    expect(parseCliArguments([...base, "--policy-approval", "a.json", "--workspace-trust", "t.json", "--custody-out", "c.json"])).toEqual({
      command: "validate", custodyOut: "c.json", out: "r.json", policy: "p.json", policyApproval: "a.json", root: ".", workspace: WORKSPACE, workspaceTrust: "t.json",
    });
    expect(parseCliArguments(base)).toEqual({ command: "validate", out: "r.json", policy: "p.json", root: ".", workspace: WORKSPACE });
    expect(() => parseCliArguments([...base, "--policy-approval", "a.json"])).toThrowError("must be supplied together");
    expect(() => parseCliArguments([...base, "--custody-out", "c.json", "--workspace-trust", "t.json"])).toThrowError("must be supplied together");
  });

  it("writes passing custody evidence before repository evidence and stays deterministic", async () => {
    const paths = await fixture();
    const run = await runValidation({ command: "validate", ...paths, workspace: WORKSPACE }, { generatedAt: new Date("2026-09-04T12:00:00.000Z"), runId: "0195f000-0000-7000-8000-000000000020" });
    expect(run.outcome).toBe("pass");
    expect(run.custody?.result).toEqual({ status: "pass", errors: 0 });
    const written = PolicyCustodyEvidenceSchema.parse(JSON.parse(await readFile(paths.custodyOut, "utf8")));
    expect(written).toEqual(run.custody);
    expect(written.policy.digest).toBe(run.evidence.policy.digest);
    const again = await runValidation({ command: "validate", ...paths, workspace: WORKSPACE }, { generatedAt: new Date("2026-09-05T12:00:00.000Z"), runId: "0195f000-0000-7000-8000-000000000021" });
    expect(await readFile(paths.custodyOut, "utf8")).toBe(`${canonicalJson(written)}\n`);
    expect(again.custody?.integrity.digest).toBe(written.integrity.digest);
    expect(again.evidence.integrity.digest).toBe(run.evidence.integrity.digest);
  });

  it("on a valid custody failure writes only custody evidence, never scans source, and leaves --out untouched", async () => {
    const paths = await fixture({ approvalWorkspace: OTHER_WORKSPACE, source: "export const = ;\n" });
    await writeFile(paths.out, "preserve-me\n", "utf8");
    const error = await runValidation({ command: "validate", ...paths, workspace: WORKSPACE }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CustodyRejectedError);
    if (!(error instanceof CustodyRejectedError)) throw new Error("unreachable");
    expect(error.custody.result).toEqual({ status: "fail", errors: 1 });
    expect(error.custody.findings.map((finding) => finding.code)).toEqual(["CUSTODY_WORKSPACE_MISMATCH"]);
    expect(await readFile(paths.custodyOut, "utf8")).toBe(`${canonicalJson(error.custody)}\n`);
    expect(await readFile(paths.out, "utf8")).toBe("preserve-me\n");

    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await expect(runCli([
      "validate", "--policy", paths.policy, "--root", paths.root, "--workspace", WORKSPACE, "--out", paths.out,
      "--policy-approval", paths.policyApproval, "--workspace-trust", paths.workspaceTrust, "--custody-out", paths.custodyOut,
    ], runValidation)).resolves.toBe(1);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("error CUSTODY_WORKSPACE_MISMATCH workspace:"));
    stdout.mockRestore();
    write.mockRestore();
    expect(await readFile(paths.out, "utf8")).toBe("preserve-me\n");
  });

  it("refuses output paths that collide with each other or with an input", async () => {
    const paths = await fixture();
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(runCli([
      "validate", "--policy", paths.policy, "--root", paths.root, "--workspace", WORKSPACE, "--out", paths.out,
      "--policy-approval", paths.policyApproval, "--workspace-trust", paths.workspaceTrust, "--custody-out", paths.out,
    ], runValidation)).resolves.toBe(2);
    await expect(runCli([
      "validate", "--policy", paths.policy, "--root", paths.root, "--workspace", WORKSPACE, "--out", paths.policy,
    ], runValidation)).resolves.toBe(2);
    expect(write).toHaveBeenCalledWith(expect.stringContaining("distinct"));
    write.mockRestore();
    await expect(access(paths.out)).rejects.toBeDefined();
    expect(JSON.parse(await readFile(paths.policy, "utf8"))).toMatchObject({ kind: "RepositoryPolicy" });
  });

  it("exits 2 and writes neither output when a custody artifact is malformed or unreadable", async () => {
    const paths = await fixture();
    await writeFile(paths.policyApproval, JSON.stringify({ nope: true }), "utf8");
    await expect(runValidation({ command: "validate", ...paths, workspace: WORKSPACE })).rejects.toThrow(/custody contract/u);
    await expect(access(paths.custodyOut)).rejects.toBeDefined();
    await expect(access(paths.out)).rejects.toBeDefined();

    const unreadable = await fixture();
    await writeFile(unreadable.workspaceTrust, "{ not json", "utf8");
    await expect(runValidation({ command: "validate", ...unreadable, workspace: WORKSPACE })).rejects.toThrow(/not readable JSON/u);
    await expect(access(unreadable.custodyOut)).rejects.toBeDefined();
    await expect(access(unreadable.out)).rejects.toBeDefined();

    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(runCli([
      "validate", "--policy", unreadable.policy, "--root", unreadable.root, "--workspace", WORKSPACE, "--out", unreadable.out,
      "--policy-approval", unreadable.policyApproval, "--workspace-trust", unreadable.workspaceTrust, "--custody-out", unreadable.custodyOut,
    ], runValidation)).resolves.toBe(2);
    write.mockRestore();
  });

  it("keeps legacy validation byte-identical when the custody group is absent", async () => {
    const paths = await fixture();
    const options = { generatedAt: new Date("2026-09-04T12:00:00.000Z"), runId: "0195f000-0000-7000-8000-000000000022" };
    const timeless = (evidence: Readonly<{ result: Readonly<{ durationMs: number }> }>) => ({ ...evidence, result: { ...evidence.result, durationMs: 0 } });
    const legacy = await runValidation({ command: "validate", out: paths.out, policy: paths.policy, root: paths.root, workspace: WORKSPACE }, options);
    const legacyBytes = timeless(JSON.parse(await readFile(paths.out, "utf8")) as typeof legacy.evidence);
    const withCustody = await runValidation({ command: "validate", ...paths, workspace: WORKSPACE }, options);
    expect(legacy.custody).toBeNull();
    expect(timeless(JSON.parse(await readFile(paths.out, "utf8")) as typeof legacy.evidence)).toEqual(legacyBytes);
    expect(timeless(withCustody.evidence)).toEqual(timeless(legacy.evidence));
    expect(withCustody.evidence.integrity.digest).toBe(legacy.evidence.integrity.digest);
  });
});
