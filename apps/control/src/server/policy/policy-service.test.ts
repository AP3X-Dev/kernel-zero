import { describe, expect, it, vi } from "vitest";

import { PolicyService, policyRevisionActions } from "./policy-service";

const actor = (capabilities: string[], userId = "author") => ({
  capabilityDocument: { capabilities }, isOwner: false, userId,
});

describe("policy application service", () => {
  it("requires the closed capability at each command boundary", async () => {
    const approve = vi.fn();
    const service = new PolicyService({} as never, { approve } as never);
    await expect(service.approve({ actor: actor(["policy.read"]), correlationId: "correlation", revisionId: "revision", workspaceId: "workspace" })).rejects.toThrow("FORBIDDEN");
    expect(approve).not.toHaveBeenCalled();
  });

  it("authorizes approval and keeps the maker-checker predicate in persistence", async () => {
    const approve = vi.fn().mockResolvedValue({ digest: "sha256:digest" });
    const service = new PolicyService({} as never, { approve } as never);
    await expect(service.approve({ actor: actor(["policy.approve"], "checker"), correlationId: "correlation", revisionId: "revision", workspaceId: "workspace" })).resolves.toEqual({ digest: "sha256:digest" });
    expect(approve).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actorUserId: "checker" }));
  });

  it("never advertises approval to the revision author", () => {
    expect(policyRevisionActions(actor(["policy.approve"], "author"), "author")).toEqual({ canApprove: false });
    expect(policyRevisionActions(actor(["policy.approve"], "checker"), "author")).toEqual({ canApprove: true });
  });
});
