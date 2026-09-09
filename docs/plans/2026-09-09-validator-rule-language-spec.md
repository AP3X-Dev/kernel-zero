# Design spec — validator rule language (named layers and three check kinds)

PRP: `docs/prp/2026-09-09-validator-rule-language.md`. Revision 4 (after verifier
rejections 1, 2, and 3). This spec fixes the shapes, algorithms, subject grammars, and file
layout the implementation must follow. Where the PRP leaves a choice, the choice
is made here and the reason stated.

## 1. Named layers (FR-LAY)

### Schema (`packages/profile-software-architecture/src/policy.ts`)

- `LayerNameSchema = SlugSchema(2, 40)` (the same grammar `metadata.name` uses).
- `RuleGlobList = uniqueArray(RelativeGlobSchema, 1, 100)` and `OptionalRuleGlobList = uniqueArray(RelativeGlobSchema, 0, 100)`: new aliases, same element schema as today (`RelativeGlobSchema` already accepts the string `layer:x` syntactically). They exist only so rule fields and `scope` can be told apart; there is no union and no per-element reference schema.
- Every check field that names files (`from`, `files`, `allowFrom`, `declarationFiles`) switches to the rule-only aliases. **`scope.include` and `scope.exclude` keep the glob-only `GlobList`/`OptionalGlobList`**, and the `superRefine` below rejects any `layer:` entry found there, so discovery never sees one.
- `RepositoryPolicySchema` gains `layers: z.record(LayerNameSchema, uniqueArray(RelativeGlobSchema, 1, 100)).optional()` refined to at most 50 keys. Layer values are globs only (nesting deferred, PRP section 9).
- One policy-level `superRefine` is the whole enforcement. It walks `scope.include`, `scope.exclude`, and every rule's four file-naming fields; for each entry starting with `layer:` it adds exactly one issue: `"Layer reference is not a slug: <entry>"` when the remainder fails `LayerNameSchema`; `"Layer reference is not allowed in scope: <entry>"` for scope fields; `"Layer is not declared: <name>"` (with the rule id and field) when the name is absent from `layers`. Absent `layers` plus any rule reference is therefore a schema error (validator exit 2). TM-V01 asserts each of the three messages.

### Expansion (`packages/profile-software-architecture/src/layers.ts`, new)

```ts
export const LAYER_REFERENCE_PREFIX = "layer:";
export function isLayerReference(value: string): boolean;
/** Equal policy whose rule file lists contain only globs. Idempotent. `layers` and `scope` untouched. */
export function resolvePolicyLayers(policy: RepositoryPolicy): RepositoryPolicy;
```

One list expands by replacing each reference with the layer's globs in declaration order, then de-duplicating while preserving first occurrence. Output is frozen. Field discovery is by name on the check object (`from`, `files`, `allowFrom`, `declarationFiles`), so a future kind that reuses those names inherits layers.

### Where expansion happens

- `packages/validator/src/runner.ts`: digest over the parsed document as today (`canonicalSha256(policy)` at the current line), then `evaluatePolicyChecks(resolvePolicyLayers(policy), repository)`. `explain`/`renderPolicy` keep the unexpanded document.
- `packages/profile-software-architecture/src/compatibility.ts`: `findingCompatibilityReason` calls `resolvePolicyLayers` on entry. `diffRules` does not expand (a layer edit diffs as a rule change).
- `packages/validator/src/engine.ts`: `evaluatePolicyChecks` throws `RepositoryProgramError("Policy layers must be resolved before evaluation.")` if any rule file list still holds a reference. Programming-error guard, not a finding.

### Digest, fingerprints, golden

The digest covers the parsed document, references included, so a policy without `layers` is byte-identical to today. Subjects never contain layer names. The golden fixture has no layers.

### Self-policy rewrite

`kernel-zero.policy.json` declares exactly the layers at least one rule references. FR-LAY-005 originally listed a seventh, `profiles`; no rule names profile files (the profile rules are module denials), so PRP FR-LAY-005 is amended to six layers on the same principle as PRP section 2 item 4 (nothing ships unexercised). The amendment is recorded in the PRP text and the advisor log.

```
ui:          apps/control/src/app/**/page.tsx, apps/control/src/app/**/layout.tsx
transport:   apps/control/src/app/api/**/*.ts
service:     apps/control/src/server/**/*.ts
persistence: packages/persistence/src/**/*.ts
kernel:      packages/domain/**/*.ts, packages/contracts/**/*.ts, packages/persistence/**/*.ts
validator:   packages/validator/**/*.ts
```

`ui-does-not-import-persistence` → `from: ["layer:ui"]`; `transport-does-not-import-repositories` → `from: ["layer:transport"]`; `server-modules-declare-boundary` → `files: ["layer:service", "layer:persistence"]`; `kernel-does-not-import-profiles` → `from: ["layer:kernel"]`; `validator-stays-network-and-database-free` → `from: ["layer:validator"]`; the three new rules use `layer:persistence` and `layer:transport`. `raw-database-client-is-contained` keeps its explicit globs (its `from` spans apps and three packages with no matching layer). The digest changes; the ADR records old and new.

## 2. Shared argument-shape prover (`packages/validator/src/checks/argument-shape.ts`, new)

Never emits findings; mirrors `static-registry.ts`.

```ts
export type PathProof =
  | { readonly kind: "present"; readonly value: ts.Expression; readonly literal: string | undefined }
  | { readonly kind: "missing" }
  | { readonly kind: "unprovable"; readonly reason: "not-literal" | "spread" | "computed" | "cycle" };

export function proveObjectPath(argument: ts.Expression | undefined, path: readonly string[], checker: ts.TypeChecker, sourceFile: ts.SourceFile): PathProof;

export type CallChain = { readonly chain: string; readonly unsafeReceiver: boolean };
/** The textual callee chain restrict-call-site matches, plus whether the innermost receiver expression has an unsafe type. */
export function resolveCallChain(call: ts.CallExpression, checker: ts.TypeChecker): CallChain | undefined;

export function chainMatches(chain: string, globs: readonly string[]): boolean; // matchesGlob over the chain; `*` spans dots because the chain has no `/`

/** Unresolved-callee heuristic shared by both call kinds; see below. */
export function couldMatchCallee(call: ts.CallExpression, globs: readonly string[]): string | undefined;
```

`proveObjectPath` rules:

1. `argument === undefined` → `missing`.
2. Unwrap parentheses, `as`, `satisfies`, non-null (`unwrapExpression`). `Object.freeze(<expr>)` unwraps to `<expr>` (new behaviour in this module; `asObjectLiteral` today handles only a direct literal argument).
3. Identifier: resolve the symbol; if its single declaration is a `const` `VariableDeclaration` in the same source file with an initializer, recurse with a `seen` set (cycle → `unprovable:cycle`). Any other binding → `unprovable:not-literal`.
4. Object literal, looking for `path[0]`:
   - A computed key that is not a string literal → `unprovable:computed`.
   - Find the property named `path[0]` (`propertyName`); shorthand counts.
   - If the key is present: every spread **after** it at this level must be harmless, else `unprovable:spread`. A spread is harmless when its operand (unwrapped) is an object literal, or a conditional whose branches are both object literals, and each such literal's **own top-level property list** has no spread, no computed key, and no member named `path[0]`. Property assignments, shorthand properties, methods, getters, and setters all count as members with their names. Nested values are not inspected: a spread of `{ generatedAt: { ...a, ...b } }` adds only the key `generatedAt` at this level, so it is harmless for any other key. This is what makes `{ workspaceId, ...(cond ? {} : { status }) }` and `evidence.ts`'s `where` literals provable. Spreads **before** the key are always harmless (the later literal key wins).
   - If the key is absent and any spread is present → `unprovable:spread`; absent with no spread → `missing`.
   - With segments remaining, recurse into the initializer; a non-object initializer with segments left → `unprovable:not-literal`.
5. Leaf: the identifier `undefined` or `void 0` → `missing`; otherwise `present`, with `literal` set for string literals and no-substitution templates.
6. A conditional at any level in the key's own position → `unprovable:not-literal` (ponytail: branch-wise proof is the upgrade).

`resolveCallChain`: `chain = resolveCalleeName(call.expression, checker, new Set())`; `undefined` stays `undefined`. `unsafeReceiver` is computed on the **raw** callee expression: descend `PropertyAccessExpression.expression` (and `ElementAccessExpression.expression`) without unwrapping until the innermost expression, then `containsUnsafeType(checker.getTypeAtLocation(innermost))`. `(db as any).policy.findMany` therefore reports an unsafe receiver even though the chain resolves to `db.policy.findMany`. An optional receiver (`db?.policy`) has `undefined` in its type and is also unsafe; that is intended (ponytail: an optional receiver cannot be proven to reach the callee).

`couldMatchCallee` (unresolved heuristic): only when the callee expression is a `PropertyAccessExpression`; take `root = expressionRootName(...)` and `last = the accessed name`; return the first glob whose last segment equals `last` (or is `*`) and whose first segment is `*` or equals `root`. Requires both ends to agree, unlike `calls.ts`' root-only test, so `*.findMany` does not fire on every unresolvable call.

## 3. `require-call-argument` (FR-ARG)

### Schema

```ts
z.strictObject({
  kind: z.literal("require-call-argument"),
  files: RuleGlobList,
  callee: uniqueArray(CalleeGlobSchema, 1, 100),
  argument: z.number().int().min(0).max(9).default(0),
  requiredPath: DottedPathSchema,
  allowFrom: OptionalRuleGlobList.default([]),
})
```

`CalleeGlobSchema`: `z.string().min(1).max(200).regex(/^[A-Za-z_$*][\w$*]*(?:\.[A-Za-z_$*][\w$*]*)*$/u)`. `DottedPathSchema`: 1..8 identifier segments joined by `.`.

Defaults note (CLAUDE.md rule 5): `argument` and `allowFrom` defaults move the digest of a policy that omits them. No stored policy can contain this kind yet, so nothing existing moves; the ADR says so.

### Evaluator (`checks/call-argument.ts`)

For each file in `files` minus `allowFrom` (skipping `failedPaths`), for every `CallExpression`:

1. `resolved = resolveCallChain(node)`. If `undefined`: when `rule.level === "error"` and `glob = couldMatchCallee(node, callee)` is defined, push raw `CALL_ARGUMENT_UNRESOLVED` with subject `call:<glob>:argument:<i>:<path>`; continue.
2. If `!chainMatches(resolved.chain, callee)` continue.
3. If `resolved.unsafeReceiver` → raw `CALL_ARGUMENT_UNPROVABLE`.
4. `proof = proveObjectPath(node.arguments[argument], path)`: `present` → nothing; `missing` → raw `CALL_ARGUMENT_MISSING`; `unprovable` → raw `CALL_ARGUMENT_UNPROVABLE`.

Subject `call:<chain>:argument:<i>:<requiredPath>`; location the call expression. Public mapping in `runner.ts`: `CALL_ARGUMENT_MISSING → CALL_ARGUMENT_MISSING`; `CALL_ARGUMENT_UNPROVABLE | CALL_ARGUMENT_UNRESOLVED → CALL_ARGUMENT_PROOF_FAILED`. (`CALL_RESOLUTION_FAILED` stays bound to `restrict-call-site`.)

### Compatibility

Codes `["CALL_ARGUMENT_MISSING", "CALL_ARGUMENT_PROOF_FAILED"]`. Subject grammar: `call:` + a chain matching one of `callee` via `chainMatches` (a glob itself is accepted, since the unresolved case reports the glob) + `:argument:` + the configured index + `:` + `requiredPath`.

### Messages

- `CALL_ARGUMENT_MISSING`: "A call to a governed operation omits a required argument field."
- `CALL_ARGUMENT_PROOF_FAILED`: "A call to a governed operation could not be proven to carry a required argument field."

### Fixtures (`packages/validator/fixtures/kinds/call-argument/`)

`queries.ts`: `declare const db: { policy: { findMany(a: unknown): void; updateMany(a: unknown): void }; other: { findMany(a: unknown): void } }`, `declare const workspaceId: string`, `declare const flag: boolean`, `declare function buildSelector(): unknown`. Cases: literal `where.workspaceId` (pass); `where` without it (missing); `const selector = { where: { workspaceId } }` then `db.policy.findMany(selector)` (pass); `{ where: { workspaceId, ...(flag ? {} : { status: "x" }) } }` (pass, harmless spread after); `{ where: { ...base, workspaceId } }` with `declare const base: object` (pass, spread before); `{ where: { workspaceId, ...base } }` (proof failed, opaque spread after); `{ where: { ...base } }` (proof failed, absent with spread); `{ where: { workspaceId: undefined } }` (missing); `db.policy.findMany(buildSelector())` (proof failed, not literal); `(db as any).policy.findMany({ where: { workspaceId } })` (proof failed, unsafe receiver); `db.other.findMany({})` under callee `db.policy.*` (no finding); `db["policy"].findMany({})` (`propertyChainName` resolves string-literal element access, so the chain is `db.policy.findMany` and `{}` yields `CALL_ARGUMENT_MISSING`); `db[key].findMany({})` with `declare const key: string` (chain unresolvable; `couldMatchCallee` sees root `db` and last `findMany`, glob `db.policy.*` has first segment `db` and last `*`, so raw `CALL_ARGUMENT_UNRESOLVED` → `CALL_ARGUMENT_PROOF_FAILED` with subject `call:db.policy.*:argument:0:where.workspaceId`).

## 4. `restrict-state-transition` (FR-STA)

### Schema

```ts
z.strictObject({
  kind: z.literal("restrict-state-transition"),
  callee: uniqueArray(CalleeGlobSchema, 1, 100),
  argument: z.number().int().min(0).max(9).default(0),
  field: DottedPathSchema,          // e.g. data.state
  allowFrom: OptionalRuleGlobList.default([]),
  transitions: uniqueArray(z.strictObject({ from: z.union([IdentifierSchema, z.literal("*")]), to: IdentifierSchema }), 0, 100).default([]),
})
```

Predicate path: `field` with its first segment replaced by `where`. `ruleClaimsPath` returns `true` for every file.

### Evaluator (`checks/state-transition.ts`)

For every call in every file (skipping `failedPaths`):

1. `resolved = resolveCallChain(node)`; if undefined and `couldMatchCallee` names a glob at `error` level → raw `STATE_TRANSITION_UNPROVABLE`, subject `transition:<leaf>:<glob>`; continue. If the chain does not match, continue. If `unsafeReceiver` → `STATE_TRANSITION_UNPROVABLE`.
2. `write = proveObjectPath(arg, field)`: `missing` → not a write of this field, continue; `unprovable` → raw `STATE_TRANSITION_UNPROVABLE`, subject `transition:<leaf>:<chain>`.
3. File not in `allowFrom` → raw `STATE_TRANSITION_DENIED_WRITER`, subject `transition:<leaf>:<chain>`; continue.
4. `transitions` empty → done.
5. `to = write.literal`; `from = proveObjectPath(arg, predicatePath)`. If `to === undefined`, or `from.kind !== "present"`, or `from.literal === undefined` → `STATE_TRANSITION_UNPROVABLE`, chain subject.
6. No transition with `(from === "*" || from === fromLiteral) && to === toLiteral` → raw `STATE_TRANSITION_DENIED_PAIR`, subject `transition:<leaf>:<from>-><to>`.

Public mapping: `STATE_TRANSITION_DENIED_WRITER | STATE_TRANSITION_DENIED_PAIR → STATE_TRANSITION_DENIED`; `STATE_TRANSITION_UNPROVABLE → STATE_TRANSITION_PROOF_FAILED`.

Compatibility: `STATE_TRANSITION_DENIED` subject is `transition:<leaf>:<chain or glob matching callee>` or `transition:<leaf>:<from>-><to>` (identifiers or `*`); `STATE_TRANSITION_PROOF_FAILED` accepts only the chain form. `<leaf>` is the last segment of `field`. The two forms separate because a chain segment cannot contain `-`.

Messages: `STATE_TRANSITION_DENIED`: "A governed state field is written outside its allowed writer or through an unlisted transition." `STATE_TRANSITION_PROOF_FAILED`: "A write to a governed state field could not be proven against the allowed transitions."

Fixtures (`packages/validator/fixtures/kinds/state-transition/`): `allowed/writer.ts` with `draft→approved` (pass), `approved→active` (pass), `draft→active` (denied pair), `where` without `state` (proof failed), `data: { ...patch }` (proof failed), `data: { canonicalJson: "{}" }` (no finding); `elsewhere/rogue.ts` with a `data.state` write (denied writer).

## 5. `require-ingress-parse` (FR-ING)

### Schema

```ts
z.strictObject({
  kind: z.literal("require-ingress-parse"),
  files: RuleGlobList,
  symbols: NonemptyExactStringSchema,   // glob over exported function names; the glob grammar has no `{a,b}` alternation, so the self-policy declares one rule per HTTP verb
  parserCalls: ExactList,
  readerCalls: ExactList.default([]),
  allowedCalls: ExactList.default([]),
})
```

### Evaluator (`checks/ingress.ts`)

Exported symbols matching `symbols` are found through `checker.getExportsOfModule`. For each match:

- If the export is not a function declaration with a body or an exported `const` whose initializer is an arrow or function expression (`collectExportedFunctions` semantics), it is an ingress the rule cannot see inside: raw `INGRESS_UNRESOLVED`, subject `symbol:<name>:proof`, location the export. `export const POST = factory(...)` is therefore a proof failure, never a silent skip.

For a provable function:

1. Untrusted set `U`: every parameter binding. Single forward pass over the body in source order:
   - `const`/`let` declarations, and assignments to locals, whose right side *carries* untrusted (below) → add the binding to `U`. Membership is monotone: a later assignment of a trusted value never removes a binding from `U` (PRP FR-ING-005 as amended).
   - One-level destructuring of a `U` value → add the bindings.
2. An expression **carries** untrusted when it is a `U` symbol; a member or element access on a carrying expression; a call whose resolved chain is in `readerCalls` (the reader result is untrusted by definition); an `await`, parenthesised, `as`, `satisfies`, or non-null wrapper of a carrying expression; or an object or array literal any of whose values carries untrusted (recursive). Results of `parserCalls` and `allowedCalls` calls are trusted.
3. For every `CallExpression` in the body with at least one argument that carries untrusted: `chain = resolveCallChain(...)?.chain`. `parserCalls` → `parsed = true`; `readerCalls` or `allowedCalls` → fine; `undefined` → raw `INGRESS_UNRESOLVED` (`symbol:<name>:proof`); otherwise raw `INGRESS_ESCAPE`, subject `symbol:<name>:escape:<chain>`.
4. A `return` whose expression carries untrusted → `INGRESS_ESCAPE`, `escape:return`. Assignment of a carrying value to a binding declared outside the function → `INGRESS_ESCAPE`, `escape:<bindingName>`. A carrying value captured by a nested function or arrow (any reference to a `U` symbol inside it) → `INGRESS_ESCAPE`, `escape:closure`, unless the nested function is itself an argument to an `allowedCalls` call.
5. `for`/`while`/`do` statements, and destructuring deeper than one level of a `U` value → `INGRESS_UNRESOLVED`; evaluation of that function stops at the first proof failure. Reassignment of a local is not a proof failure; it widens `U` per step 1.
6. After the pass, if `parsed` is false and nothing was recorded → raw `INGRESS_PARSE_MISSING`, subject `symbol:<name>:parser`, location the function name.

`catch (error)` bindings are not parameters and are trusted. `try`/`catch`/`if` are walked normally.

Public mapping: `INGRESS_PARSE_MISSING → INGRESS_PARSE_MISSING`; `INGRESS_ESCAPE → INGRESS_ESCAPE`; `INGRESS_UNRESOLVED → INGRESS_PROOF_FAILED`.

Compatibility: subjects `symbol:<qualifiedName>:parser`, `symbol:<qualifiedName>:escape:<target>`, `symbol:<qualifiedName>:proof`, where the qualified name (or its last segment) matches `symbols` and `<target>` is an identifier chain, the literal `return`, or the literal `closure`.

Messages: `INGRESS_PARSE_MISSING`: "An ingress function never passes its input through a required parser." `INGRESS_ESCAPE`: "Unparsed ingress input reaches a call, return, or binding outside the allowed set." `INGRESS_PROOF_FAILED`: "Ingress input flow could not be proven within the function."

Fixtures (`packages/validator/fixtures/kinds/ingress/`): `handlers.ts` exporting `POST` (reader → parser → allowed submit with an object literal carrying context, pass), `GET` (returns `request`, escape:return), `PUT` (`log(request.headers)`, escape:log), `PATCH` (`for` over `request`, proof), `DELETE` (never parses, parser missing), `HEAD` (`export const HEAD = factory()`, proof), plus a non-exported function that would fail and is ignored.

## 6. Engine wiring

- `engine.ts`: three `case`s in `evaluateRule`; `ruleClaimsPath`: `require-call-argument` → `files`; `restrict-state-transition` → `true`; `require-ingress-parse` → `files`.
- `findings.ts` `RawFindingMessageCode` gains `CALL_ARGUMENT_MISSING`, `CALL_ARGUMENT_UNPROVABLE`, `CALL_ARGUMENT_UNRESOLVED`, `STATE_TRANSITION_DENIED_WRITER`, `STATE_TRANSITION_DENIED_PAIR`, `STATE_TRANSITION_UNPROVABLE`, `INGRESS_PARSE_MISSING`, `INGRESS_ESCAPE`, `INGRESS_UNRESOLVED`.
- `runner.ts` `publicMessageCode` gains the mappings above; the exhaustive switch enforces completeness.
- Profile `evidence.ts` message table and `FindingMessageCode` gain the seven public codes; `createEvidenceSchema` closes to them automatically.

## 7. Self-policy additions and the edits they force

```
tenant-queries-carry-workspace       require-call-argument   files [layer:persistence], callee [*.findFirst, *.findMany, *.updateMany, *.deleteMany, *.count], requiredPath where.workspaceId, allowFrom [packages/persistence/src/audit.ts]
policy-revision-state-is-governed    restrict-state-transition callee [*.policyRevision.updateMany], field data.state, allowFrom [packages/persistence/src/policies.ts], transitions draft->approved, approved->active, active->superseded
route-handlers-parse-their-input-*   require-ingress-parse (five rules, suffixes get/post/put/patch/delete) files [layer:transport], symbols <VERB>, parserCalls [readEvidenceRequest], readerCalls [dependencies.resolveSubmission], allowedCalls [dependencies.service.submit, errorResponse]
```

Expected outcome on the current tree, verified against the sources:

- `findUnique` is not in the callee list: compound-unique selectors (`where: { workspaceId_runId: { runId, workspaceId } }` in `evidence.ts`) put the tenant key inside the unique-key object, and the composite unique index already scopes them. The ADR records this.
- `evidence.ts` `listEvidenceRuns` and `listEvidenceFindings` build `where` as `{ workspaceId, ...conditional spreads }`; every spread operand is a conditional of object literals with known keys, so section 2 rule 4 proves them without edits. `deleteExpiredEvidence` carries `workspaceId` literally.
- `policies.ts` writes `state` only with a literal `where.state` (`draft→approved` in `freezeDraftRevision`; `active→superseded` and `approved→active` in `activatePolicyRevision` and `retirePolicyPack`); all listed. No other file writes `policyRevision.updateMany` `data.state`.
- The evidence route is `export const POST = createEvidencePostHandler(productionDependencies)`, which section 5 reports as `INGRESS_PROOF_FAILED`. Forced edit, named under SC-V06 and, because it removes the dependency-injection seam, flagged for the owner in the ADR: `route.ts` becomes

  ```ts
  export async function POST(request: Request): Promise<Response> {
    const dependencies = evidenceDependencies();          // no arguments; trusted
    let correlationId = "unavailable";
    try {
      const context = await dependencies.resolveSubmission(request);   // readerCalls: result untrusted
      if (context === null) return errorResponse(401, "UNAUTHENTICATED", "Authentication is required.", correlationId);
      correlationId = context.correlationId;                            // local now untrusted
      const document = await readEvidenceRequest(request);              // parserCalls: parsed = true, result trusted
      const result = await dependencies.service.submit({ correlationId: context.correlationId, document, workspaceId: context.workspaceId }); // allowedCalls
      return Response.json(result, { status: result.kind === "created" ? 201 : 200 });   // result trusted, no untrusted argument
    } catch (error) {                                                   // catch binding trusted
      if (error instanceof EvidenceIngressError) return errorResponse(error.status, error.code, error.message, correlationId); // allowedCalls
      return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.", correlationId);
    }
  }
  ```

  Untrusted set after the pass: `request`, `context` (bound from a `readerCalls` call), `correlationId` (assigned from `context.correlationId`). Every callee is a textual property chain or an identifier bound to a declaration, so `resolveCalleeName` resolves all of them (`dependencies.resolveSubmission`, `errorResponse`, `readEvidenceRequest`, `dependencies.service.submit`, `Response.json`). `evidenceDependencies()` is a module-level accessor returning the production object (runtime config for `resolveRequestContext`, `EvidenceService` over `createEvidenceRepository`). `createEvidencePostHandler` and the `EvidenceRouteDependencies` injection type are deleted. `route.test.ts` keeps its three cases with `vi.mock` of `../../../../../server/runtime` (config with a known token and workspace, prisma stub) and of `../../../../../server/evidence/evidence-service` (submit resolving `created` / `duplicate`): 401 when the bearer header is absent, 201 then 200 for created and duplicate, 415 for `content-encoding: br` through the real `readEvidenceRequest`.

## 8. Tests, fixtures, documentation

| Area | File | Cases |
| --- | --- | --- |
| Schema (TM-V01) | `policy.test.ts` | layers accept/reject, malformed layer name, undeclared reference, reference in `scope` rejected, each new kind accept/reject, bad callee glob, bad dotted path |
| Layers (TM-V02) | `layers.test.ts` (new) | expansion, idempotence, identity without layers, `scope` untouched, fast-check property that reference order never changes the sorted glob set |
| Prover | `checks/argument-shape.test.ts` (new) | every `PathProof` branch incl. harmless and opaque spreads, unsafe and optional receivers, `couldMatchCallee` both-ends rule |
| Kinds (TM-V03) | `checks/call-argument.test.ts`, `checks/state-transition.test.ts`, `checks/ingress.test.ts` (new) | exact finding lists with subject and location. TM-V03 names `engine.test.ts`; this repo discharges per-kind matrices in `checks/*.test.ts` (as `context.test.ts`, `property-write.test.ts`, `registry.test.ts` do) and that is the deliberate reading. |
| Compatibility (TM-V04) | `compatibility.test.ts` | code and subject mismatch per new code |
| Golden (TM-V05) | `golden.test.ts` | unchanged and green; additionally asserts `filesScanned === 12` and the pinned `manifestDigest`, since new fixtures live under `fixtures/kinds/`, outside the golden `include` |
| Self-policy (TM-V06) | `runner.test.ts` | unchanged; bite proofs are manual steps recorded per ADR |
| Benchmark (TM-V07) | `scripts/benchmark-validator.ts` | one rule of each new kind added to the policy; numbers quoted in the ADR |
| Contracts (TM-V08, FR-DOG-002) | `scripts/generate-contracts.ts`, `docs/contracts/README.md` | `contracts:generate` then `contracts:check` exit 0; README gains one paragraph per kind in the register of the existing kinds: config, codes, subject grammar, proof-failure conditions; the layers paragraph goes under "RepositoryPolicy v1" |
| Docs (FR-DOG-003) | `packages/validator/README.md`, `docs/validator-and-hooks.md`, `.claude/skills/kz-policy-rule/SKILL.md` | one policy example per kind and one `layers` example; the skill's existing-kinds list names the three new kinds and layers |
| Traceability (FR-DOG-004) | `scripts/generate-traceability.ts` | groups FR-LAY (5), FR-ARG (4), FR-STA (5), FR-ING (6), FR-DOG (5); `docs/TRACEABILITY.md` regenerated |

## 9. Sequence

Matches PRP section 12: layers, prover plus call-argument, state-transition, ingress, dogfood/docs, PR. One commit and one ADR per step.

**Owner checkpoint (PRP section 12 step 4).** Before `route.ts` is edited in the ingress step, the run pauses and asks the owner to confirm removal of `createEvidencePostHandler` and the `EvidenceRouteDependencies` injection seam (CLAUDE.md refactoring rule: existing functionality is confirmed before removal). Without that confirmation the run stops after the state-transition step with layers, `require-call-argument`, and `restrict-state-transition` delivered and the ingress kind undelivered, and the run-state records the block.
