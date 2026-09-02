import { deriveEvidenceSummary } from "@kernel-zero/contracts";
import { describe, expect, it } from "vitest";

import { checkManifest } from "./check";
import { manifestFindingCompatibilityReason } from "./index";
import type { ManifestPolicy } from "./policy";

function unreachable(): never {
  throw new Error("Expected at least one finding.");
}

const digest = `sha256:${"1".repeat(64)}` as const;
const policy: ManifestPolicy = {
  apiVersion: "kernel-zero.dev/v1",
  kind: "ManifestPolicy",
  metadata: { description: "Manifest rules", name: "manifest-hygiene", revision: 1 },
  rules: [
    { check: { allowed: ["MIT", "Apache-2.0"], kind: "allowed-licenses" }, id: "license-allowlist", level: "error", remediation: "Use an approved license.", title: "Allowed licenses" },
    { check: { fields: ["dependencies"], kind: "pinned-dependencies" }, id: "pin-deps", level: "error", remediation: "Pin exact versions.", title: "Pinned dependencies" },
  ],
};

describe("checkManifest", () => {
  it("passes a pinned MIT manifest", () => {
    const manifest = { dependencies: { zod: "4.1.0" }, license: "MIT" };
    expect(checkManifest({ manifest, path: "package.json", policy, policyDigest: digest })).toEqual([]);
  });

  it("reports unpinned ranges and disallowed licenses", () => {
    const manifest = { dependencies: { zod: "^4.1.0" }, license: "GPL-3.0" };
    const findings = checkManifest({ manifest, path: "package.json", policy, policyDigest: digest });
    expect(findings.map((finding) => [finding.ruleId, finding.messageCode, finding.subject])).toEqual([
      ["license-allowlist", "LICENSE_NOT_ALLOWED", "license:GPL-3.0"],
      ["pin-deps", "DEPENDENCY_NOT_PINNED", "dependencies:zod"],
    ]);
  });

  it("reports a single parse failure for a manifest that is not an object", () => {
    for (const manifest of ["not-json-object", 42, null, ["dependencies"]]) {
      const findings = checkManifest({ manifest, path: "package.json", policy, policyDigest: digest });
      expect(findings.map((finding) => [finding.ruleId, finding.messageCode, finding.subject, finding.level])).toEqual([
        ["license-allowlist", "PARSE_FAILURE", "parse", "error"],
      ]);
      expect(manifestFindingCompatibilityReason(policy, findings[0] ?? unreachable())).toBeNull();
      expect(deriveEvidenceSummary(findings, 1).status).toBe("error");
    }
  });

  it("is deterministic across key order", () => {
    const a = checkManifest({ manifest: { dependencies: { a: "^1", b: "^1" }, license: "MIT" }, path: "package.json", policy, policyDigest: digest });
    const b = checkManifest({ manifest: { license: "MIT", dependencies: { b: "^1", a: "^1" } }, path: "package.json", policy, policyDigest: digest });
    expect(a).toEqual(b);
    expect(a.map((finding) => finding.subject).sort()).toEqual(["dependencies:a", "dependencies:b"]);
  });
});
