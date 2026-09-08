/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { describe, expect, it, vi } from "vitest";

import { canonicalJson } from "@kernel-zero/domain";

import { approvePolicyRevision, savePolicyDraft, activatePolicyRevision } from "./policies";

const WORKSPACE = "0195f000-0000-7000-8000-000000000002";
const CORRELATION = "0195f000-0000-7000-8000-000000000001";
const policy = (revision = 1) => ({
  apiVersion: "kernel-zero.dev/v1" as const, kind: "RepositoryPolicy",
  metadata: { name: "service-boundaries", revision, description: "Repository architecture rules" },
  scope: { languages: ["typescript"], include: ["apps/**/*.ts"], exclude: [] },
  rules: [{ id: "rule-one", title: "Rule", level: "error" as const, check: { kind: "require-import", files: ["apps/**"], module: "server-only", allowTypeOnly: false }, remediation: "Add the import." }],
});

function client(tx: object) { return { $transaction: vi.fn(async (operation) => operation(tx)) } as never; }

describe("policy lifecycle", () => {
  it("updates only a draft", async () => {
    const updateMany = vi.fn<(input: { where: { state: string; workspaceId: string } }) => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });
    const tx = { auditRecord: { create: vi.fn() }, policyRevision: { findFirst: vi.fn().mockResolvedValue({ id: "revision", revision: 1 }), updateMany } };
    await savePolicyDraft(client(tx), { correlationId: CORRELATION, document: policy(), packId: "pack", workspaceId: WORKSPACE });
    expect(updateMany.mock.calls[0]?.[0].where).toMatchObject({ state: "draft", workspaceId: WORKSPACE });
  });

  it("approves only a draft in the write predicate and freezes canonical bytes", async () => {
    const revision = { id: "revision", revision: 1, canonicalJson: JSON.stringify(policy()), state: "draft" };
    const updateMany = vi.fn<(input: { data: { canonicalJson: string }; where: { state: string } }) => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });
    const tx = { auditRecord: { create: vi.fn() }, policyRevision: { findFirst: vi.fn().mockResolvedValue(revision), updateMany } };
    const approval = await approvePolicyRevision(client(tx), { correlationId: CORRELATION, revisionId: "revision", workspaceId: WORKSPACE });
    expect(approval.digest).toMatch(/^sha256:/u);
    expect(updateMany.mock.calls[0]?.[0].where).toMatchObject({ state: "draft", workspaceId: WORKSPACE });
    expect(updateMany.mock.calls[0]?.[0].data.canonicalJson).toBe(canonicalJson(policy()));
  });

  it("activates one approved revision atomically", async () => {
    const updatePack = vi.fn<(input: { data: { activeRevisionId: string; lifecycleState: string } }) => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });
    const tx = {
      auditRecord: { create: vi.fn() },
      policyPack: { findFirst: vi.fn().mockResolvedValue({ activeRevisionId: null, id: "pack" }), updateMany: updatePack },
      policyRevision: { findFirst: vi.fn().mockResolvedValue({ id: "revision", packId: "pack", revision: 1, state: "approved" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    await activatePolicyRevision(client(tx), { correlationId: CORRELATION, revisionId: "revision", workspaceId: WORKSPACE });
    expect(updatePack.mock.calls[0]?.[0].data).toMatchObject({ activeRevisionId: "revision", lifecycleState: "active" });
  });
});
