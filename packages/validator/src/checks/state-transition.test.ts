import { fileURLToPath } from "node:url";

import type { RepositoryPolicy } from "@kernel-zero/profile-software-architecture";
import { describe, expect, it } from "vitest";

import { createRepositoryProgram, evaluatePolicyChecks } from "../engine";

const COMPILER_TEST_TIMEOUT_MS = 30_000;
const fixtureRoot = fileURLToPath(new URL("../../fixtures/kinds/", import.meta.url));
type Check = Extract<RepositoryPolicy["rules"][number]["check"], { kind: "restrict-state-transition" }>;

const WRITER = "state-transition/allowed/writer.ts";
const ROGUE = "state-transition/elsewhere/rogue.ts";
const CHAIN = "transition:state:db.policyRevision.updateMany";
const GLOB = "transition:state:*.policyRevision.updateMany";

function evaluate(check: Partial<Check> = {}, level: "error" | "warning" = "error") {
  const repository = createRepositoryProgram({ rootPath: fixtureRoot, filePaths: [WRITER, ROGUE] });
  return evaluatePolicyChecks({
    apiVersion: "kernel-zero.dev/v1",
    kind: "RepositoryPolicy",
    metadata: { name: "state-transition-test", revision: 1, description: "State transition fixture policy" },
    scope: { languages: ["typescript"], include: ["**/*.ts"], exclude: [] },
    rules: [{
      id: "policy-revision-state-is-governed",
      title: "Policy revision state is governed",
      level,
      check: {
        kind: "restrict-state-transition",
        callee: ["*.policyRevision.updateMany"],
        argument: 0,
        field: "data.state",
        allowFrom: ["state-transition/allowed/**"],
        transitions: [{ from: "draft", to: "approved" }, { from: "approved", to: "active" }],
        ...check,
      },
      remediation: "Write state only from the governed writer through a listed transition.",
    }],
  }, repository).map(({ messageCode, subject, path, location }) => [messageCode, subject, path, `${String(location.startLine)}:${String(location.startColumn)}-${String(location.endLine)}:${String(location.endColumn)}`]);
}

describe("restrict-state-transition", { timeout: COMPILER_TEST_TIMEOUT_MS }, () => {
  it("emits the exact finding matrix over both fixtures in engine order", () => {
    expect(evaluate()).toEqual([
      ["STATE_TRANSITION_DENIED_PAIR", "transition:state:draft->active", WRITER, "8:1-8:91"],
      ["STATE_TRANSITION_UNPROVABLE", CHAIN, WRITER, "9:1-9:77"],
      ["STATE_TRANSITION_UNPROVABLE", CHAIN, WRITER, "10:1-10:84"],
      ["STATE_TRANSITION_UNPROVABLE", GLOB, WRITER, "12:1-12:83"],
      ["STATE_TRANSITION_DENIED_WRITER", CHAIN, ROGUE, "3:1-3:89"],
    ]);
  });

  it("checks only the writer when transitions are empty", () => {
    expect(evaluate({ transitions: [] })).toEqual([
      ["STATE_TRANSITION_UNPROVABLE", CHAIN, WRITER, "10:1-10:84"],
      ["STATE_TRANSITION_UNPROVABLE", GLOB, WRITER, "12:1-12:83"],
      ["STATE_TRANSITION_DENIED_WRITER", CHAIN, ROGUE, "3:1-3:89"],
    ]);
  });

  it("accepts a wildcard source state and denies every writer when allowFrom is empty", () => {
    expect(evaluate({ transitions: [{ from: "*", to: "approved" }, { from: "*", to: "active" }] }).filter(([code]) => code === "STATE_TRANSITION_DENIED_PAIR")).toEqual([]);
    expect(evaluate({ allowFrom: [] }).filter(([code]) => code === "STATE_TRANSITION_DENIED_WRITER")).toHaveLength(5);
  });

  it("reports unresolved callees only at error level", () => {
    const warnings = evaluate({}, "warning");
    expect(warnings.filter(([, subject]) => subject === GLOB)).toEqual([]);
    expect(warnings).toHaveLength(4);
  });

  it("ignores resolved calls whose chain matches no callee glob and reports the unresolved call under the glob whose ends agree", () => {
    expect(evaluate({ callee: ["*.policyPack.updateMany"] })).toEqual([
      ["STATE_TRANSITION_UNPROVABLE", "transition:state:*.policyPack.updateMany", WRITER, "12:1-12:83"],
    ]);
    expect(evaluate({ callee: ["*.policyPack.create"] })).toEqual([]);
  });
});
