import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { walk } from "../ast";
import { createRepositoryProgram } from "../program";
import { chainMatches, couldMatchCallee, proveObjectPath, resolveCallChain, type PathProof } from "./argument-shape";

const COMPILER_TEST_TIMEOUT_MS = 30_000;
const PREAMBLE = `
  declare const db: { policy: { findMany(a: unknown): void }; other: { findMany(a: unknown): void } };
  declare const maybe: { policy: { findMany(a: unknown): void } } | undefined;
  declare function target(a?: unknown): void;
  declare function getDb(): typeof db;
  declare const workspaceId: string;
  declare const flag: boolean;
  declare const base: object;
  declare const key: string;
  declare const external: { where: { workspaceId: string } };
  export {};
`;

/** One program over `sources`, one file each; returns the call expressions of every file in source order. */
function compile(sources: readonly string[]) {
  const rootPath = mkdtempSync(path.join(tmpdir(), "kernel-zero-argument-shape-"));
  const filePaths = sources.map((_, index) => `case-${String(index)}.ts`);
  for (const [index, source] of sources.entries()) {
    writeFileSync(path.join(rootPath, filePaths[index] ?? ""), `${PREAMBLE}\n${source}\n`, "utf8");
  }
  const repository = createRepositoryProgram({ rootPath, filePaths });
  const checker = repository.program.getTypeChecker();
  const files = filePaths.map((filePath) => {
    const sourceFile = repository.sourceFiles.get(filePath);
    if (sourceFile === undefined) throw new Error("Fixture did not compile.");
    const calls: ts.CallExpression[] = [];
    walk(sourceFile, (node) => {
      if (ts.isCallExpression(node)) calls.push(node);
    });
    return { calls, sourceFile };
  });
  return { checker, files };
}

/** Proves `dotted` on the first argument of the last `target(...)` call of each source. */
function proveEach(sources: readonly string[], dotted = "where.workspaceId"): PathProof[] {
  const { checker, files } = compile(sources);
  return files.map(({ calls, sourceFile }) => {
    const call = calls.filter((candidate) => ts.isIdentifier(candidate.expression) && candidate.expression.text === "target").at(-1);
    if (call === undefined) throw new Error("No target call in fixture.");
    return proveObjectPath(call.arguments[0], dotted.split("."), checker, sourceFile);
  });
}

function kinds(sources: readonly string[], dotted?: string): string[] {
  return proveEach(sources, dotted).map((proof) => (proof.kind === "unprovable" ? `unprovable:${proof.reason}` : proof.kind));
}

describe("proveObjectPath", { timeout: COMPILER_TEST_TIMEOUT_MS }, () => {
  it("proves present leaves and reports string-literal and template values", () => {
    expect(proveEach([
      'target({ where: { workspaceId: "ws" } });',
      "target({ where: { workspaceId: `ws` } });",
      "target({ where: { workspaceId } });",
      'target({ where: { ["workspaceId"]: workspaceId } });',
      "target({ where: { workspaceId: 1 } } as const);",
    ])).toMatchObject([
      { kind: "present", literal: "ws" },
      { kind: "present", literal: "ws" },
      { kind: "present", literal: undefined },
      { kind: "present", literal: undefined },
      { kind: "present", literal: undefined },
    ]);
    expect(kinds(["target({ where: { workspaceId } });"], "where")).toEqual(["present"]);
  });

  it("reports missing for an absent argument, an absent key, undefined, and void 0", () => {
    expect(kinds([
      "target();",
      "target({ where: { status: 1 } });",
      "target({ take: 1 });",
      "target({ where: { workspaceId: undefined } });",
      "target({ where: { workspaceId: void 0 } });",
    ])).toEqual(["missing", "missing", "missing", "missing", "missing"]);
  });

  it("reports not-literal for calls, conditionals in the key position, non-object initializers, and non-const bindings", () => {
    expect(kinds([
      "target(getDb());",
      "target({ where: flag ? { workspaceId } : { workspaceId } });",
      "target(flag ? { where: { workspaceId } } : { where: { workspaceId } });",
      "target({ where: 1 });",
      "target(external);",
      "let selector = { where: { workspaceId } }; target(selector);",
      "target({ where() { return 1; } });",
      "const selector = flag ? { where: { workspaceId } } : {}; target(selector);",
    ])).toEqual(Array.from({ length: 8 }, () => "unprovable:not-literal"));
  });

  it("follows same-file const bindings, shorthand members, and Object.freeze wrappers", () => {
    expect(kinds([
      "const selector = { where: { workspaceId } }; target(selector);",
      "const selector = { where: { workspaceId } } as const; target((selector));",
      "const where = { workspaceId }; target({ where });",
      "const where = { status: 1 }; target({ where });",
      "target(Object.freeze({ where: Object.freeze({ workspaceId }) }));",
      "const selector = Object.freeze({ where: { workspaceId } }); target(selector);",
      "const inner = { workspaceId }; const selector = { where: inner }; target(selector);",
    ])).toEqual(["present", "present", "present", "missing", "present", "present", "present"]);
  });

  it("reports a cycle when const bindings refer to each other", () => {
    expect(kinds(["const a: unknown = b; const b: unknown = a; target(a);"])).toEqual(["unprovable:cycle"]);
  });

  it("reports computed for a non-literal computed key at the searched level", () => {
    expect(kinds([
      "target({ where: { [key]: 1, workspaceId } });",
      "target({ [key]: 1, where: { workspaceId } });",
    ])).toEqual(["unprovable:computed", "unprovable:computed"]);
  });

  it("treats spreads before the key as harmless and opaque spreads after it as unprovable", () => {
    expect(kinds([
      "target({ where: { ...base, workspaceId } });",
      "target({ where: { workspaceId, ...base } });",
      "target({ where: { ...base } });",
      "target({ ...base, where: { workspaceId } });",
      "target({ where: { workspaceId }, ...base });",
    ])).toEqual(["present", "unprovable:spread", "unprovable:spread", "present", "unprovable:spread"]);
  });

  it("accepts harmless spreads after the key: literals and conditionals of literals without the key at their top level", () => {
    expect(kinds([
      "target({ where: { workspaceId, ...(flag ? {} : { status: 1 }) } });",
      "target({ where: { workspaceId, ...{ status: 1 } } });",
      "target({ where: { workspaceId, ...(flag ? {} : { generatedAt: { ...base, ...base } }) } });",
      "target({ where: { workspaceId, ...(flag ? {} : { other() { return 1; }, get more() { return 1; } }) } });",
    ])).toEqual(["present", "present", "present", "present"]);
  });

  it("rejects spreads after the key whose operand may author the key", () => {
    expect(kinds([
      "target({ where: { workspaceId, ...(flag ? {} : { workspaceId: 1 }) } });",
      "target({ where: { workspaceId, ...(flag ? {} : { workspaceId() { return 1; } }) } });",
      "target({ where: { workspaceId, ...(flag ? {} : { get workspaceId() { return 1; } }) } });",
      "target({ where: { workspaceId, ...(flag ? {} : { ...base }) } });",
      "target({ where: { workspaceId, ...(flag ? {} : { [key]: 1 }) } });",
      "target({ where: { workspaceId, ...(flag ? base : {}) } });",
    ])).toEqual(Array.from({ length: 6 }, () => "unprovable:spread"));
  });
});

describe("resolveCallChain, chainMatches, and couldMatchCallee", { timeout: COMPILER_TEST_TIMEOUT_MS }, () => {
  it("resolves textual chains and judges the raw innermost receiver", () => {
    const { checker, files } = compile([`
      db.policy.findMany({});
      (db as any).policy.findMany({});
      maybe?.policy.findMany({});
      db["policy"].findMany({});
      const alias = db.policy.findMany;
      alias({});
      getDb().policy.findMany({}); // the outer call is unresolvable; the inner getDb() call resolves to its identifier
      db[key].findMany({});
    `]);
    const calls = files[0]?.calls ?? [];
    expect(calls.map((call) => resolveCallChain(call, checker))).toEqual([
      { chain: "db.policy.findMany", unsafeReceiver: false },
      { chain: "db.policy.findMany", unsafeReceiver: true },
      { chain: "maybe.policy.findMany", unsafeReceiver: true },
      { chain: "db.policy.findMany", unsafeReceiver: false },
      { chain: "alias", unsafeReceiver: false },
      undefined,
      { chain: "getDb", unsafeReceiver: false },
      undefined,
    ]);
  });

  it("matches chains against callee globs where * spans dots", () => {
    expect(chainMatches("db.policy.findMany", ["*.findMany"])).toBe(true);
    expect(chainMatches("db.policy.findMany", ["db.policy.*"])).toBe(true);
    expect(chainMatches("db.other.findMany", ["db.policy.*", "*.findFirst"])).toBe(false);
    expect(chainMatches("findMany", ["*.findMany"])).toBe(false);
  });

  it("names an unresolved callee only when both ends of a glob agree", () => {
    const { files } = compile([`
      db[key].findMany({});
      getDb().policy.findMany({});
      target({});
    `]);
    const [elementAccess, callRoot, , identifier] = files[0]?.calls ?? [];
    if (elementAccess === undefined || callRoot === undefined || identifier === undefined) throw new Error("Expected three calls.");
    expect(couldMatchCallee(elementAccess, ["other.*", "*.findFirst", "db.*"])).toBe("db.*");
    expect(couldMatchCallee(elementAccess, ["*.findMany"])).toBe("*.findMany");
    expect(couldMatchCallee(elementAccess, ["db.policy.findMany"])).toBe("db.policy.findMany");
    expect(couldMatchCallee(elementAccess, ["*.findFirst"])).toBeUndefined();
    expect(couldMatchCallee(elementAccess, ["other.findMany"])).toBeUndefined();
    expect(couldMatchCallee(callRoot, ["*.findMany"])).toBe("*.findMany");
    expect(couldMatchCallee(callRoot, ["db.findMany"])).toBeUndefined();
    expect(couldMatchCallee(identifier, ["*"])).toBeUndefined();
  });
});
