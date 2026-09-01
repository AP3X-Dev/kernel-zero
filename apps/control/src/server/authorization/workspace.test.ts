import { describe, expect, it } from "vitest";

import { requireCapability, workspaceAuthority } from "./workspace";

describe("workspace authorization", () => {
  it("gives owner authority only from the owner flag", () => {
    expect(requireCapability({ capabilityDocument: null, isOwner: true }, "workspace.delete")).toBeNull();
    expect(requireCapability({ capabilityDocument: { capabilities: ["workspace.delete"] }, isOwner: false }, "workspace.delete")?.code).toBe("FORBIDDEN");
  });

  it("fails closed for malformed stored role documents", () => {
    const authority = workspaceAuthority({
      capabilityDocument: { capabilities: ["policy.read", "unknown.future"] },
      isOwner: false,
    });
    expect(authority.isOwner).toBe(false);
    expect(requireCapability({ capabilityDocument: { capabilities: ["policy.read", "unknown.future"] }, isOwner: false }, "policy.read")?.code).toBe("FORBIDDEN");
  });
});
