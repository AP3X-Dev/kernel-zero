import { describe, expect, it, vi } from "vitest";

import { canonicalJson, canonicalSha256 } from "@kernel-zero/domain";
import type { PersistenceClient } from "@kernel-zero/persistence";

import { createEvidenceRepository } from "./persistence-adapter";

const policy = {
  apiVersion: "kernel-zero.dev/v1" as const,
  kind: "RepositoryPolicy" as const,
  metadata: { description: "Adapter test policy", name: "adapter-policy", revision: 1 },
  rules: [{
    check: { allowTypeOnly: false, files: ["src/**/*.ts"], kind: "require-import" as const, module: "server-only" },
    id: "server-only",
    level: "error" as const,
    remediation: "Add the server-only marker.",
    title: "Server boundary",
  }],
  scope: { exclude: [], include: ["src/**/*.ts"], languages: ["typescript" as const] },
};

describe("evidence persistence adapter", () => {
  it("resolves only tenant-contained approved policy bytes through the strict contract", async () => {
    const digest = canonicalSha256(policy);
    const findFirst = vi.fn().mockResolvedValue({ canonicalJson: canonicalJson(policy), digest, state: "approved" });
    const repository = createEvidenceRepository({ policyRevision: { findFirst } } as unknown as PersistenceClient);

    await expect(repository.resolveApprovedPolicy({ digest, workspaceId: "workspace" })).resolves.toEqual({ digest, document: policy, state: "approved" });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { digest, state: { in: ["approved", "active"] }, workspaceId: "workspace" },
    }));
  });

  it("returns stored bytes for the profile registry to validate and fails closed on unreadable JSON", async () => {
    const digest = canonicalSha256(policy);
    const stored = createEvidenceRepository({
      policyRevision: { findFirst: vi.fn().mockResolvedValue({ canonicalJson: "{}", digest, state: "active" }) },
    } as unknown as PersistenceClient);
    await expect(stored.resolveApprovedPolicy({ digest, workspaceId: "workspace" })).resolves.toEqual({ digest, document: {}, state: "active" });

    const unreadable = createEvidenceRepository({
      policyRevision: { findFirst: vi.fn().mockResolvedValue({ canonicalJson: "not json", digest, state: "active" }) },
    } as unknown as PersistenceClient);
    await expect(unreadable.resolveApprovedPolicy({ digest, workspaceId: "workspace" })).rejects.toThrow();
  });

  it("uses tenant-scoped selectors for signing keys and current grants", async () => {
    const keyLookup = vi.fn().mockResolvedValue({ publicKey: "public-key" });
    const grantLookup = vi.fn().mockResolvedValue([]);
    const repository = createEvidenceRepository({
      exceptionRequest: { findMany: grantLookup },
      signingKey: { findFirst: keyLookup },
    } as unknown as PersistenceClient);

    await expect(repository.findActiveSigningKey({ keyId: "key", workspaceId: "workspace" })).resolves.toBe("public-key");
    await expect(repository.findCurrentExceptions({ exceptionIds: ["two", "one"], workspaceId: "workspace" })).resolves.toEqual([]);
    expect(keyLookup).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true, keyId: "key", workspaceId: "workspace" } }));
    expect(grantLookup).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["two", "one"] }, workspaceId: "workspace" } }));
  });
});
