import { fileURLToPath } from "node:url";

import type { RepositoryPolicy } from "@kernel-zero/profile-software-architecture";
import { describe, expect, it } from "vitest";

import { createRepositoryProgram, evaluatePolicyChecks } from "../engine";

const COMPILER_TEST_TIMEOUT_MS = 30_000;
const fixtureRoot = fileURLToPath(new URL("../../fixtures/kinds/", import.meta.url));
type Check = Extract<RepositoryPolicy["rules"][number]["check"], { kind: "require-call-argument" }>;

const FILE = "call-argument/queries.ts";
const SUBJECT = "call:db.policy.findMany:argument:0:where.workspaceId";

function evaluate(check: Partial<Check> = {}, level: "error" | "warning" = "error") {
  const repository = createRepositoryProgram({ rootPath: fixtureRoot, filePaths: [FILE] });
  return evaluatePolicyChecks({
    apiVersion: "kernel-zero.dev/v1",
    kind: "RepositoryPolicy",
    metadata: { name: "call-argument-test", revision: 1, description: "Call argument fixture policy" },
    scope: { languages: ["typescript"], include: ["**/*.ts"], exclude: [] },
    rules: [{
      id: "tenant-queries-carry-workspace",
      title: "Tenant queries carry the workspace",
      level,
      check: { kind: "require-call-argument", files: ["call-argument/**"], callee: ["db.policy.*"], argument: 0, requiredPath: "where.workspaceId", allowFrom: [], ...check },
      remediation: "Add where.workspaceId to the selector.",
    }],
  }, repository).map(({ messageCode, subject, path, location }) => [messageCode, subject, path, `${String(location.startLine)}:${String(location.startColumn)}-${String(location.endLine)}:${String(location.endColumn)}`]);
}

describe("require-call-argument", { timeout: COMPILER_TEST_TIMEOUT_MS }, () => {
  it("emits the exact finding matrix over the fixture in engine order", () => {
    expect(evaluate()).toEqual([
      ["CALL_ARGUMENT_MISSING", SUBJECT, FILE, "9:1-9:47"],
      ["CALL_ARGUMENT_UNPROVABLE", SUBJECT, FILE, "14:1-14:56"],
      ["CALL_ARGUMENT_UNPROVABLE", SUBJECT, FILE, "15:1-15:43"],
      ["CALL_ARGUMENT_MISSING", SUBJECT, FILE, "16:1-16:58"],
      ["CALL_ARGUMENT_UNPROVABLE", SUBJECT, FILE, "17:1-17:36"],
      ["CALL_ARGUMENT_UNPROVABLE", SUBJECT, FILE, "18:1-18:56"],
      ["CALL_ARGUMENT_MISSING", SUBJECT, FILE, "20:1-20:26"],
      ["CALL_ARGUMENT_UNRESOLVED", "call:db.policy.*:argument:0:where.workspaceId", FILE, "21:1-21:21"],
    ]);
  });

  it("skips allowFrom files and files outside the rule", () => {
    expect(evaluate({ allowFrom: ["call-argument/queries.ts"] })).toEqual([]);
    expect(evaluate({ files: ["elsewhere/**"] })).toEqual([]);
  });

  it("reports unresolved callees only at error level", () => {
    expect(evaluate({}, "warning").filter(([code]) => code === "CALL_ARGUMENT_UNRESOLVED")).toEqual([]);
    expect(evaluate({}, "warning")).toHaveLength(7);
  });

  it("carries the configured argument index and path into every subject", () => {
    const findings = evaluate({ callee: ["*.findMany"], argument: 1, requiredPath: "where" });
    expect(findings[0]).toEqual(["CALL_ARGUMENT_MISSING", "call:db.policy.findMany:argument:1:where", FILE, "8:1-8:47"]);
    expect(findings.filter(([, subject]) => subject === "call:db.other.findMany:argument:1:where")).toHaveLength(1);
    expect(findings.at(-1)).toEqual(["CALL_ARGUMENT_UNRESOLVED", "call:*.findMany:argument:1:where", FILE, "21:1-21:21"]);
  });
});
