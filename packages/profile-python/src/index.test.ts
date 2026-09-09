import { describe, expect, it } from "vitest";

import { diffPythonRules, pythonProfile, type PythonPolicy } from "./index";

const policy: PythonPolicy = {
  apiVersion: "kernel-zero.dev/v1",
  kind: "PythonPolicy",
  metadata: { description: "Python profile contract", name: "python-profile", revision: 1 },
  scope: { exclude: [], include: ["src/**/*.py"] },
  rules: [{
    check: { deny: ["subprocess"], from: ["src/**/*.py"], kind: "forbid-import-edge" },
    id: "no-processes",
    level: "error",
    remediation: "Use a worker boundary.",
    title: "No processes",
  }],
};

describe("pythonProfile", () => {
  it("publishes unique stable profile identities and JSON schemas", () => {
    expect([pythonProfile.policyKind, pythonProfile.evidenceKind, pythonProfile.toolName]).toEqual([
      "PythonPolicy",
      "PythonEvidence",
      "kernel-zero-python",
    ]);
    expect(pythonProfile.policyJsonSchema()).toMatchObject({ type: "object" });
    expect(pythonProfile.evidenceJsonSchema()).toMatchObject({ type: "object" });
  });

  it("diffs added, changed, and removed rules by stable rule id", () => {
    const baseRule = policy.rules[0];
    if (baseRule === undefined) throw new Error("Expected the fixture rule.");
    const changed: PythonPolicy = {
      ...policy,
      rules: [
        { ...baseRule, level: "warning" },
        { check: { files: ["src/**/*.py"], kind: "require-import", module: "typing" }, id: "typing-required", level: "error", remediation: "Import typing.", title: "Typing required" },
      ],
    };
    expect(diffPythonRules(policy, changed).map((item) => [item.id, item.status])).toEqual([
      ["no-processes", "changed"],
      ["typing-required", "added"],
    ]);
    expect(diffPythonRules(changed, policy).map((item) => [item.id, item.status])).toEqual([
      ["no-processes", "changed"],
      ["typing-required", "removed"],
    ]);
  });
});
