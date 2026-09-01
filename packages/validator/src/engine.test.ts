import path from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import type { RepositoryPolicy } from "@kernel-zero/contracts";
import { describe, expect, it } from "vitest";

import { createRepositoryProgram, evaluatePolicyChecks } from "./engine";

const fixtureRoot = fileURLToPath(new URL("../fixtures/checks/", import.meta.url));
const COMPILER_TEST_TIMEOUT_MS = 30_000;
const allFiles = [
  "boundary/operations.ts",
  "calls/restricted.ts",
  "exports/registry.ts",
  "governed/actions.ts",
  "imports/denied.ts",
  "imports/required-type.ts",
  "imports/required-value.ts",
  "imports/target.ts",
  "parse/broken.ts",
  "tenant/functions.ts",
] as const;

type Rule = RepositoryPolicy["rules"][number];

function policyFor(rule: Rule): RepositoryPolicy {
  return {
    apiVersion: "kernel-zero.dev/v1",
    kind: "RepositoryPolicy",
    metadata: { name: "engine-test", revision: 1, description: "Engine fixture policy" },
    scope: { languages: ["typescript", "tsx"], include: ["**/*.ts"], exclude: [] },
    rules: [rule],
  };
}

function evaluate(rule: Rule, filePaths: readonly string[] = allFiles) {
  const repository = createRepositoryProgram({ rootPath: fixtureRoot, filePaths });
  return evaluatePolicyChecks(policyFor(rule), repository);
}

describe("validator compiler and parse-failure model", { timeout: COMPILER_TEST_TIMEOUT_MS }, () => {
  it("normalizes paths, rejects paths outside the root, and emits one fail-closed parse finding", () => {
    const repository = createRepositoryProgram({
      rootPath: path.join(fixtureRoot, "."),
      filePaths: ["parse\\broken.ts"],
    });
    expect(repository.filePaths).toEqual(["parse/broken.ts"]);

    const findings = evaluatePolicyChecks(policyFor({
      id: "parse-rule",
      title: "Parsed source required",
      level: "error",
      check: { kind: "require-import", files: ["parse/**"], module: "server-only", allowTypeOnly: false },
      remediation: "Repair the source file.",
    }), repository);

    expect(findings).toEqual([expect.objectContaining({
      ruleId: "parse-rule",
      level: "error",
      messageCode: "PARSE_FAILURE",
      subject: "parse",
      path: "parse/broken.ts",
    })]);
    expect(() => createRepositoryProgram({ rootPath: fixtureRoot, filePaths: ["../escape.ts"] })).toThrow(/contained/u);
  });

  it("names nested function-like nodes without relying on compiler parent links", () => {
    const repository = createRepositoryProgram({
      rootPath: process.cwd(),
      filePaths: ["packages/validator/src/engine.ts"],
    });
    const findings = evaluatePolicyChecks(policyFor({
      id: "parentless-functions",
      title: "Parentless compiler nodes",
      level: "error",
      check: {
        kind: "require-boundary-parse",
        files: ["packages/validator/src/engine.ts"],
        boundaryCalls: ["never.called"],
        parserCalls: ["Parser.parse"],
      },
      remediation: "Traverse compiler nodes structurally.",
    }), repository);

    expect(findings).toEqual([]);
  });
});

describe("validator import checks", { timeout: COMPILER_TEST_TIMEOUT_MS }, () => {
  it("reports exact modules, resolved paths, and nonliteral imports deterministically", () => {
    const findings = evaluate({
      id: "import-edge",
      title: "Denied dependency",
      level: "error",
      check: {
        kind: "forbid-import-edge",
        from: ["imports/denied.ts"],
        deny: ["module:blocked-package", "path:imports/target.ts"],
      },
      remediation: "Use an allowed dependency.",
    });

    expect(findings.map(({ messageCode, subject }) => [messageCode, subject])).toEqual([
      ["DENIED_IMPORT", "blocked-package"],
      ["DENIED_IMPORT", "imports/target.ts"],
      ["IMPORT_RESOLUTION_FAILED", "dynamic-import"],
    ]);
    expect(evaluate({
      id: "allowed-edge",
      title: "Allowed dependency",
      level: "warning",
      check: { kind: "forbid-import-edge", from: ["imports/denied.ts"], deny: ["module:other"] },
      remediation: "Use an allowed dependency.",
    })).toEqual([]);
  });

  it("requires a value import unless type-only imports are explicitly allowed", () => {
    const base = {
      id: "required-import",
      title: "Required dependency",
      level: "error",
      remediation: "Import the boundary marker.",
    } as const;
    expect(evaluate({
      ...base,
      check: { kind: "require-import", files: ["imports/required-*.ts"], module: "server-only", allowTypeOnly: false },
    }).map((finding) => finding.path)).toEqual(["imports/required-type.ts"]);
    expect(evaluate({
      ...base,
      check: { kind: "require-import", files: ["imports/required-*.ts"], module: "server-only", allowTypeOnly: true },
    })).toEqual([]);
  });
});

describe("validator call and export checks", { timeout: COMPILER_TEST_TIMEOUT_MS }, () => {
  it("blocks direct and literal-computed restricted calls and fails closed on unresolved matching calls", () => {
    const findings = evaluate({
      id: "restricted-call",
      title: "Restricted call",
      level: "error",
      check: { kind: "restrict-call-site", callee: ["db.query"], allowFrom: ["allowed/**"], requireResolution: true },
      remediation: "Move the call behind its boundary.",
    }, ["calls/restricted.ts"]);
    expect(findings.map(({ messageCode, subject }) => [messageCode, subject])).toEqual([
      ["RESTRICTED_CALL_SITE", "db.query"],
      ["RESTRICTED_CALL_SITE", "db.query"],
      ["CALL_RESOLUTION_FAILED", "db.query"],
    ]);
  });

  it("reports missing export keys and proof-blocking spreads", () => {
    const findings = evaluate({
      id: "export-keys",
      title: "Export shape",
      level: "error",
      check: { kind: "require-export-keys", files: ["exports/**"], exportName: "SETTINGS", requiredKeys: ["present", "missing"] },
      remediation: "Declare all keys directly.",
    });
    expect(findings.map(({ messageCode, subject }) => [messageCode, subject])).toEqual([
      ["EXPORT_PROOF_FAILED", "export:SETTINGS:missing"],
    ]);
  });
});

describe("validator tenant, boundary, and governed checks", { timeout: COMPILER_TEST_TIMEOUT_MS }, () => {
  it("accepts exact and required typed tenant parameters and rejects optional or any parameters", () => {
    const findings = evaluate({
      id: "tenant-parameter",
      title: "Tenant context",
      level: "error",
      check: { kind: "require-tenant-parameter", files: ["tenant/**"], symbols: "*", parameter: "workspaceId" },
      remediation: "Require a workspace identifier.",
    });
    expect(findings.map((finding) => finding.subject)).toEqual([
      "symbol:missing",
      "symbol:handlers.invalid",
    ]);
  });

  it("accepts direct, prior, and guarded parser results but rejects casts", () => {
    const findings = evaluate({
      id: "boundary-parse",
      title: "Parsed input",
      level: "error",
      check: { kind: "require-boundary-parse", files: ["boundary/**"], boundaryCalls: ["persist"], parserCalls: ["Input.parse", "Input.safeParse"] },
      remediation: "Parse untrusted input first.",
    });
    expect(findings.map(({ messageCode, subject }) => [messageCode, subject])).toEqual([
      ["UNPARSED_BOUNDARY", "symbol:unsafe:persist"],
    ]);
  });

  it("carries safe-parse proof past only definitely terminating negative guards", () => {
    const rootPath = mkdtempSync(path.join(tmpdir(), "kernel-zero-guard-dominance-"));
    writeFileSync(path.join(rootPath, "guards.ts"), `
      declare const Input: {
        safeParse(value: unknown):
          | { success: true; data: { workspaceId: string } }
          | { success: false; error: Error };
      };
      declare function persist(input: { workspaceId: string }): void;

      export function throwing(raw: unknown): void {
        const parsed = Input.safeParse(raw);
        if (!parsed.success) {
          throw parsed.error;
        }
        const evidence = parsed.data;
        persist(evidence);
      }

      export function returning(raw: unknown): void {
        const parsed = Input.safeParse(raw);
        if (parsed.success === false) return;
        persist(parsed.data);
      }

      export function nonTerminating(raw: unknown): void {
        const parsed = Input.safeParse(raw);
        if (!parsed.success) console.info("invalid");
        persist(parsed.data);
      }

      export function unrelated(raw: unknown): void {
        const parsed = Input.safeParse(raw);
        const other = Input.safeParse(raw);
        if (!other.success) return;
        persist(parsed.data);
      }
    `, "utf8");
    const repository = createRepositoryProgram({ rootPath, filePaths: ["guards.ts"] });
    const findings = evaluatePolicyChecks(policyFor({
      id: "terminating-guard",
      title: "Terminating safe-parse guard",
      level: "error",
      check: {
        kind: "require-boundary-parse",
        files: ["guards.ts"],
        boundaryCalls: ["persist"],
        parserCalls: ["Input.safeParse"],
      },
      remediation: "Terminate every failed parse path.",
    }), repository);

    expect(findings.map((finding) => finding.subject)).toEqual([
      "symbol:nonTerminating:persist",
      "symbol:unrelated:persist",
    ]);
  });

  it("checks registry entry keys plus literal and known declarations", () => {
    const findings = evaluate({
      id: "governed-operation",
      title: "Governed action",
      level: "error",
      check: {
        kind: "require-governed-operation",
        files: ["governed/**"],
        registryExport: "GOVERNED_ACTIONS",
        requiredKeys: ["capability", "tenantScope", "quota", "audit", "idempotency"],
        declarationCalls: ["defineGovernedAction"],
      },
      remediation: "Register complete action metadata.",
    });
    expect(findings.map(({ messageCode, subject }) => [messageCode, subject])).toEqual([
      ["MISSING_GOVERNED_KEY", "action:incomplete:idempotency"],
      ["INVALID_GOVERNED_KEY", "action:mismatched:actionId"],
      ["UNKNOWN_GOVERNED_ACTION", "action:different:registry"],
      ["UNKNOWN_GOVERNED_ACTION", "action:unknown:registry"],
      ["GOVERNED_DECLARATION_PROOF_FAILED", "action:<dynamic>:actionId"],
    ]);
  });

  it("unwraps only an exact Object.freeze registry object", () => {
    const rootPath = mkdtempSync(path.join(tmpdir(), "kernel-zero-static-registry-"));
    const metadata = `{
      capability: "workspace.update",
      tenantScope: "workspace",
      quota: "mutations",
      audit: "workspace.updated",
      idempotency: "required",
    }`;
    writeFileSync(path.join(rootPath, "safe.ts"), `
      declare function defineGovernedAction(id: string, metadata: object): unknown;
      export const GOVERNED_ACTIONS = Object.freeze({
        safe: defineGovernedAction("safe", ${metadata}),
      });
    `, "utf8");
    writeFileSync(path.join(rootPath, "arbitrary.ts"), `
      declare function defineGovernedAction(id: string, metadata: object): unknown;
      declare function sealRegistry(value: object): unknown;
      export const GOVERNED_ACTIONS = sealRegistry({
        unsafe: defineGovernedAction("unsafe", ${metadata}),
      });
    `, "utf8");
    writeFileSync(path.join(rootPath, "computed.ts"), `
      declare function defineGovernedAction(id: string, metadata: object): unknown;
      declare const freezeName: string;
      export const GOVERNED_ACTIONS = Object[freezeName]({
        unsafe: defineGovernedAction("unsafe", ${metadata}),
      });
    `, "utf8");
    const repository = createRepositoryProgram({
      rootPath,
      filePaths: ["arbitrary.ts", "computed.ts", "safe.ts"],
    });
    const findings = evaluatePolicyChecks(policyFor({
      id: "static-registry",
      title: "Static governed registry",
      level: "error",
      check: {
        kind: "require-governed-operation",
        files: ["**/*.ts"],
        registryExport: "GOVERNED_ACTIONS",
        requiredKeys: ["capability", "tenantScope", "quota", "audit", "idempotency"],
        declarationCalls: ["defineGovernedAction"],
      },
      remediation: "Use a statically provable registry.",
    }), repository);

    expect(findings.filter((finding) => finding.path === "safe.ts")).toEqual([]);
    expect(findings.filter((finding) => finding.messageCode === "GOVERNED_REGISTRY_PROOF_FAILED").map((finding) => finding.path)).toEqual([
      "arbitrary.ts",
      "computed.ts",
    ]);
  });
});
