import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { checkManifest, diffManifestRules, manifestFindingCompatibilityReason, manifestProfile, type ManifestPolicy } from "./index";

const digest = `sha256:${"1".repeat(64)}` as const;
const policy: ManifestPolicy = {
  apiVersion: "kernel-zero.dev/v1",
  kind: "ManifestPolicy",
  metadata: { description: "Manifest rules", name: "manifest-hygiene", revision: 1 },
  rules: [
    { check: { allowed: ["MIT"], kind: "allowed-licenses" }, id: "license-allowlist", level: "error", remediation: "Use an approved license.", title: "Allowed licenses" },
    { check: { fields: ["dependencies"], kind: "pinned-dependencies" }, id: "pin-deps", level: "error", remediation: "Pin exact versions.", title: "Pinned dependencies" },
  ],
};

function fixture(name: "pinned" | "unpinned"): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}/package.json`, import.meta.url), "utf8")) as unknown;
}

describe("manifestProfile", () => {
  it("declares its kinds and parses its own policy", () => {
    expect([manifestProfile.policyKind, manifestProfile.evidenceKind, manifestProfile.toolName]).toEqual(["ManifestPolicy", "ManifestEvidence", "kernel-zero-manifest"]);
    expect(manifestProfile.policySchema.safeParse(policy).success).toBe(true);
    expect(manifestProfile.policySchema.safeParse({ ...policy, extra: 1 }).success).toBe(false);
    expect(manifestProfile.policyJsonSchema()).toHaveProperty("properties");
    expect(manifestProfile.evidenceJsonSchema()).toHaveProperty("properties");
  });

  it("clears a compliant fixture and flags a non-compliant one", () => {
    expect(checkManifest({ manifest: fixture("pinned"), path: "package.json", policy, policyDigest: digest })).toEqual([]);
    const findings = checkManifest({ manifest: fixture("unpinned"), path: "package.json", policy, policyDigest: digest });
    expect(findings.map((finding) => finding.subject)).toEqual(["license:GPL-3.0", "dependencies:zod"]);
    for (const finding of findings) expect(manifestFindingCompatibilityReason(policy, finding)).toBeNull();
  });

  it("names the reason an incompatible finding is refused", () => {
    const [licenseFinding] = checkManifest({ manifest: fixture("unpinned"), path: "package.json", policy, policyDigest: digest });
    if (licenseFinding === undefined) throw new Error("Fixture must produce a finding.");
    expect(manifestFindingCompatibilityReason(policy, { ...licenseFinding, ruleId: "nope-rule" })).toBe("rule_not_found");
    expect(manifestFindingCompatibilityReason(policy, { ...licenseFinding, level: "warning" })).toBe("rule_level_mismatch");
    expect(manifestFindingCompatibilityReason(policy, { ...licenseFinding, messageCode: "DEPENDENCY_NOT_PINNED" })).toBe("rule_code_mismatch");
    expect(manifestFindingCompatibilityReason(policy, { ...licenseFinding, subject: "other" })).toBe("rule_subject_mismatch");
    expect(manifestFindingCompatibilityReason(policy, { ...licenseFinding, messageCode: "PARSE_FAILURE", subject: "parse" })).toBeNull();
    expect(manifestFindingCompatibilityReason(policy, { ...licenseFinding, messageCode: "PARSE_FAILURE" })).toBe("rule_code_mismatch");
  });

  it("refuses a forged violation naming a license the rule allows", () => {
    const [licenseFinding] = checkManifest({ manifest: fixture("unpinned"), path: "package.json", policy, policyDigest: digest });
    if (licenseFinding === undefined) throw new Error("Fixture must produce a finding.");
    expect(licenseFinding.subject).toBe("license:GPL-3.0");
    expect(manifestFindingCompatibilityReason(policy, licenseFinding)).toBeNull();
    expect(manifestFindingCompatibilityReason(policy, { ...licenseFinding, subject: "license:MIT" })).toBe("rule_subject_mismatch");
  });

  it("refuses a parse failure claimed against a warning rule", () => {
    const warningPolicy: ManifestPolicy = { ...policy, rules: policy.rules.map((rule) => ({ ...rule, level: "warning" as const })) };
    const findings = checkManifest({ manifest: "not-an-object", path: "package.json", policy, policyDigest: digest });
    const [parseFailure] = findings;
    if (parseFailure === undefined) throw new Error("A non-object manifest must produce a parse failure.");
    expect(manifestFindingCompatibilityReason(warningPolicy, { ...parseFailure, level: "warning" })).toBe("rule_code_mismatch");
  });

  it("diffs rules by identifier", () => {
    const [licenseRule] = policy.rules;
    if (licenseRule === undefined) throw new Error("Policy must declare the license rule.");
    const changed: ManifestPolicy = { ...policy, rules: [{ ...licenseRule, check: { allowed: ["MIT", "Apache-2.0"], kind: "allowed-licenses" } }] };
    expect(diffManifestRules(policy, changed).map((entry) => [entry.id, entry.status])).toEqual([
      ["license-allowlist", "changed"],
      ["pin-deps", "removed"],
    ]);
    expect(diffManifestRules(changed, policy).map((entry) => [entry.id, entry.status])).toEqual([
      ["license-allowlist", "changed"],
      ["pin-deps", "added"],
    ]);
    expect(diffManifestRules(policy, policy)).toEqual([]);
  });
});
