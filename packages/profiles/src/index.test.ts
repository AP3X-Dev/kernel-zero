import { describe, expect, it } from "vitest";

import { PROFILES, parsePolicyDocument, profileForPolicyKind } from "./index";

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

describe("profile registry", () => {
  it("has unique policy kinds, evidence kinds and tool names", () => {
    for (const key of ["policyKind", "evidenceKind", "toolName"] as const) {
      expect(new Set(PROFILES.map((profile) => profile[key])).size).toBe(PROFILES.length);
    }
  });

  it("resolves a profile by policy kind and refuses unknown kinds", () => {
    expect(profileForPolicyKind("RepositoryPolicy")?.toolName).toBe("kernel-zero-validator");
    expect(profileForPolicyKind("ManifestPolicy")?.toolName).toBe("kernel-zero-manifest");
    expect(profileForPolicyKind("PythonPolicy")?.toolName).toBe("kernel-zero-python");
    expect(profileForPolicyKind("WorkflowPolicy")?.toolName).toBe("kernel-zero-workflow");
    expect(profileForPolicyKind("NopePolicy")).toBeNull();
  });

  it("parses a full policy document through its profile", () => {
    const parsed = parsePolicyDocument(policyDocument);
    expect(parsed?.profile.policyKind).toBe("RepositoryPolicy");
    expect(parsed?.policy.metadata.name).toBe("service-boundaries");
    expect(parsePolicyDocument({ ...policyDocument, kind: "MysteryPolicy" })).toBeNull();
    expect(parsePolicyDocument({ ...policyDocument, rules: undefined })).toBeNull();
    expect(parsePolicyDocument({ kind: "RepositoryPolicy" })).toBeNull();
  });
});
