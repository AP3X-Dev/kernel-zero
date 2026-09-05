import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RepositoryPolicy } from "@kernel-zero/profile-software-architecture";
import { describe, expect, it } from "vitest";

import { createRepositoryProgram, evaluatePolicyChecks } from "../engine";

const COMPILER_TEST_TIMEOUT_MS = 30_000;
type Check = Extract<RepositoryPolicy["rules"][number]["check"], { kind: "restrict-property-write" }>;

const JOB_MODULE = `
  export interface Job { id: string; status: string; retries: number }
  export type JobAlias = Job;
  export interface PriorityJob extends Job { priority: number }
  export type Wrapped<T> = { inner: T };
  export interface Unrelated { status: string }
`;
const IMPORT = 'import type { Job, JobAlias, PriorityJob, Unrelated } from "../domain/job";\n';

function evaluate(files: Readonly<Record<string, string>>, check: Partial<Check> = {}) {
  const rootPath = mkdtempSync(path.join(tmpdir(), "kernel-zero-property-"));
  for (const directory of ["src/domain", "src/services", "src/dataplane/state"]) {
    mkdirSync(path.join(rootPath, ...directory.split("/")), { recursive: true });
  }
  const all = { "src/domain/job.ts": JOB_MODULE, ...files };
  for (const [file, source] of Object.entries(all)) {
    writeFileSync(path.join(rootPath, ...file.split("/")), source, "utf8");
  }
  const repository = createRepositoryProgram({ rootPath, filePaths: Object.keys(all) });
  return evaluatePolicyChecks({
    apiVersion: "kernel-zero.dev/v1",
    kind: "RepositoryPolicy",
    metadata: { name: "property-test", revision: 1, description: "Property write fixture policy" },
    scope: { languages: ["typescript"], include: ["src/**/*.ts"], exclude: [] },
    rules: [{
      id: "job-status",
      title: "Job status authority",
      level: "error",
      check: {
        kind: "restrict-property-write",
        files: ["src/**/*.ts"],
        targetType: { file: "src/domain/job.ts", exportName: "Job" },
        property: "status",
        allowFrom: ["src/dataplane/state/**"],
        ...check,
      },
      remediation: "Move the status transition into the state module.",
    }],
  }, repository).map(({ messageCode, path: filePath, location }) => [messageCode, filePath, location.startLine]);
}

describe("restrict-property-write", { timeout: COMPILER_TEST_TIMEOUT_MS }, () => {
  it("denies every bounded write form outside the authority boundary and allows authorized files", () => {
    const writes = `${IMPORT}
      declare const job: Job;
      declare const alias: JobAlias;
      declare const priority: PriorityJob;
      declare const maybe: Job | Unrelated;
      declare const both: Job & { extra: number };
      declare const other: Unrelated;
      declare function accept(input: Job): void;
      const KEY = "status";
      export function run<T extends Job>(generic: T): void {
        job.status = "done";
        job.status += "!";
        job.status ||= "x";
        job["status"] = "done";
        job[KEY] = "done";
        delete job.status;
        alias.status = "done";
        priority.status = "done";
        maybe.status = "done";
        both.status = "done";
        generic.status = "done";
        ({ status: job.status } = { status: "a" });
        [job.status] = ["a"];
        const literal: Job = { id: "1", status: "queued", retries: 0 };
        accept({ id: "1", status: "queued", retries: 0 });
        const asserted = { id: "1", status: "queued", retries: 0 } as Job;
        const satisfied = { id: "1", status: "queued", retries: 0 } satisfies Job;
        job.retries += 1;
        other.status = "done";
        job.id = "2";
        void [literal, asserted, satisfied];
      }
      export class Local implements Job { id = "1"; status = "queued"; retries = 0; }
      export class Param implements Job { id = "1"; retries = 0; constructor(public status: string) {} }
    `;
    expect(evaluate({ "src/services/writes.ts": writes })).toEqual([
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 12],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 13],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 14],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 15],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 16],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 17],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 18],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 19],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 20],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 21],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 22],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 23],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 24],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 25],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 26],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 27],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 28],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 34],
      ["PROPERTY_WRITE_DENIED", "src/services/writes.ts", 35],
    ]);
    expect(evaluate({ "src/dataplane/state/transition.ts": `${IMPORT}export function done(job: Job): void { job.status = "done"; }\n` })).toEqual([]);
    expect(evaluate({ "src/services/none.ts": `${IMPORT}export function done(job: Job): void { job.status = "done"; }\n` }, { allowFrom: [] })).toEqual([
      ["PROPERTY_WRITE_DENIED", "src/services/none.ts", 2],
    ]);
  });

  it("fails proof for unsafe receivers, unresolved computed keys, and authoring spreads", () => {
    expect(evaluate({
      "src/services/unclear.ts": `${IMPORT}
        declare const anything: any;
        declare const unknownValue: unknown;
        declare const job: Job;
        declare const dynamicKey: string;
        declare const unsafeSource: any;
        declare const jobSource: Job;
        declare const partial: { id: string };
        export function run<T>(generic: T): void {
          anything.status = "done";
          (unknownValue as { status: string }).status = "done";
          job[dynamicKey] = "done";
          const spreadUnsafe: Job = { ...unsafeSource };
          const spreadJob: Job = { ...jobSource };
          const spreadPartial: Job = { ...partial, status: "queued", retries: 0 };
          (generic as unknown as { status: string }).status = "done";
          void [spreadUnsafe, spreadJob, spreadPartial];
        }
      `,
    })).toEqual([
      ["PROPERTY_WRITE_UNRESOLVED", "src/services/unclear.ts", 11],
      ["PROPERTY_WRITE_UNRESOLVED", "src/services/unclear.ts", 13],
      ["PROPERTY_WRITE_UNRESOLVED", "src/services/unclear.ts", 14],
      ["PROPERTY_WRITE_DENIED", "src/services/unclear.ts", 15],
      ["PROPERTY_WRITE_DENIED", "src/services/unclear.ts", 16],
    ]);
  });

  it("survives destructuring defaults anywhere in the program and claims the type file for parse failures", () => {
    expect(evaluate({
      "src/services/defaults.ts": `${IMPORT}
        declare const job: Job;
        declare const source: { status: string; list: string[] };
        export function run(): void {
          let plain = "";
          [plain = "x"] = source.list;
          ({ status: plain = "y" } = source);
          ({ status: job.status = "z" } = source);
          void plain;
        }
      `,
    })).toEqual([["PROPERTY_WRITE_DENIED", "src/services/defaults.ts", 9]]);
    expect(evaluate({
      "src/domain/job.ts": "export interface Job { status: string\n",
      "src/services/plain.ts": "export const nothing = 1;\n",
    }, { files: ["src/services/**"] })).toEqual([
      ["PROPERTY_TARGET_UNRESOLVED", "src/domain/job.ts", 1],
      ["PARSE_FAILURE", "src/domain/job.ts", 2],
    ]);
  });

  it("fails proof at the target when the type, export, file, or property cannot resolve", () => {
    const source = { "src/services/plain.ts": `${IMPORT}declare const job: Job;\njob.status = "done";\n` };
    expect(evaluate(source, { targetType: { file: "src/domain/job.ts", exportName: "Missing" } })).toEqual([
      ["PROPERTY_TARGET_UNRESOLVED", "src/domain/job.ts", 1],
    ]);
    expect(evaluate(source, { property: "absent" })).toEqual([
      ["PROPERTY_TARGET_UNRESOLVED", "src/domain/job.ts", 1],
    ]);
    expect(evaluate(source, { targetType: { file: "src/domain/absent.ts", exportName: "Job" } })).toEqual([
      ["PROPERTY_TARGET_UNRESOLVED", "src/domain/absent.ts", 1],
    ]);
  });
});
