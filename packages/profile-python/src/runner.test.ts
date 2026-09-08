import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PythonEvidenceSchema } from "./evidence";
import { runPythonValidation } from "./runner";

const WORKSPACE = "0195f000-0000-7000-8000-000000000002";

function testPolicy() {
  return {
    apiVersion: "kernel-zero.dev/v1",
    kind: "PythonPolicy",
    metadata: { description: "Python runner test", name: "python-runner", revision: 1 },
    scope: { exclude: [], include: ["src/**/*.py"] },
    rules: [
      { check: { deny: ["subprocess"], from: ["src/**/*.py"], kind: "forbid-import-edge" }, id: "deny-process", level: "error", remediation: "Use a worker.", title: "No processes" },
      { check: { allowFrom: [], callee: ["eval", "subprocess.run"], kind: "restrict-call-site" }, id: "deny-run", level: "error", remediation: "Use a worker.", title: "No dynamic or process calls" },
      { check: { files: ["src/**/*.py"], kind: "require-context-parameter", parameter: "workspace_id", symbols: "handler" }, id: "workspace-context", level: "error", remediation: "Require workspace context.", title: "Workspace context" },
    ],
  };
}

async function workspace(source: string) {
  const root = await mkdtemp(path.join(tmpdir(), "kernel-zero-python-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "python-policy.json"), `${JSON.stringify(testPolicy(), null, 2)}\n`, "utf8"),
    writeFile(path.join(root, "src", "handler.py"), source, "utf8"),
  ]);
  return root;
}

describe("Python profile runner", () => {
  it("uses CPython AST, resolves import aliases, and reproduces its canonical digest", async () => {
    const root = await workspace("import json as codec\n\ndef handler(workspace_id, /):\n    return codec.dumps({'ok': True})\n\nclass Service:\n    async def handler(self, *, workspace_id):\n        return codec.dumps({'workspace': workspace_id})\n");
    const first = path.join(root, ".kernel-zero", "first.json");
    const second = path.join(root, ".kernel-zero", "second.json");
    expect(runPythonValidation({ out: first, policy: "python-policy.json", root, workspace: WORKSPACE })).toBe(0);
    expect(runPythonValidation({ out: second, policy: "python-policy.json", root, workspace: WORKSPACE })).toBe(0);
    const left = PythonEvidenceSchema.parse(JSON.parse(await readFile(first, "utf8")) as unknown);
    const right = PythonEvidenceSchema.parse(JSON.parse(await readFile(second, "utf8")) as unknown);
    expect(left.integrity.digest).toBe(right.integrity.digest);
    expect(left.tool.version).toMatch(/^0\.1\.0\+cpython\.3\.(?:11|12|13|14)\.\d+$/u);
    expect(JSON.stringify(left)).not.toContain("codec.dumps");
  });

  it("reports denied aliased imports, resolved calls, and optional context as definite violations", async () => {
    const root = await workspace("import subprocess as sp\n\ndef handler(workspace_id=None):\n    return sp.run(['true'])\n");
    const out = path.join(root, "evidence.json");
    expect(runPythonValidation({ out, policy: "python-policy.json", root, workspace: WORKSPACE })).toBe(1);
    const evidence = PythonEvidenceSchema.parse(JSON.parse(await readFile(out, "utf8")) as unknown);
    expect(evidence.findings.map((finding) => [finding.messageCode, finding.subject])).toEqual([
      ["PYTHON_IMPORT_DENIED", "module:subprocess"],
      ["PYTHON_CALL_RESTRICTED", "call:subprocess.run"],
      ["PYTHON_CONTEXT_PARAMETER_REQUIRED", "symbol:handler:parameter:workspace_id"],
    ]);
  });

  it.skipIf(Number(execFileSync(process.env.KERNEL_ZERO_PYTHON ?? "python", ["-c", "import sys; print(sys.version_info.minor)"], { encoding: "utf8" }).trim()) < 12)("blocks restricted calls in generic class type parameters", async () => {
    const root = await workspace("class Service[T: eval('class-bound')]:\n    pass\n");
    const out = path.join(root, "evidence.json");
    expect(runPythonValidation({ out, policy: "python-policy.json", root, workspace: WORKSPACE })).toBe(1);
    const evidence = PythonEvidenceSchema.parse(JSON.parse(await readFile(out, "utf8")) as unknown);
    expect(evidence.findings.map((finding) => [finding.messageCode, finding.subject])).toEqual([
      ["PYTHON_CALL_RESTRICTED", "call:eval"],
    ]);
  });

  it("fails closed on Python syntax errors", async () => {
    const root = await workspace("def broken(:\n    pass\n");
    const out = path.join(root, "evidence.json");
    expect(runPythonValidation({ out, policy: "python-policy.json", root, workspace: WORKSPACE })).toBe(2);
    const evidence = PythonEvidenceSchema.parse(JSON.parse(await readFile(out, "utf8")) as unknown);
    expect(evidence).toMatchObject({ result: { status: "error" }, findings: [{ exceptionId: null, messageCode: "PARSE_FAILURE", subject: "parse" }] });
  });

  it("fails when no configured Python runtime can start", async () => {
    const root = await workspace("def handler(workspace_id):\n    return workspace_id\n");
    const previous = process.env.KERNEL_ZERO_PYTHON;
    process.env.KERNEL_ZERO_PYTHON = path.join(root, "missing-python");
    try {
      expect(() => runPythonValidation({ out: "evidence.json", policy: "python-policy.json", root, workspace: WORKSPACE })).toThrow(/No supported CPython/u);
    } finally {
      if (previous === undefined) delete process.env.KERNEL_ZERO_PYTHON;
      else process.env.KERNEL_ZERO_PYTHON = previous;
    }
  });

  it("rejects invalid workspace, escaping output, and input-output collisions before analysis", async () => {
    const root = await workspace("def handler(workspace_id):\n    return workspace_id\n");
    expect(() => runPythonValidation({ out: "evidence.json", policy: "python-policy.json", root, workspace: "not-a-workspace" })).toThrow(/UUIDv7/u);
    expect(() => runPythonValidation({ out: "../evidence.json", policy: "python-policy.json", root, workspace: WORKSPACE })).toThrow(/escapes/u);
    expect(() => runPythonValidation({ out: "python-policy.json", policy: "python-policy.json", root, workspace: WORKSPACE })).toThrow(/collides/u);
    expect(() => runPythonValidation({ out: "src/handler.py", policy: "python-policy.json", root, workspace: WORKSPACE })).toThrow(/collides/u);
  });
});
