import { describe, expect, it, vi } from "vitest";

import type { PersistenceClient } from "@kernel-zero/persistence";

import {
  loadAuditView,
  loadPoliciesView,
  loadPolicyDetailView,
  loadRunDetailView,
} from "./governance-view";

const WORKSPACE = "0198f150-7e30-7000-8000-000000000001";

describe("governance UI read models", () => {
  it("fences policy lists by workspace and returns only the bounded safe projection", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      activeRevision: { digest: "sha256:abc", revision: 2 },
      description: "Repository boundary checks.",
      displayName: "Core policy",
      lifecycleState: "active",
      slug: "core-policy",
      updatedAt: new Date("2026-08-31T00:00:00.000Z"),
    }]);
    const client = { policyPack: { findMany } } as unknown as PersistenceClient;

    const result = await loadPoliciesView(client, WORKSPACE);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25, where: { workspaceId: WORKSPACE } }));
    expect(result).toEqual([expect.objectContaining({ activeRevision: 2, slug: "core-policy" })]);
    expect(result[0]).not.toHaveProperty("canonicalJson");
  });

  it("fails the latest policy document closed when stored JSON is not a strict public policy", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      description: "Policy",
      displayName: "Policy",
      lifecycleState: "draft",
      revisions: [{ approvedAt: null, canonicalJson: "{\"unknown\":true}", createdAt: new Date(), digest: null, revision: 1, state: "draft" }],
      slug: "policy",
    });
    const client = { policyPack: { findFirst } } as unknown as PersistenceClient;

    const result = await loadPolicyDetailView(client, WORKSPACE, "policy");

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: "policy", workspaceId: WORKSPACE } }));
    expect(result?.document).toBeNull();
  });

  it("uses the safe audit selector and never requests forensic hints", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const client = { auditRecord: { findMany } } as unknown as PersistenceClient;

    await loadAuditView(client, WORKSPACE, " policy ");

    const call = findMany.mock.calls[0]?.[0] as Readonly<{ select: Readonly<Record<string, boolean>>; where: unknown }>;
    expect(call.where).toEqual(expect.objectContaining({ workspaceOpaqueId: WORKSPACE }));
    expect(call.select).not.toHaveProperty("clientAddressHint");
    expect(call.select).not.toHaveProperty("userAgentHint");
  });

  it("targets run detail by workspace and omits stored signature material", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const client = { evidenceRun: { findFirst } } as unknown as PersistenceClient;

    await loadRunDetailView(client, WORKSPACE, "0198f150-7e30-7000-8000-000000000002");

    const call = findFirst.mock.calls[0]?.[0] as Readonly<{ select: Readonly<Record<string, boolean>>; where: unknown }>;
    expect(call.where).toEqual({ runId: "0198f150-7e30-7000-8000-000000000002", workspaceId: WORKSPACE });
    expect(call.select).not.toHaveProperty("signatureValue");
    expect(call.select).not.toHaveProperty("workspaceId");
  });


});

