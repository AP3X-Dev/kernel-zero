import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  BUILT_IN_ROLE_CAPABILITIES,
  BUILT_IN_ROLE_LABELS,
  CAPABILITIES,
  CUSTOM_ROLE_CAPABILITIES,
  DEFAULT_ROLE_PROFILE_LABELS,
  effectiveCapabilities,
  flattenCapabilityGroups,
  groupCapabilities,
  hasCapability,
  isCapability,
  isReservedRoleLabel,
  resolveStoredRoleDocument,
  validateCustomRoleCapabilityDocument,
  validateCustomRoleLabel,
  type Capability,
} from "./authorization";

describe("closed capability vocabulary and built-in roles", () => {
  it("contains exactly the capabilities named by the authorization matrix", () => {
    expect(CAPABILITIES).toEqual([
      "workspace.read",
      "workspace.update",
      "workspace.delete",
      "workspace.transfer",
      "member.read",
      "member.invite",
      "member.update",
      "member.remove",
      "role.read",
      "role.manage",
      "policy.read",
      "policy.write",
      "policy.approve",
      "policy.activate",
      "policy.retire",
      "evidence.read",
      "evidence.submit",
      "evidence.signing-key.manage",
      "exception.read",
      "exception.request",
      "exception.decide",
      "exception.revoke",
      "billing.read",
      "billing.manage",
      "audit.read",
    ]);
    expect(new Set(CAPABILITIES)).toHaveProperty("size", CAPABILITIES.length);
    expect(isCapability("policy.read")).toBe(true);
    expect(isCapability("policy.publish")).toBe(false);
    expect(isCapability({ capability: "policy.read" })).toBe(false);
  });

  it("implements the exact built-in role capability matrix", () => {
    expect(BUILT_IN_ROLE_CAPABILITIES.owner).toEqual(CAPABILITIES);
    expect(BUILT_IN_ROLE_CAPABILITIES.administrator).toEqual(
      CAPABILITIES.filter(
        (capability) => capability !== "workspace.delete" && capability !== "workspace.transfer",
      ),
    );
    expect(BUILT_IN_ROLE_CAPABILITIES.policy_author).toEqual([
      "workspace.read",
      "member.read",
      "role.read",
      "policy.read",
      "policy.write",
      "evidence.read",
      "evidence.submit",
      "exception.read",
      "exception.request",
    ]);
    expect(BUILT_IN_ROLE_CAPABILITIES.reviewer).toEqual([
      "workspace.read",
      "member.read",
      "role.read",
      "policy.read",
      "policy.approve",
      "evidence.read",
      "exception.read",
      "exception.request",
      "exception.decide",
      "audit.read",
    ]);
    expect(BUILT_IN_ROLE_CAPABILITIES.observer).toEqual([
      "workspace.read",
      "policy.read",
      "evidence.read",
      "exception.read",
      "audit.read",
    ]);
    expect(DEFAULT_ROLE_PROFILE_LABELS).toEqual([
      "administrator",
      "policy_author",
      "reviewer",
      "observer",
    ]);
    expect(DEFAULT_ROLE_PROFILE_LABELS).not.toContain("owner");
  });

  it("reserves every built-in label case-insensitively", () => {
    for (const label of BUILT_IN_ROLE_LABELS) {
      expect(isReservedRoleLabel(label)).toBe(true);
      expect(isReservedRoleLabel(`  ${label.toUpperCase()}  `)).toBe(true);
      expect(validateCustomRoleLabel(label).ok).toBe(false);
      expect(validateCustomRoleLabel(label.toUpperCase()).ok).toBe(false);
    }
    expect(validateCustomRoleLabel("Policy Analyst")).toEqual({
      ok: true,
      value: { displayLabel: "Policy Analyst", normalizedLabel: "policy analyst" },
    });
  });
});

describe("custom-role validation and quarantine", () => {
  it("accepts only a strict document composed from the custom-role vocabulary", () => {
    expect(
      validateCustomRoleCapabilityDocument({
        capabilities: ["workspace.read", "policy.write", "audit.read"],
      }),
    ).toEqual({
      ok: true,
      value: { capabilities: ["workspace.read", "policy.write", "audit.read"] },
    });

    for (const invalid of [
      { capabilities: ["unknown.read"] },
      { capabilities: ["workspace.delete"] },
      { capabilities: ["workspace.transfer"] },
      { capabilities: ["workspace.read", "workspace.read"] },
      { capabilities: [1] },
      { capabilities: "workspace.read" },
      { capabilities: [], unexpected: true },
      [],
      null,
    ]) {
      expect(validateCustomRoleCapabilityDocument(invalid).ok).toBe(false);
    }
  });

  it("quarantines an invalid stored document and grants nothing without partial recovery", () => {
    const unknown = resolveStoredRoleDocument({
      capabilities: ["policy.read", "future.capability"],
    });
    expect(unknown).toEqual({
      capabilities: [],
      quarantineReasons: ["capability_unknown"],
      quarantineState: "quarantined",
    });
    expect(hasCapability({ isOwner: false, role: unknown }, "policy.read")).toBe(false);

    const ownerOnly = resolveStoredRoleDocument({
      capabilities: ["policy.read", "workspace.delete"],
    });
    expect(ownerOnly.quarantineState).toBe("quarantined");
    expect(effectiveCapabilities({ isOwner: false, role: ownerOnly })).toEqual([]);
  });

  it("resolves valid stored documents and preserves an intentionally empty custom role", () => {
    const valid = resolveStoredRoleDocument({ capabilities: ["policy.read", "audit.read"] });
    expect(valid).toEqual({
      capabilities: ["policy.read", "audit.read"],
      quarantineReasons: [],
      quarantineState: "valid",
    });
    expect(hasCapability({ isOwner: false, role: valid }, "policy.read")).toBe(true);
    expect(hasCapability({ isOwner: false, role: valid }, "policy.write")).toBe(false);
    expect(resolveStoredRoleDocument({ capabilities: [] }).quarantineState).toBe("valid");
  });

  it("derives owner full access only from the separate owner flag", () => {
    const quarantined = resolveStoredRoleDocument({ capabilities: ["workspace.delete"] });
    expect(quarantined.quarantineState).toBe("quarantined");

    const owner = { isOwner: true } as const;
    expect(effectiveCapabilities(owner)).toEqual(CAPABILITIES);
    for (const capability of CAPABILITIES) expect(hasCapability(owner, capability)).toBe(true);

    const administrator = resolveStoredRoleDocument({
      capabilities: BUILT_IN_ROLE_CAPABILITIES.administrator,
    });
    expect(hasCapability({ isOwner: false, role: administrator }, "workspace.delete")).toBe(false);
    expect(hasCapability({ isOwner: false, role: administrator }, "workspace.transfer")).toBe(false);
  });
});

describe("capability grouping", () => {
  it("flattens all groups to the exact canonical vocabulary", () => {
    expect(flattenCapabilityGroups(groupCapabilities(CAPABILITIES))).toEqual(CAPABILITIES);
  });

  it("round-trips every capability subset in canonical order", () => {
    fc.assert(
      fc.property(fc.subarray([...CAPABILITIES]), (subset) => {
        const expected = CAPABILITIES.filter((capability) =>
          new Set<Capability>(subset).has(capability),
        );
        expect(flattenCapabilityGroups(groupCapabilities(subset))).toEqual(expected);
      }),
    );
  });

  it("excludes the two owner-only capabilities from every custom role", () => {
    expect(CUSTOM_ROLE_CAPABILITIES).not.toContain("workspace.delete");
    expect(CUSTOM_ROLE_CAPABILITIES).not.toContain("workspace.transfer");
    expect(CUSTOM_ROLE_CAPABILITIES).toHaveLength(CAPABILITIES.length - 2);
  });
});
