import { describe, expect, it, vi } from "vitest";

import type { PersistenceClient } from "@kernel-zero/persistence";

import {
  loadAuditView,
  loadPaymentEventsView,
  loadPoliciesView,
  loadPolicyCustodyView,
  loadPolicyDetailView,
  loadRunDetailView,
  loadSubscriptionView,
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

  it("keeps provider customer and subscription references out of the subscription view", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const client = { subscriptionProjection: { findUnique } } as unknown as PersistenceClient;

    await loadSubscriptionView(client, WORKSPACE);

    const call = findUnique.mock.calls[0]?.[0] as Readonly<{ select: Readonly<Record<string, boolean>>; where: unknown }>;
    expect(call.where).toEqual({ workspaceId: WORKSPACE });
    for (const field of ["customerId", "subscriptionId", "priceId"]) expect(call.select).not.toHaveProperty(field);
  });

  it("keeps raw payloads, replay fields, customer references, and workspace mapping out of operator rows", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const client = { paymentEventReceipt: { findMany } } as unknown as PersistenceClient;

    await loadPaymentEventsView(client, "quarantined");

    const call = findMany.mock.calls[0]?.[0] as Readonly<{ select: Readonly<Record<string, boolean>>; where: unknown }>;
    expect(call.where).toEqual({ state: "quarantined" });
    for (const field of ["payloadDigest", "replayFields", "workspaceId"]) expect(call.select).not.toHaveProperty(field);
  });
});

describe("policy custody read model", () => {
  it("returns workspace-scoped public key summaries and a trust bundle, or null with no keys", async () => {
    const findMany = vi.fn<(args: { select?: Record<string, unknown>; where: unknown }) => Promise<unknown[]>>().mockResolvedValue([]);
    const client = { policyAuthorityKey: { findMany } } as unknown as PersistenceClient;
    await expect(loadPolicyCustodyView(client, WORKSPACE)).resolves.toEqual({ bundle: null, keys: [] });
    for (const call of findMany.mock.calls) expect(call[0]).toMatchObject({ where: { workspaceId: WORKSPACE } });
    const row = { createdAt: new Date("2026-01-01T00:00:00.000Z"), id: "row", keyId: "authority-1", label: "Gate", publicKeyX: "A".repeat(43), revokedFrom: null, validFrom: new Date("2026-01-01T00:00:00.000Z"), validUntil: null };
    findMany.mockResolvedValue([row]);
    const view = await loadPolicyCustodyView(client, WORKSPACE);
    expect(view.keys[0]).toEqual(expect.objectContaining({ keyId: "authority-1" }));
    expect(findMany.mock.calls.some((call) => call[0].select !== undefined && !("publicKeyX" in call[0].select))).toBe(true);
    expect(view.bundle?.keys[0]?.x).toBe("A".repeat(43));
    expect(view.bundle?.revision).toBe(1);
  });
});
