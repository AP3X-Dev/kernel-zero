import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RepositoryPolicy } from "@kernel-zero/profile-software-architecture";
import { describe, expect, it } from "vitest";

import { createRepositoryProgram, evaluatePolicyChecks } from "../engine";

const COMPILER_TEST_TIMEOUT_MS = 30_000;
type Check = Extract<RepositoryPolicy["rules"][number]["check"], { kind: "require-context-parameter" }>;

const CONTEXT_MODULE = `
  export interface AuthorizationContext { actorId: string }
  export type ContextAlias = AuthorizationContext;
  export interface AdminContext extends AuthorizationContext { admin: true }
  export interface Envelope<T> { context: T }
  export type Lookalike = { actorId: string };
  export const NOT_A_TYPE = 1;
`;

function evaluate(files: Readonly<Record<string, string>>, check: Pick<Check, "symbols" | "parameter"> & Partial<Pick<Check, "expectedType">>) {
  const rootPath = mkdtempSync(path.join(tmpdir(), "kernel-zero-context-"));
  mkdirSync(path.join(rootPath, "src", "auth"), { recursive: true });
  mkdirSync(path.join(rootPath, "src", "services"), { recursive: true });
  for (const [file, source] of Object.entries({ "src/auth/context.ts": CONTEXT_MODULE, ...files })) {
    writeFileSync(path.join(rootPath, ...file.split("/")), source, "utf8");
  }
  const filePaths = Object.keys(files).concat("src/auth/context.ts").sort();
  const repository = createRepositoryProgram({ rootPath, filePaths });
  return evaluatePolicyChecks({
    apiVersion: "kernel-zero.dev/v1",
    kind: "RepositoryPolicy",
    metadata: { name: "context-test", revision: 1, description: "Context fixture policy" },
    scope: { languages: ["typescript"], include: ["src/**/*.ts"], exclude: [] },
    rules: [{
      id: "context-parameter",
      title: "Context parameter",
      level: "error",
      check: { kind: "require-context-parameter", files: ["src/services/**"], expectedType: null, ...check },
      remediation: "Require the authorization context.",
    }],
  }, repository).map(({ messageCode, subject, path: filePath }) => [messageCode, subject, filePath]);
}

const IMPORT = 'import type { AuthorizationContext, ContextAlias, AdminContext, Envelope, Lookalike } from "../auth/context";\n';
const EXPECTED = { kind: "export", file: "src/auth/context.ts", exportName: "AuthorizationContext" } as const;

describe("require-context-parameter", { timeout: COMPILER_TEST_TIMEOUT_MS }, () => {
  it("accepts a required named parameter or a required first-object property without a type obligation", () => {
    expect(evaluate({
      "src/services/plain.ts": `
        export function createByName(actorContext: { actorId: string }, name: string): string { return name + actorContext.actorId; }
        export function createByProperty(input: { actorContext: object; name: string }): string { return input.name; }
        export const createArrow = (actorContext: string): string => actorContext;
        export function createMissing(name: string): string { return name; }
        export function createOptional(actorContext?: object): void { void actorContext; }
        export function createDefaulted(actorContext: object = {}): void { void actorContext; }
        export function createRest(...actorContext: object[]): void { void actorContext; }
        export function createOptionalProperty(input: { actorContext?: object }): void { void input; }
        export function createIndexOnly(input: Record<string, object>): void { void input; }
        export function createAny(input: any): void { void input; }
        export function createUnknownProperty(input: { actorContext: unknown }): void { void input; }
        export function createNoParameters(): void {}
        export function ignoredHelper(name: string): string { return name; }
      `,
    }, { symbols: "create*", parameter: "actorContext" })).toEqual([
      ["CONTEXT_PARAMETER_MISSING", "symbol:createMissing:parameter:actorContext", "src/services/plain.ts"],
      ["CONTEXT_PARAMETER_UNSAFE", "symbol:createOptional:parameter:actorContext", "src/services/plain.ts"],
      ["CONTEXT_PARAMETER_UNSAFE", "symbol:createDefaulted:parameter:actorContext", "src/services/plain.ts"],
      ["CONTEXT_PARAMETER_UNSAFE", "symbol:createRest:parameter:actorContext", "src/services/plain.ts"],
      ["CONTEXT_PARAMETER_UNSAFE", "symbol:createOptionalProperty:parameter:actorContext", "src/services/plain.ts"],
      ["CONTEXT_PARAMETER_MISSING", "symbol:createIndexOnly:parameter:actorContext", "src/services/plain.ts"],
      ["CONTEXT_PARAMETER_UNSAFE", "symbol:createAny:parameter:actorContext", "src/services/plain.ts"],
      ["CONTEXT_PARAMETER_UNSAFE", "symbol:createUnknownProperty:parameter:actorContext", "src/services/plain.ts"],
      ["CONTEXT_PARAMETER_MISSING", "symbol:createNoParameters:parameter:actorContext", "src/services/plain.ts"],
    ]);
  });

  it("proves exported type identity by symbol, not by structure", () => {
    expect(evaluate({
      "src/services/typed.ts": `${IMPORT}
        export function createDirect(actorContext: AuthorizationContext): void { void actorContext; }
        export function createAlias(actorContext: ContextAlias): void { void actorContext; }
        export function createDerived(actorContext: AdminContext): void { void actorContext; }
        export function createGeneric(actorContext: Envelope<AuthorizationContext>): void { void actorContext; }
        export function createIntersection(actorContext: AuthorizationContext & { extra: number }): void { void actorContext; }
        export function createUnion(actorContext: AuthorizationContext | AdminContext): void { void actorContext; }
        export function createProperty(input: { actorContext: AuthorizationContext }): void { void input; }
        export function createConstrained<T extends AuthorizationContext>(actorContext: T): void { void actorContext; }
        export function createLookalike(actorContext: Lookalike): void { void actorContext; }
        export function createStructural(actorContext: { actorId: string }): void { void actorContext; }
        export function createBadUnion(actorContext: AuthorizationContext | Lookalike): void { void actorContext; }
        export function createString(actorContext: string): void { void actorContext; }
        export function createUnconstrained<T>(actorContext: T): void { void actorContext; }
        export function createReadonly(actorContext: Readonly<AuthorizationContext>): void { void actorContext; }
        export function createRequired(actorContext: Required<AdminContext>): void { void actorContext; }
        export function createPartial(actorContext: Partial<AuthorizationContext>): void { void actorContext; }
      `,
    }, { symbols: "create*", parameter: "actorContext", expectedType: EXPECTED })).toEqual([
      ["CONTEXT_PARAMETER_TYPE_MISMATCH", "symbol:createGeneric:parameter:actorContext", "src/services/typed.ts"],
      ["CONTEXT_PARAMETER_TYPE_MISMATCH", "symbol:createLookalike:parameter:actorContext", "src/services/typed.ts"],
      ["CONTEXT_PARAMETER_TYPE_MISMATCH", "symbol:createStructural:parameter:actorContext", "src/services/typed.ts"],
      ["CONTEXT_PARAMETER_TYPE_MISMATCH", "symbol:createBadUnion:parameter:actorContext", "src/services/typed.ts"],
      ["CONTEXT_PARAMETER_TYPE_MISMATCH", "symbol:createString:parameter:actorContext", "src/services/typed.ts"],
      ["CONTEXT_PARAMETER_UNRESOLVED", "symbol:createUnconstrained:parameter:actorContext", "src/services/typed.ts"],
      ["CONTEXT_PARAMETER_TYPE_MISMATCH", "symbol:createPartial:parameter:actorContext", "src/services/typed.ts"],
    ]);
  });

  it("claims the configured type file so a parse failure there fails closed instead of proving from a recovered tree", () => {
    expect(evaluate({
      "src/auth/context.ts": "export interface AuthorizationContext { actorId: string\n",
      "src/services/plain.ts": "export function create(actorContext: { actorId: string }): void { void actorContext; }\n",
    }, { symbols: "create", parameter: "actorContext", expectedType: EXPECTED })).toEqual([
      ["CONTEXT_TYPE_UNRESOLVED", "type:src/auth/context.ts#AuthorizationContext", "src/auth/context.ts"],
      ["PARSE_FAILURE", "parse", "src/auth/context.ts"],
    ]);
  });

  it("matches only the exact intrinsic type", () => {
    expect(evaluate({
      "src/services/intrinsic.ts": `
        export function createString(tenantId: string): void { void tenantId; }
        export function createLiteral(tenantId: "fixed"): void { void tenantId; }
        export function createNumber(tenantId: number): void { void tenantId; }
        export function createBoolean(input: { tenantId: boolean }): void { void input; }
      `,
    }, { symbols: "create*", parameter: "tenantId", expectedType: { kind: "intrinsic", name: "string" } })).toEqual([
      ["CONTEXT_PARAMETER_TYPE_MISMATCH", "symbol:createLiteral:parameter:tenantId", "src/services/intrinsic.ts"],
      ["CONTEXT_PARAMETER_TYPE_MISMATCH", "symbol:createNumber:parameter:tenantId", "src/services/intrinsic.ts"],
      ["CONTEXT_PARAMETER_TYPE_MISMATCH", "symbol:createBoolean:parameter:tenantId", "src/services/intrinsic.ts"],
    ]);
  });

  it("fails proof once at the type subject when the configured type cannot resolve", () => {
    const source = { "src/services/any.ts": "export function create(actorContext: object): void { void actorContext; }\n" };
    expect(evaluate(source, { symbols: "create", parameter: "actorContext", expectedType: { ...EXPECTED, exportName: "Missing" } })).toEqual([
      ["CONTEXT_TYPE_UNRESOLVED", "type:src/auth/context.ts#Missing", "src/auth/context.ts"],
    ]);
    expect(evaluate(source, { symbols: "create", parameter: "actorContext", expectedType: { ...EXPECTED, exportName: "NOT_A_TYPE" } })).toEqual([
      ["CONTEXT_TYPE_UNRESOLVED", "type:src/auth/context.ts#NOT_A_TYPE", "src/auth/context.ts"],
    ]);
    expect(evaluate(source, { symbols: "create", parameter: "actorContext", expectedType: { ...EXPECTED, file: "src/auth/absent.ts" } })).toEqual([
      ["CONTEXT_TYPE_UNRESOLVED", "type:src/auth/absent.ts#AuthorizationContext", "src/auth/absent.ts"],
    ]);
  });
});
