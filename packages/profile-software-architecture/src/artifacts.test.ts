import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ExceptionGrantSetSchema } from "@kernel-zero/contracts";
import { canonicalJson } from "@kernel-zero/domain";

import { RepositoryEvidenceSchema } from "./evidence";
import { RepositoryPolicySchema } from "./policy";

function json(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

describe("generated public contract artifacts", () => {
  it("keeps canonical examples parseable and canonically encoded", () => {
    for (const [path, schema] of [
      ["docs/contracts/examples/repository-policy-v1.json", RepositoryPolicySchema],
      ["docs/contracts/examples/exception-grant-set-v1.json", ExceptionGrantSetSchema],
      ["docs/contracts/examples/repository-evidence-v1.json", RepositoryEvidenceSchema],
    ] as const) {
      const source = readFileSync(resolve(path), "utf8").trimEnd();
      const parsed = schema.parse(JSON.parse(source) as unknown);
      expect(source).toBe(canonicalJson(parsed));
    }
  });

  it("ships representative malformed fixtures that strict parsing rejects", () => {
    expect(RepositoryPolicySchema.safeParse(json("docs/contracts/malformed/repository-policy-unknown-field.json")).success).toBe(false);
    expect(RepositoryPolicySchema.safeParse(json("docs/contracts/malformed/repository-policy-path-escape.json")).success).toBe(false);
    expect(ExceptionGrantSetSchema.safeParse(json("docs/contracts/malformed/exception-grant-set-private-data.json")).success).toBe(false);
    expect(RepositoryEvidenceSchema.safeParse(json("docs/contracts/malformed/repository-evidence-source-content.json")).success).toBe(false);
  });
});
