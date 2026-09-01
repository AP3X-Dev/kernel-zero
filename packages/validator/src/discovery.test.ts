import { createHash } from "node:crypto";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DiscoveryError,
  createManifestDigestInput,
  discoverTypeScriptSources,
  normalizeRelativePath,
  resolveValidatorPaths,
} from "./discovery";

const WORKSPACE = "0195f000-0000-7000-8000-000000000002";

async function write(root: string, relativePath: string, contents: string | Buffer): Promise<void> {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

describe("safe deterministic discovery", () => {
  it("discovers included TypeScript and TSX in normalized path order while applying excludes and fixed ignores", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kernel-zero-discovery-"));
    await write(root, "z/root.ts", "export const z = 1;\n");
    await write(root, "a/view.tsx", "export const View = () => null;\n");
    await write(root, "a/ignore.generated.ts", "ignored\n");
    await write(root, "a/plain.js", "ignored\n");
    await write(root, "node_modules/pkg/index.ts", "ignored\n");
    await write(root, "dist/output.ts", "ignored\n");
    await write(root, ".git/internal.ts", "ignored\n");

    const result = await discoverTypeScriptSources({
      exclude: ["**/*.generated.ts"],
      include: ["**/*.ts", "**/*.tsx"],
      languages: ["typescript", "tsx"],
      root,
    });

    expect(result.files.map((file) => file.path)).toEqual(["a/view.tsx", "z/root.ts"]);
    expect(result.files.every((file) => path.isAbsolute(file.absolutePath))).toBe(true);
  });

  it("hashes raw bytes and produces path-digest manifest inputs without decoding source", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kernel-zero-bytes-"));
    const raw = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0x00]);
    await write(root, "raw.ts", raw);

    const result = await discoverTypeScriptSources({
      exclude: [], include: ["**/*.ts"], languages: ["typescript"], root,
    });
    const expectedDigest = `sha256:${createHash("sha256").update(raw).digest("hex")}`;

    expect(result.files[0]?.bytes).toEqual(raw);
    expect(result.files[0]?.digest).toBe(expectedDigest);
    expect(createManifestDigestInput(result.files)).toEqual([{ path: "raw.ts", digest: expectedDigest }]);
  });

  it("normalizes only contained relative paths to POSIX form", () => {
    expect(normalizeRelativePath("src\\nested\\file.ts")).toBe("src/nested/file.ts");
    expect(() => normalizeRelativePath("../escape.ts")).toThrowError(DiscoveryError);
    expect(() => normalizeRelativePath("/absolute.ts")).toThrowError(DiscoveryError);
    expect(() => normalizeRelativePath("C:\\absolute.ts")).toThrowError(DiscoveryError);
  });

  it("rejects policy and output paths outside the requested root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kernel-zero-contained-"));
    const outside = await mkdtemp(path.join(tmpdir(), "kernel-zero-external-"));
    await write(root, "policy.json", "{}");
    await write(outside, "policy.json", "{}");

    await expect(resolveValidatorPaths({
      out: path.join(root, "result.json"), policy: path.join(outside, "policy.json"), root, workspace: WORKSPACE,
    })).rejects.toThrowError(DiscoveryError);
    await expect(resolveValidatorPaths({
      out: path.join(outside, "result.json"), policy: path.join(root, "policy.json"), root, workspace: WORKSPACE,
    })).rejects.toThrowError(DiscoveryError);
  });

  it("resolves a paired exception bundle and trust key only when both stay contained", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kernel-zero-trust-root-"));
    const outside = await mkdtemp(path.join(tmpdir(), "kernel-zero-trust-outside-"));
    await write(root, "policy.json", "{}");
    await write(root, "bundle.json", "{}");
    await write(root, "trust.jwk", "{}");
    await write(outside, "trust.jwk", "{}");

    const resolved = await resolveValidatorPaths({
      exceptions: path.join(root, "bundle.json"),
      exceptionsTrustKey: path.join(root, "trust.jwk"),
      out: path.join(root, "result.json"),
      policy: path.join(root, "policy.json"),
      root,
      workspace: WORKSPACE,
    });
    expect(resolved.exceptionsTrustKey).toBe(path.join(root, "trust.jwk"));
    await expect(resolveValidatorPaths({
      exceptions: path.join(root, "bundle.json"),
      exceptionsTrustKey: path.join(outside, "trust.jwk"),
      out: path.join(root, "result.json"),
      policy: path.join(root, "policy.json"),
      root,
      workspace: WORKSPACE,
    })).rejects.toThrowError(DiscoveryError);
  });

  it("rejects a traversed directory symlink or junction that escapes the requested root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kernel-zero-symlink-root-"));
    const outside = await mkdtemp(path.join(tmpdir(), "kernel-zero-symlink-outside-"));
    await write(outside, "escaped.ts", "export const escaped = true;\n");
    await symlink(outside, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");

    await expect(discoverTypeScriptSources({
      exclude: [], include: ["**/*.ts"], languages: ["typescript"], root,
    })).rejects.toThrowError(/escapes the repository root/u);
  });

  it("rejects unsupported or unsafe glob syntax", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kernel-zero-globs-"));
    await expect(discoverTypeScriptSources({
      exclude: [], include: ["../**/*.ts"], languages: ["typescript"], root,
    })).rejects.toThrowError(DiscoveryError);
    await expect(discoverTypeScriptSources({
      exclude: [], include: ["src/[ab].ts"], languages: ["typescript"], root,
    })).rejects.toThrowError(/Unsupported glob syntax/u);
  });
});
