import { deriveEvidenceSummary } from "@kernel-zero/contracts";
import { describe, expect, it } from "vitest";

import { checkPython } from "./check";
import type { PythonFileFacts } from "./facts";
import { pythonFindingCompatibilityReason } from "./index";
import { PythonPolicySchema, type PythonPolicy } from "./policy";

const digest = `sha256:${"1".repeat(64)}` as const;
const location = Object.freeze({ endColumn: 10, endLine: 4, startColumn: 1, startLine: 4 });

function policy(): PythonPolicy {
  return PythonPolicySchema.parse({
    apiVersion: "kernel-zero.dev/v1",
    kind: "PythonPolicy",
    metadata: { description: "Python architecture rules", name: "python-rules", revision: 1 },
    scope: { exclude: [], include: ["src/**/*.py"] },
    rules: [
      { check: { deny: ["subprocess"], from: ["src/api/**/*.py"], kind: "forbid-import-edge" }, id: "deny-process", level: "error", remediation: "Use the worker boundary.", title: "No processes" },
      { check: { files: ["src/api/**/*.py"], kind: "require-import", module: "json" }, id: "require-json", level: "error", remediation: "Import json.", title: "JSON required" },
      { check: { allowFrom: ["src/workers/**/*.py"], callee: ["os.system", "subprocess.run"], kind: "restrict-call-site" }, id: "restrict-calls", level: "warning", remediation: "Call from a worker.", title: "Restricted calls" },
      { check: { files: ["src/api/**/*.py"], kind: "require-context-parameter", parameter: "workspace_id", symbols: "*" }, id: "workspace-context", level: "error", remediation: "Require workspace_id.", title: "Workspace context" },
    ],
  });
}

function violatingFacts(): PythonFileFacts {
  return {
    calls: [{ callee: "os.system", location }],
    functions: [{ location, name: "Handler.run", parameters: [{ kind: "keyword-only", name: "workspace_id", required: false }] }],
    imports: [{ module: "subprocess.asyncio", location }],
    parseError: null,
    path: "src/api/handler.py",
  };
}

describe("PythonPolicy", () => {
  it("strictly parses the closed rule kinds and rejects unknown fields", () => {
    const current = policy();
    const contextRule = current.rules.find((rule) => rule.check.kind === "require-context-parameter");
    if (contextRule === undefined) throw new Error("Expected the context fixture rule.");
    expect(current.kind).toBe("PythonPolicy");
    expect(PythonPolicySchema.parse({ ...current, rules: [{ ...contextRule, check: { ...contextRule.check, symbols: "*.run" } }] }).rules[0]?.check.kind).toBe("require-context-parameter");
    expect(() => PythonPolicySchema.parse({ ...current, command: "python arbitrary.py" })).toThrow();
    expect(() => PythonPolicySchema.parse({ ...current, rules: [{ ...current.rules[0], check: { kind: "made-up" } }] })).toThrow();
    expect(() => PythonPolicySchema.parse({ ...current, scope: { include: ["../escape.py"], exclude: [] } })).toThrow();
    expect(() => PythonPolicySchema.parse({ ...current, rules: current.rules.map((rule) => ({ ...rule, level: "warning" })) })).toThrow(/error-level/u);
  });
});

describe("checkPython", () => {
  it("reports every closed violation with stable subjects and compatibility", () => {
    const current = policy();
    const findings = checkPython({ files: [violatingFacts()], policy: current, policyDigest: digest });
    expect(findings.map((finding) => [finding.ruleId, finding.messageCode, finding.subject])).toEqual([
      ["deny-process", "PYTHON_IMPORT_DENIED", "module:subprocess.asyncio"],
      ["require-json", "PYTHON_IMPORT_REQUIRED", "module:json"],
      ["restrict-calls", "PYTHON_CALL_RESTRICTED", "call:os.system"],
      ["workspace-context", "PYTHON_CONTEXT_PARAMETER_REQUIRED", "symbol:Handler.run:parameter:workspace_id"],
    ]);
    expect(findings.every((finding) => pythonFindingCompatibilityReason(current, finding) === null)).toBe(true);
    expect(deriveEvidenceSummary(findings, 1).status).toBe("fail");
  });

  it("accepts descendant imports, required positional and keyword-only context, and allowed call locations", () => {
    const current = policy();
    const files: PythonFileFacts[] = [
      {
        calls: [],
        functions: [{ location, name: "handler", parameters: [{ kind: "positional-only", name: "workspace_id", required: true }] }],
        imports: [{ module: "json.tool", location }],
        parseError: null,
        path: "src/api/handler.py",
      },
      {
        calls: [{ callee: "os.system", location }],
        functions: [],
        imports: [],
        parseError: null,
        path: "src/workers/job.py",
      },
    ];
    expect(checkPython({ files, policy: current, policyDigest: digest })).toEqual([]);
  });

  it("turns one claimed syntax failure into a non-exceptable error and is deterministic across file order", () => {
    const current = policy();
    const broken: PythonFileFacts = { calls: [], functions: [], imports: [], parseError: location, path: "src/api/broken.py" };
    const first = checkPython({ files: [violatingFacts(), broken], policy: current, policyDigest: digest });
    const second = checkPython({ files: [broken, violatingFacts()], policy: current, policyDigest: digest });
    expect(first).toEqual(second);
    const parse = first.find((finding) => finding.messageCode === "PARSE_FAILURE");
    expect(parse).toMatchObject({ exceptionId: null, level: "error", subject: "parse" });
    expect(deriveEvidenceSummary(first, 2).status).toBe("error");
  });

  it("rejects stale or semantically incompatible findings", () => {
    const current = policy();
    const finding = checkPython({ files: [violatingFacts()], policy: current, policyDigest: digest })[0];
    expect(finding).toBeDefined();
    if (finding === undefined) return;
    expect(pythonFindingCompatibilityReason(current, { ...finding, subject: "module:json" })).toBe("rule_subject_mismatch");
    expect(pythonFindingCompatibilityReason(current, { ...finding, ruleId: "missing" })).toBe("rule_not_found");
  });
});
