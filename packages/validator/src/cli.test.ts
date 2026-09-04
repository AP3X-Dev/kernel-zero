import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { CliUsageError, isDirectExecution, parseCliArguments, runCli } from "./cli";

const WORKSPACE = "0195f000-0000-7000-8000-000000000002";

async function validatorWorkspace(): Promise<Readonly<{ policy: string; root: string; out: string }>> {
  const root = await mkdtemp(path.join(tmpdir(), "kernel-zero-cli-"));
  const policy = path.join(root, "policy.json");
  const out = path.join(root, "results", "validation.json");
  await writeFile(policy, "{}", "utf8");
  return { policy, root, out };
}

describe("validator CLI", () => {
  it("recognizes direct execution through a package-manager symlink", () => {
    const filesystemRoot = path.parse(process.cwd()).root;
    const modulePath = path.join(filesystemRoot, "installed", "package", "dist", "kernel-zero.js");
    const binPath = path.join(filesystemRoot, "installed", ".bin", "kernel-zero");
    const resolveRealPath = vi.fn((candidate: string) => {
      if (candidate === binPath) return modulePath;
      return candidate;
    });

    expect(isDirectExecution(
      pathToFileURL(modulePath).href,
      binPath,
      resolveRealPath,
    )).toBe(true);
    expect(isDirectExecution(
      pathToFileURL(modulePath).href,
      path.join(filesystemRoot, "installed", "other.js"),
      resolveRealPath,
    )).toBe(false);
    expect(isDirectExecution(pathToFileURL(modulePath).href, undefined, resolveRealPath)).toBe(false);
  });

  it("parses the exact validate command and optional exception bundle", () => {
    expect(parseCliArguments([
      "validate",
      "--policy", "policy.json",
      "--root", ".",
      "--workspace", WORKSPACE,
      "--out", "result.json",
      "--exceptions", "exceptions.json",
      "--exceptions-trust-key", "exception-key.jwk",
    ])).toEqual({
      command: "validate",
      exceptions: "exceptions.json",
      exceptionsTrustKey: "exception-key.jwk",
      out: "result.json",
      policy: "policy.json",
      root: ".",
      workspace: WORKSPACE,
    });
  });

  it("reserves the exact exception export spelling without adding authority flags", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(parseCliArguments(["exceptions", "export", "--policy-digest", digest, "--out", "bundle.json"])).toEqual({
      command: "exceptions-export",
      out: "bundle.json",
      policyDigest: digest,
    });
    expect(() => parseCliArguments(["exceptions", "export", "--policy-digest", "invalid", "--out", "bundle.json"]))
      .toThrowError("Option --policy-digest requires a canonical SHA-256 digest");
    expect(() => parseCliArguments(["exceptions", "export", "--policy-digest", digest, "--out", "bundle.json", "--workspace", WORKSPACE]))
      .toThrowError("Unknown option --workspace");
  });

  it.each([
    [[], "Expected the validate command"],
    [["scan"], "Expected the validate command"],
    [["validate", "policy.json"], "Unexpected positional argument: policy.json"],
    [["validate", "--root", ".", "--policy", "p.json", "--workspace", WORKSPACE], "Missing required option --out"],
    [["validate", "--root", ".", "--policy", "p.json", "--workspace", WORKSPACE, "--out", "r.json", "--wat"], "Unknown option --wat"],
    [["validate", "--root", ".", "--root", "elsewhere", "--policy", "p.json", "--workspace", WORKSPACE, "--out", "r.json"], "Duplicate option --root"],
    [["validate", "--root", ".", "--policy", "--workspace", WORKSPACE, "--out", "r.json"], "Option --policy requires a value"],
    [["validate", "--root", ".", "--policy", "p.json", "--workspace", "not-a-uuid", "--out", "r.json"], "Option --workspace requires a lowercase UUIDv7"],
    [["validate", "--root", ".", "--policy", "p.json", "--workspace", WORKSPACE, "--out", "r.json", "--exceptions", "bundle.json"], "Options --exceptions and --exceptions-trust-key must be supplied together"],
  ])("rejects malformed arguments %#", (argv, message) => {
    expect(() => parseCliArguments(argv)).toThrowError(new CliUsageError(message));
  });

  it.each([
    ["pass", 0],
    ["violations", 1],
    ["error", 2],
  ] as const)("maps %s validation outcomes to exit code %i", async (outcome, exitCode) => {
    const workspace = await validatorWorkspace();
    const execute = vi.fn().mockResolvedValue({ outcome });

    await expect(runCli([
      "validate",
      "--policy", workspace.policy,
      "--root", workspace.root,
      "--workspace", WORKSPACE,
      "--out", workspace.out,
    ], execute)).resolves.toBe(exitCode);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({
      command: "validate",
      out: workspace.out,
      policy: workspace.policy,
      root: workspace.root,
      workspace: WORKSPACE,
    });
  });

  it("returns exit code 2 for usage, containment, and executor failures", async () => {
    const workspace = await validatorWorkspace();
    const outside = await mkdtemp(path.join(tmpdir(), "kernel-zero-outside-"));
    const outsidePolicy = path.join(outside, "policy.json");
    await writeFile(outsidePolicy, "{}", "utf8");
    const execute = vi.fn().mockRejectedValue(new Error("validator failed"));

    await expect(runCli([], execute)).resolves.toBe(2);
    await expect(runCli([
      "validate", "--policy", outsidePolicy, "--root", workspace.root, "--workspace", WORKSPACE, "--out", workspace.out,
    ], execute)).resolves.toBe(2);
    await expect(runCli([
      "validate", "--policy", workspace.policy, "--root", workspace.root, "--workspace", WORKSPACE, "--out", workspace.out,
    ], execute)).resolves.toBe(2);
  });

  it("accepts a contained output whose parent directories do not exist", async () => {
    const workspace = await validatorWorkspace();
    await mkdir(path.join(workspace.root, "existing"));
    const out = path.join(workspace.root, "existing", "missing", "result.json");
    const execute = vi.fn().mockResolvedValue({ outcome: "pass" });

    await expect(runCli([
      "validate", "--policy", workspace.policy, "--root", workspace.root, "--workspace", WORKSPACE, "--out", out,
    ], execute)).resolves.toBe(0);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ out }));
  });

  it.each(["bundle.json", "../bundle.json", "C:\\outside\\bundle.json", "linked/bundle.json"])(
    "returns the reserved export boundary without resolving or touching output %s",
    async (out) => {
      const execute = vi.fn().mockResolvedValue({ outcome: "pass" });
      const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const digest = `sha256:${"a".repeat(64)}`;
      await expect(runCli(["exceptions", "export", "--policy-digest", digest, "--out", out], execute)).resolves.toBe(2);
      expect(execute).not.toHaveBeenCalled();
      expect(write).toHaveBeenCalledWith("kernel-zero: EXPORT_UNAVAILABLE: authenticated export and signing-key custody are not configured\n");
      write.mockRestore();
    },
  );

  it("leaves an existing reserved export output byte-for-byte untouched", async () => {
    const workspace = await validatorWorkspace();
    await mkdir(path.dirname(workspace.out), { recursive: true });
    await writeFile(workspace.out, "preserve-me\n", "utf8");
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(runCli([
      "exceptions", "export", "--policy-digest", `sha256:${"b".repeat(64)}`, "--out", workspace.out,
    ], vi.fn())).resolves.toBe(2);
    expect(await readFile(workspace.out, "utf8")).toBe("preserve-me\n");
    write.mockRestore();
  });
});
