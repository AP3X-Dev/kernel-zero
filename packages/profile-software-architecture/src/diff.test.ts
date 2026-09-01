import { describe, expect, it } from "vitest";

import { diffPolicyRules } from "./diff";
import type { RepositoryPolicy } from "./policy";

const policy = (revision = 1): RepositoryPolicy => ({
  apiVersion: "kernel-zero.dev/v1",
  kind: "RepositoryPolicy",
  metadata: { description: "Repository architecture rules", name: "service-boundaries", revision },
  rules: [{
    check: { allowTypeOnly: false, files: ["apps/**"], kind: "require-import", module: "server-only" },
    id: "rule-one",
    level: "error",
    remediation: "Add the import.",
    title: "Rule",
  }],
  scope: { exclude: [], include: ["apps/**/*.ts"], languages: ["typescript"] },
});

describe("diffPolicyRules", () => {
  it("diffs normalized rule IDs as added, changed, and removed", () => {
    const before = policy();
    const first = before.rules[0];
    if (first === undefined) throw new Error("Test fixture requires a rule.");
    const after = { ...policy(2), rules: [{ ...first, title: "Changed" }, { ...first, id: "rule-two" }] };
    expect(diffPolicyRules(before, after)).toEqual([
      expect.objectContaining({ id: "rule-one", status: "changed" }),
      expect.objectContaining({ id: "rule-two", status: "added" }),
    ]);
    expect(diffPolicyRules(after, { ...policy(3), rules: [] })).toEqual([
      expect.objectContaining({ id: "rule-one", status: "removed" }),
      expect.objectContaining({ id: "rule-two", status: "removed" }),
    ]);
  });
});
