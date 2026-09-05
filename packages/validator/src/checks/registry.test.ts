import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RepositoryPolicy } from "@kernel-zero/profile-software-architecture";
import { describe, expect, it } from "vitest";

import { createRepositoryProgram, evaluatePolicyChecks } from "../engine";

const COMPILER_TEST_TIMEOUT_MS = 30_000;
type Check = Extract<RepositoryPolicy["rules"][number]["check"], { kind: "require-closed-registry" }>;

const DECLARE = 'declare function defineTool(id: string, metadata?: object): unknown;\n';
const META = '{ classification: "read", authority: "workspace", approval: "none" }';

function evaluate(files: Readonly<Record<string, string>>, check: Partial<Check> = {}) {
  const rootPath = mkdtempSync(path.join(tmpdir(), "kernel-zero-registry-"));
  mkdirSync(path.join(rootPath, "src", "tools"), { recursive: true });
  for (const [file, source] of Object.entries(files)) {
    writeFileSync(path.join(rootPath, ...file.split("/")), source, "utf8");
  }
  const repository = createRepositoryProgram({ rootPath, filePaths: Object.keys(files) });
  return evaluatePolicyChecks({
    apiVersion: "kernel-zero.dev/v1",
    kind: "RepositoryPolicy",
    metadata: { name: "registry-test", revision: 1, description: "Registry fixture policy" },
    scope: { languages: ["typescript"], include: ["src/**/*.ts"], exclude: [] },
    rules: [{
      id: "closed-tools",
      title: "Closed tool registry",
      level: "error",
      check: {
        kind: "require-closed-registry",
        registryFile: "src/tools/tool-policy.ts",
        registryExport: "TOOL_POLICY",
        declarationFiles: ["src/tools/**/*.ts"],
        declarationCalls: ["defineTool"],
        requiredKeys: ["classification", "authority", "approval"],
        ...check,
      },
      remediation: "Register every tool with complete metadata.",
    }],
  }, repository).map(({ messageCode, subject, path: filePath }) => [messageCode, subject, filePath]);
}

describe("require-closed-registry", { timeout: COMPILER_TEST_TIMEOUT_MS }, () => {
  it("accepts direct and frozen registries with complete entries and matching declarations", () => {
    expect(evaluate({
      "src/tools/tool-policy.ts": `${DECLARE}
        export const TOOL_POLICY = Object.freeze({
          "read/file": ${META},
          search: defineTool("search", ${META}),
          "reserved.only": Object.freeze(${META}),
        });
      `,
      "src/tools/read.ts": `${DECLARE}defineTool("read/file");\n`,
      "src/tools/other.ts": `${DECLARE}export const twice = [defineTool("search")];\n`,
    })).toEqual([]);
  });

  it("reports missing keys, invalid and duplicate ids, mismatched declared ids, and unregistered declarations", () => {
    expect(evaluate({
      "src/tools/tool-policy.ts": `${DECLARE}
        export const TOOL_POLICY = {
          incomplete: { classification: "read", authority: "workspace" },
          "bad id!": ${META},
          dup: ${META},
          dup: ${META},
          renamed: defineTool("different", ${META}),
        };
      `,
      "src/tools/consumer.ts": `${DECLARE}
        defineTool("unknown");
        defineTool("bad id!");
        defineTool("dup");
        defineTool("dup");
      `,
    })).toEqual([
      ["UNREGISTERED_DECLARATION", "registry:TOOL_POLICY:declaration:unknown", "src/tools/consumer.ts"],
      ["UNREGISTERED_DECLARATION", "registry:TOOL_POLICY:declaration:<invalid>", "src/tools/consumer.ts"],
      ["CLOSED_REGISTRY_PROOF_FAILED", "registry:TOOL_POLICY:proof:declaration", "src/tools/consumer.ts"],
      ["CLOSED_REGISTRY_ENTRY_INVALID", "registry:TOOL_POLICY:entry:incomplete:approval", "src/tools/tool-policy.ts"],
      ["CLOSED_REGISTRY_ENTRY_INVALID", "registry:TOOL_POLICY:entry:<invalid>:id", "src/tools/tool-policy.ts"],
      ["CLOSED_REGISTRY_ENTRY_INVALID", "registry:TOOL_POLICY:entry:dup:id", "src/tools/tool-policy.ts"],
      ["CLOSED_REGISTRY_ENTRY_INVALID", "registry:TOOL_POLICY:entry:renamed:id", "src/tools/tool-policy.ts"],
    ]);
  });

  it("fails proof for indirection, spreads, computed keys, accessors, methods, and dynamic declarations", () => {
    expect(evaluate({
      "src/tools/tool-policy.ts": `${DECLARE}
        declare const shared: object;
        declare const key: string;
        declare function seal(value: object): object;
        export const TOOL_POLICY = {
          indirect: shared,
          spread: { ...shared, classification: "read", authority: "workspace", approval: "none" },
          [key]: ${META},
          accessor: { get classification() { return "read"; }, authority: "workspace", approval: "none" },
          method: { classification() { return "read"; }, authority: "workspace", approval: "none" },
          sealed: seal(${META}),
        };
      `,
      "src/tools/consumer.ts": `${DECLARE}declare const dynamicId: string;\ndefineTool(dynamicId);\n`,
    })).toEqual([
      ["CLOSED_REGISTRY_PROOF_FAILED", "registry:TOOL_POLICY:proof:declaration", "src/tools/consumer.ts"],
      ["CLOSED_REGISTRY_PROOF_FAILED", "registry:TOOL_POLICY:proof:indirect", "src/tools/tool-policy.ts"],
      ["CLOSED_REGISTRY_PROOF_FAILED", "registry:TOOL_POLICY:proof:spread", "src/tools/tool-policy.ts"],
      ["CLOSED_REGISTRY_PROOF_FAILED", "registry:TOOL_POLICY:proof:registry", "src/tools/tool-policy.ts"],
      ["CLOSED_REGISTRY_PROOF_FAILED", "registry:TOOL_POLICY:proof:accessor", "src/tools/tool-policy.ts"],
      ["CLOSED_REGISTRY_PROOF_FAILED", "registry:TOOL_POLICY:proof:method", "src/tools/tool-policy.ts"],
      ["CLOSED_REGISTRY_PROOF_FAILED", "registry:TOOL_POLICY:proof:sealed", "src/tools/tool-policy.ts"],
    ]);
  });

  it("treats only accepted entry values as exempt, so stashed declarations in the registry file are still judged", () => {
    expect(evaluate({
      "src/tools/tool-policy.ts": `${DECLARE}
        export const TOOL_POLICY = Object.freeze({
          alpha: ${META},
          wrapped: defineTool("wrapped", ${META}) as unknown,
        });
        const stash = { rogue: defineTool("rogue.delete", ${META}) };
        void stash;
      `,
      "src/tools/consumer.ts": `${DECLARE}defineTool("wrapped");\n`,
    })).toEqual([
      ["UNREGISTERED_DECLARATION", "registry:TOOL_POLICY:declaration:rogue.delete", "src/tools/tool-policy.ts"],
    ]);
  });

  it("fails proof at the registry when the export or file is missing or not a literal", () => {
    expect(evaluate({
      "src/tools/tool-policy.ts": "declare function seal(value: object): object;\nexport const TOOL_POLICY = seal({});\n",
    })).toEqual([
      ["CLOSED_REGISTRY_PROOF_FAILED", "registry:TOOL_POLICY:proof:registry", "src/tools/tool-policy.ts"],
    ]);
    expect(evaluate({ "src/tools/elsewhere.ts": `${DECLARE}defineTool("x");\n` })).toEqual([
      ["UNREGISTERED_DECLARATION", "registry:TOOL_POLICY:declaration:x", "src/tools/elsewhere.ts"],
      ["CLOSED_REGISTRY_PROOF_FAILED", "registry:TOOL_POLICY:proof:registry", "src/tools/tool-policy.ts"],
    ]);
  });
});
