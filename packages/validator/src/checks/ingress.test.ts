import { fileURLToPath } from "node:url";

import type { RepositoryPolicy } from "@kernel-zero/profile-software-architecture";
import { describe, expect, it } from "vitest";

import { createRepositoryProgram, evaluatePolicyChecks } from "../engine";

const COMPILER_TEST_TIMEOUT_MS = 30_000;
const fixtureRoot = fileURLToPath(new URL("../../fixtures/kinds/", import.meta.url));
type Check = Extract<RepositoryPolicy["rules"][number]["check"], { kind: "require-ingress-parse" }>;

const FILE = "ingress/handlers.ts";

function evaluate(check: Partial<Check> = {}) {
  const repository = createRepositoryProgram({ rootPath: fixtureRoot, filePaths: [FILE] });
  return evaluatePolicyChecks({
    apiVersion: "kernel-zero.dev/v1",
    kind: "RepositoryPolicy",
    metadata: { name: "ingress-test", revision: 1, description: "Ingress fixture policy" },
    scope: { languages: ["typescript"], include: ["**/*.ts"], exclude: [] },
    rules: [{
      id: "route-handlers-parse-their-input",
      title: "Route handlers parse their input",
      level: "error",
      check: {
        kind: "require-ingress-parse",
        files: ["ingress/**"],
        symbols: "*",
        parserCalls: ["parse"],
        readerCalls: ["dependencies.resolveSubmission"],
        allowedCalls: ["dependencies.service.submit"],
        ...check,
      },
      remediation: "Parse the request before it reaches anything else.",
    }],
  }, repository).map(({ messageCode, subject, path, location }) => [messageCode, subject, path, `${String(location.startLine)}:${String(location.startColumn)}-${String(location.endLine)}:${String(location.endColumn)}`]);
}

describe("require-ingress-parse", { timeout: COMPILER_TEST_TIMEOUT_MS }, () => {
  it("emits the exact finding matrix over the fixture in engine order", () => {
    expect(evaluate()).toEqual([
      ["INGRESS_ESCAPE", "symbol:GET:escape:return", FILE, "18:3-18:18"],
      ["INGRESS_ESCAPE", "symbol:PUT:escape:log", FILE, "22:3-22:23"],
      ["INGRESS_UNRESOLVED", "symbol:PATCH:proof", FILE, "27:3-29:4"],
      ["INGRESS_PARSE_MISSING", "symbol:DELETE:parser", FILE, "33:17-33:23"],
      ["INGRESS_UNRESOLVED", "symbol:HEAD:proof", FILE, "38:14-38:30"],
      ["INGRESS_ESCAPE", "symbol:OPTIONS:escape:closure", FILE, "41:17-41:37"],
      ["INGRESS_ESCAPE", "symbol:CONNECT:escape:log", FILE, "55:3-55:13"],
    ]);
  });

  it("restricts findings to the exported symbols the glob names", () => {
    expect(evaluate({ symbols: "POST" })).toEqual([]);
    expect(evaluate({ symbols: "TRACE" })).toEqual([]);
    expect(evaluate({ symbols: "GET" })).toEqual([["INGRESS_ESCAPE", "symbol:GET:escape:return", FILE, "18:3-18:18"]]);
    expect(evaluate({ symbols: "ignored" })).toEqual([]);
  });

  it("treats a reader result as untrusted and an allowed call as a sink only when listed", () => {
    expect(evaluate({ symbols: "POST", readerCalls: [] })).toEqual([
      ["INGRESS_ESCAPE", "symbol:POST:escape:dependencies.resolveSubmission", FILE, "11:25-11:64"],
    ]);
    expect(evaluate({ symbols: "POST", allowedCalls: [] })).toEqual([
      ["INGRESS_ESCAPE", "symbol:POST:escape:dependencies.service.submit", FILE, "13:24-13:74"],
    ]);
    expect(evaluate({ symbols: "TRACE", allowedCalls: [] })).toEqual([
      ["INGRESS_ESCAPE", "symbol:TRACE:escape:closure", FILE, "48:37-48:57"],
    ]);
  });

  it("reports a missing parser only when nothing else was recorded", () => {
    expect(evaluate({ symbols: "POST", parserCalls: ["other"] })).toEqual([
      ["INGRESS_ESCAPE", "symbol:POST:escape:parse", FILE, "12:20-12:34"],
    ]);
    expect(evaluate({ symbols: "DELETE", parserCalls: ["respond"] })).toEqual([
      ["INGRESS_PARSE_MISSING", "symbol:DELETE:parser", FILE, "33:17-33:23"],
    ]);
  });

  it("ignores files outside the rule", () => {
    expect(evaluate({ files: ["elsewhere/**"] })).toEqual([]);
  });
});
