import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runCli } from "./cli";
import { CommandError, explain, init, parseExplainArguments, parseInitArguments, scaffoldTargets } from "./commands";
import { RENDER_LIMIT, renderEvidence } from "./render";

const EXAMPLES = path.resolve(process.cwd(), "docs", "contracts", "examples");
const WORKSPACE = "0195f000-0000-7000-8000-000000000002";

describe("explain", () => {
  it("parses exactly one artifact option", () => {
    expect(parseExplainArguments(["--policy", "p.json"])).toEqual({ command: "explain", artifact: "p.json", kind: "policy" });
    expect(() => parseExplainArguments([])).toThrowError(CommandError);
    expect(() => parseExplainArguments(["--policy", "p.json", "--evidence", "e.json"])).toThrowError("exactly one");
    expect(() => parseExplainArguments(["--root", "."])).toThrowError("Unknown option --root");
  });

  it("renders the canonical policy and evidence examples deterministically", async () => {
    expect(await explain({ command: "explain", artifact: path.join(EXAMPLES, "repository-policy-v1.json"), kind: "policy" })).toBe([
      "policy service-boundaries revision 1: 1 rules",
      "error layers-no-ui-db (forbid-import-edge): UI cannot import persistence",
      "  remediation: Call an application service through a validated boundary.",
      "",
    ].join("\n"));
    expect(await explain({ command: "explain", artifact: path.join(EXAMPLES, "repository-evidence-v1.json"), kind: "evidence" })).toBe([
      "kernel-zero: fail (1 errors, 0 warnings, 0 excepted, 42 files)",
      "error layers-no-ui-db apps/control/ui/page.tsx:8:1 DENIED_IMPORT @prisma/client",
      "",
    ].join("\n"));
    const twice = await explain({ command: "explain", artifact: path.join(EXAMPLES, "repository-evidence-v1.json"), kind: "evidence" });
    expect(twice).toBe(await explain({ command: "explain", artifact: path.join(EXAMPLES, "repository-evidence-v1.json"), kind: "evidence" }));
  });

  it("rejects malformed artifacts, unknown kinds, and mismatched kinds without rendering", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kernel-zero-explain-"));
    const broken = path.join(root, "broken.json");
    await writeFile(broken, "{ nope", "utf8");
    await expect(explain({ command: "explain", artifact: broken, kind: "policy" })).rejects.toThrow(/readable JSON/u);
    const unknownKind = path.join(root, "unknown.json");
    await writeFile(unknownKind, JSON.stringify({ apiVersion: "kernel-zero.dev/v1", kind: "ManifestPolicy", metadata: { name: "manifest-hygiene", revision: 1, description: "x" }, rules: [{ check: { kind: "allowed-licenses", allowed: ["MIT"] }, id: "allowed-license", level: "error", remediation: "x", title: "x" }] }), "utf8");
    await expect(explain({ command: "explain", artifact: unknownKind, kind: "policy" })).rejects.toThrow(/RepositoryPolicy only/u);
    await expect(explain({ command: "explain", artifact: path.join(EXAMPLES, "repository-policy-v1.json"), kind: "evidence" })).rejects.toThrow(/evidence contract/u);
    const unknownCode = JSON.parse(await readFile(path.join(EXAMPLES, "repository-evidence-v1.json"), "utf8")) as { findings: { messageCode: string }[] };
    unknownCode.findings[0] = { ...unknownCode.findings[0], messageCode: "TOTALLY_MADE_UP" };
    const badCode = path.join(root, "bad-code.json");
    await writeFile(badCode, JSON.stringify(unknownCode), "utf8");
    await expect(explain({ command: "explain", artifact: badCode, kind: "evidence" })).rejects.toThrow(/RepositoryEvidence contract/u);
    await expect(explain({ command: "explain", artifact: path.join(EXAMPLES, "manifest-evidence-v1.json"), kind: "evidence" })).rejects.toThrow(/RepositoryEvidence only/u);
  });

  it("bounds rendered findings and keeps ordering stable", () => {
    const finding = { exceptionId: null, level: "error" as const, location: { endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 }, messageCode: "DENIED_IMPORT", path: "src/a.ts", ruleId: "rule-a", subject: "x" };
    const findings = Array.from({ length: RENDER_LIMIT + 5 }, (_, index) => ({ ...finding, location: { ...finding.location, startLine: index + 1 } }));
    const rendered = renderEvidence({ findings, result: { durationMs: 1, errors: findings.length, excepted: 0, filesScanned: 1, status: "fail", warnings: 0 } }, new Map([["rule-a", "Fix it."]]));
    const lines = rendered.trimEnd().split("\n");
    expect(lines).toHaveLength(1 + RENDER_LIMIT * 2 + 1);
    expect(lines.at(-1)).toBe("  ... 5 more findings in the evidence artifact");
    expect(lines[1]).toBe("error rule-a src/a.ts:1:1 DENIED_IMPORT x");
    expect(lines[2]).toBe("  remediation: Fix it.");
  });
});

describe("init", () => {
  it("parses root and workspace with safe defaults", () => {
    expect(parseInitArguments([])).toEqual({ command: "init", root: ".", workspace: "00000000-0000-7000-8000-000000000000" });
    expect(parseInitArguments(["--root", "consumer", "--workspace", WORKSPACE])).toEqual({ command: "init", root: "consumer", workspace: WORKSPACE });
    expect(() => parseInitArguments(["--workspace", "nope"])).toThrowError("lowercase UUIDv7");
    expect(() => parseInitArguments(["--force"])).toThrowError("Unknown option --force");
  });

  it("scaffolds an empty consumer, prints the authority snippet, and refuses every overwrite afterwards", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kernel-zero-init-"));
    const output = await init({ command: "init", root, workspace: WORKSPACE });
    expect(output).toContain("kernel-zero init wrote:");
    expect(output).toContain(`--workspace ${WORKSPACE}`);
    expect(output).toContain("@kernel-zero/validator@0.3.0");
    expect(output).toContain("## KERNEL ZERO enforcement");
    const written = await Promise.all(scaffoldTargets(root).map(async (target) => readFile(path.join(root, ...target.relative.split("/")), "utf8")));
    expect(written).toEqual(scaffoldTargets(root).map((target) => target.content));
    expect(JSON.parse(written[0] ?? "")).toMatchObject({ kind: "RepositoryPolicy" });
    if (process.platform !== "win32") {
      expect((await stat(path.join(root, ".githooks", "pre-commit"))).mode & 0o111).toBe(0o111);
    }

    await writeFile(path.join(root, "kernel-zero.policy.json"), "custom\n", "utf8");
    await expect(init({ command: "init", root, workspace: WORKSPACE })).rejects.toThrow(/refuses to overwrite existing files: kernel-zero.policy.json, .githooks\/pre-commit, .github\/workflows\/kernel-zero.yml/u);
    expect(await readFile(path.join(root, "kernel-zero.policy.json"), "utf8")).toBe("custom\n");
  });

  it("refuses when only one target conflicts and leaves the others uncreated", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kernel-zero-init-conflict-"));
    await writeFile(path.join(root, "kernel-zero.policy.json"), "{}", "utf8");
    await expect(init({ command: "init", root, workspace: WORKSPACE })).rejects.toThrow(/kernel-zero.policy.json$/u);
    await expect(readFile(path.join(root, ".githooks", "pre-commit"), "utf8")).rejects.toBeDefined();
  });
});

describe("cli integration for explain, init, and rendered validation output", () => {
  it("routes explain and init to exit 0 with stdout, and usage errors to exit 2", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(runCli(["explain", "--policy", path.join(EXAMPLES, "repository-policy-v1.json")], vi.fn())).resolves.toBe(0);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("policy service-boundaries revision 1"));
    const root = await mkdtemp(path.join(tmpdir(), "kernel-zero-init-cli-"));
    await expect(runCli(["init", "--root", root], vi.fn())).resolves.toBe(0);
    await expect(runCli(["init", "--root", root], vi.fn())).resolves.toBe(2);
    await expect(runCli(["explain", "--policy", path.join(root, "missing.json")], vi.fn())).resolves.toBe(2);
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it("prints rendered findings after validate when the executor returns evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kernel-zero-render-cli-"));
    const policy = path.join(root, "policy.json");
    await writeFile(policy, "{}", "utf8");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const execute = vi.fn().mockResolvedValue({
      outcome: "violations",
      evidence: { findings: [{ exceptionId: null, level: "error", location: { endColumn: 2, endLine: 3, startColumn: 1, startLine: 3 }, messageCode: "DENIED_IMPORT", path: "src/a.ts", ruleId: "rule-a", subject: "x" }], result: { durationMs: 1, errors: 1, excepted: 0, filesScanned: 1, status: "fail", warnings: 0 } },
      policy: { rules: [{ id: "rule-a", remediation: "Fix it." }] },
    });
    await expect(runCli(["validate", "--policy", policy, "--root", root, "--workspace", WORKSPACE, "--out", path.join(root, "out.json")], execute)).resolves.toBe(1);
    expect(stdout).toHaveBeenCalledWith("kernel-zero: fail (1 errors, 0 warnings, 0 excepted, 1 files)\nerror rule-a src/a.ts:3:1 DENIED_IMPORT x\n  remediation: Fix it.\n");
    stdout.mockRestore();
  });
});
