import { describe, expect, it, vi } from "vitest";

import { PolicyService } from "./policy-service";

const policyDocument = {
  apiVersion: "kernel-zero.dev/v1",
  kind: "RepositoryPolicy",
  metadata: { description: "Repository architecture rules", name: "service-boundaries", revision: 1 },
  rules: [{
    check: { allowTypeOnly: false, files: ["**/*.ts"], kind: "require-import", module: "server-only" },
    id: "server-only",
    level: "error",
    remediation: "Import server-only.",
    title: "Server only",
  }],
  scope: { exclude: [], include: ["**/*.ts"], languages: ["typescript"] },
};

const command = { correlationId: "correlation", workspaceId: "workspace" };

describe("policy application service", () => {
  it("hands approval to persistence with the workspace scope", async () => {
    const approve = vi.fn().mockResolvedValue({ digest: "sha256:digest" });
    const service = new PolicyService({} as never, { approve } as never);
    await expect(service.approve({ correlationId: "correlation", revisionId: "revision", workspaceId: "workspace" })).resolves.toEqual({ digest: "sha256:digest" });
    expect(approve).toHaveBeenCalledWith(expect.anything(), { correlationId: "correlation", revisionId: "revision", workspaceId: "workspace" });
  });

  it("refuses to persist a document no registered profile accepts", async () => {
    const create = vi.fn();
    const save = vi.fn();
    const service = new PolicyService({} as never, { create, save } as never);
    await expect(service.create({ ...command, description: "d", displayName: "Policy", document: { ...policyDocument, kind: "MysteryPolicy" }, slug: "service-boundaries" })).rejects.toThrow("POLICY_INVALID");
    await expect(service.save({ ...command, document: { ...policyDocument, rules: [] }, packId: "pack" })).rejects.toThrow("POLICY_INVALID");
    expect(create).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("passes only the profile-parsed document to persistence", async () => {
    const create = vi.fn().mockResolvedValue({ packId: "pack", revisionId: "revision" });
    const service = new PolicyService({} as never, { create } as never);
    await service.create({ ...command, description: "d", displayName: "Policy", document: policyDocument, slug: "service-boundaries" });
    expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ document: policyDocument }));
  });

  it("diffs only documents that resolve to the same profile", () => {
    const service = new PolicyService({} as never, {} as never);
    const changed = { ...policyDocument, metadata: { ...policyDocument.metadata, revision: 2 }, rules: [{ ...policyDocument.rules[0], title: "Renamed" }] };
    expect(service.diff(policyDocument, changed)).toEqual([expect.objectContaining({ id: "server-only", status: "changed" })]);
    expect(() => service.diff(policyDocument, { ...policyDocument, kind: "MysteryPolicy" })).toThrow("POLICY_INVALID");
    expect(() => service.diff({ ...policyDocument, rules: [] }, policyDocument)).toThrow("POLICY_INVALID");
  });

  it("refuses to diff documents that resolve to different profiles", () => {
    const service = new PolicyService({} as never, {} as never);
    const manifestDocument = {
      apiVersion: "kernel-zero.dev/v1",
      kind: "ManifestPolicy",
      metadata: { description: "Manifest rules", name: "manifest-hygiene", revision: 1 },
      rules: [{
        check: { allowed: ["MIT"], kind: "allowed-licenses" },
        id: "license-allowlist",
        level: "error",
        remediation: "Use an approved license.",
        title: "Allowed licenses",
      }],
    };
    expect(() => service.diff(policyDocument, manifestDocument)).toThrow("POLICY_PROFILE_MISMATCH");
  });
});
