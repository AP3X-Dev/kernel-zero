import { deriveEvidenceSummary } from "@kernel-zero/contracts";
import { describe, expect, it } from "vitest";

import { checkWorkflows } from "./check";
import { workflowFindingCompatibilityReason } from "./index";
import type { WorkflowPolicy } from "./policy";

function unreachable(): never {
  throw new Error("Expected at least one finding.");
}

const digest = `sha256:${"1".repeat(64)}` as const;
const sha = "a".repeat(40);
const path = ".github/workflows/ci.yml";

function policyWith(mode: "sha" | "tag", allowWrite: string[] = []): WorkflowPolicy {
  return {
    apiVersion: "kernel-zero.dev/v1",
    kind: "WorkflowPolicy",
    metadata: { description: "Workflow hygiene rules", name: "workflow-hygiene", revision: 1 },
    scope: { include: [".github/workflows/*.yml"] },
    rules: [
      { check: { kind: "pinned-actions", mode }, id: "pinned-actions", level: "error", remediation: "Pin every action reference.", title: "Actions are pinned" },
      { check: { allowWrite, kind: "restricted-permissions" }, id: "least-privilege", level: "error", remediation: "Declare least-privilege permissions.", title: "Least privilege" },
    ],
  };
}

function check(text: string, policy: WorkflowPolicy = policyWith("sha")) {
  return checkWorkflows({ files: [{ path, text }], policy, policyDigest: digest });
}

function reported(text: string, policy?: WorkflowPolicy) {
  return check(text, policy).map((finding) => [finding.ruleId, finding.messageCode, finding.subject]);
}

const pinned = [
  "name: CI",
  "on: push",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  build:",
  "    steps:",
  `      - uses: actions/checkout@${sha}`,
  "",
].join("\n");

describe("checkWorkflows", () => {
  it("passes a sha-pinned workflow with read permissions", () => {
    expect(check(pinned)).toEqual([]);
    expect(deriveEvidenceSummary(check(pinned), 1).status).toBe("pass");
  });

  it("reports an action that is not pinned to a commit sha", () => {
    const text = pinned.replace(`actions/checkout@${sha}`, "actions/checkout@v4");
    expect(reported(text)).toEqual([["pinned-actions", "ACTION_NOT_PINNED", "action:actions/checkout@v4"]]);
    expect(check(text)[0]?.location).toEqual({ endColumn: 1, endLine: 8, startColumn: 1, startLine: 8 });
    expect(check(text)[0]?.path).toBe(path);
  });

  it("accepts a tag reference in tag mode and still refuses a missing ref", () => {
    const tagged = pinned.replace(`actions/checkout@${sha}`, "actions/checkout@v4");
    expect(reported(tagged, policyWith("tag"))).toEqual([]);
    const bare = pinned.replace(`actions/checkout@${sha}`, "actions/checkout");
    expect(reported(bare, policyWith("tag"))).toEqual([["pinned-actions", "ACTION_NOT_PINNED", "action:actions/checkout"]]);
  });

  it("refuses an uppercase 40-hex ref, because commit shas are lowercase hex", () => {
    const text = pinned.replace(`actions/checkout@${sha}`, `actions/checkout@${sha.toUpperCase()}`);
    expect(reported(text)).toEqual([["pinned-actions", "ACTION_NOT_PINNED", `action:actions/checkout@${sha.toUpperCase()}`]]);
    expect(reported(text, policyWith("tag"))).toEqual([]);
  });

  it("skips local and docker action references in both modes", () => {
    for (const uses of ["./.github/actions/setup", "docker://alpine:3.20"]) {
      const text = pinned.replace(`actions/checkout@${sha}`, uses);
      expect(reported(text)).toEqual([]);
      expect(reported(text, policyWith("tag"))).toEqual([]);
    }
  });

  it("reports a workflow with no top-level permissions", () => {
    const text = pinned.replace("permissions:\n  contents: read\n", "");
    expect(reported(text)).toEqual([["least-privilege", "PERMISSIONS_MISSING", "permissions:top-level"]]);
    expect(check(text)[0]?.location.startLine).toBe(1);
  });

  it("reports write-all and unlisted write scopes, and clears listed ones", () => {
    const writeAll = pinned.replace("permissions:\n  contents: read", "permissions: write-all");
    expect(reported(writeAll)).toEqual([["least-privilege", "PERMISSION_TOO_BROAD", "permissions:all:write-all"]]);

    const writes = pinned.replace("  contents: read", "  contents: write\n  issues: write");
    expect(reported(writes)).toEqual([
      ["least-privilege", "PERMISSION_TOO_BROAD", "permissions:contents:write"],
      ["least-privilege", "PERMISSION_TOO_BROAD", "permissions:issues:write"],
    ]);
    expect(reported(writes, policyWith("sha", ["contents", "issues"]))).toEqual([]);
    expect(reported(writes, policyWith("sha", ["contents"]))).toEqual([
      ["least-privilege", "PERMISSION_TOO_BROAD", "permissions:issues:write"],
    ]);
  });

  it("reports a single parse failure for unparseable or non-object YAML", () => {
    for (const text of ["a:\n  - b\n  c: d\n", "just a scalar", "- a\n- b\n"]) {
      const findings = check(text);
      expect(findings.map((finding) => [finding.ruleId, finding.messageCode, finding.subject, finding.level])).toEqual([
        ["pinned-actions", "PARSE_FAILURE", "parse", "error"],
      ]);
      expect(workflowFindingCompatibilityReason(policyWith("sha"), findings[0] ?? unreachable())).toBeNull();
      expect(deriveEvidenceSummary(findings, 1).status).toBe("error");
    }
  });

  it("keeps the on key a string under the YAML 1.2 core schema", () => {
    expect(check("on: push\npermissions:\n  contents: read\njobs: {}\n")).toEqual([]);
  });

  it("is deterministic across key order and reports each file", () => {
    // Flow mappings keep both scopes on one line, so only the parsed key order differs; a block
    // mapping would move lines, and findings are ordered by line on purpose.
    const a = check("permissions: {issues: write, contents: write}\njobs: {}\n");
    const b = check("permissions: {contents: write, issues: write}\njobs: {}\n");
    expect(a.map((finding) => finding.subject)).toEqual(b.map((finding) => finding.subject));
    expect(a.map((finding) => finding.id)).toEqual(b.map((finding) => finding.id));
    expect([...a].map((finding) => finding.subject).sort()).toEqual(["permissions:contents:write", "permissions:issues:write"]);

    const both = checkWorkflows({
      files: [
        { path: ".github/workflows/b.yml", text: "jobs: {}\n" },
        { path: ".github/workflows/a.yml", text: "jobs: {}\n" },
      ],
      policy: policyWith("sha"),
      policyDigest: digest,
    });
    expect(both.map((finding) => finding.path)).toEqual([".github/workflows/a.yml", ".github/workflows/b.yml"]);
  });

  it("reports every unpinned step in a multi-step workflow once per distinct reference", () => {
    const text = [
      "permissions:",
      "  contents: read",
      "jobs:",
      "  build:",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: actions/setup-node@v4",
      "      - uses: actions/checkout@v4",
      "",
    ].join("\n");
    expect(reported(text)).toEqual([
      ["pinned-actions", "ACTION_NOT_PINNED", "action:actions/checkout@v4"],
      ["pinned-actions", "ACTION_NOT_PINNED", "action:actions/setup-node@v4"],
    ]);
  });
});
