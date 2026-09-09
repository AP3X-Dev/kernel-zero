# Argument-shape prover and `require-call-argument`

## Context

PRP sentence 3 (`docs/prp/2026-09-09-validator-rule-language.md`): every
tenant query carries the tenant identifier. Today the self-policy proves only
that `tenantSelector` takes a `workspaceId` parameter
(`tenant-selector-requires-workspace`); nothing proves that each Prisma
selector in `packages/persistence` actually spells `where.workspaceId`.
Deleting one `workspaceId` from a `findFirst` selector passed every gate.

The validator already resolves callee chains for `restrict-call-site`
(`resolveCalleeName` in `packages/validator/src/ast.ts`) and proves object
shapes for closed registries (`packages/validator/src/static-registry.ts`),
but neither proves a dotted path inside a call argument, and the registry
prover treats every spread as opaque, which would reject the conditional
spreads `evidence.ts` uses to build `where` (`{ workspaceId, ...(x === undefined ? {} : { x }) }`).

This is `kz-policy-rule` branch B (new check kind) plus one branch-A rule in the
self-policy. Spec: `docs/plans/2026-09-09-validator-rule-language-spec.md`
sections 2, 3, 6, 7.

## Decision

Add one shared prover and one check kind; the kernel packages are untouched.

- `packages/validator/src/checks/argument-shape.ts` (new) exports
  `proveObjectPath`, `resolveCallChain`, `chainMatches`, and
  `couldMatchCallee`. It never emits findings. `proveObjectPath` returns
  `present` (with the string-literal value when there is one), `missing`, or
  `unprovable` with reason `not-literal`, `spread`, `computed`, or `cycle`. It
  unwraps parentheses, `as`, `satisfies`, non-null, and an exact
  `Object.freeze(<expr>)`; follows an identifier only to a same-file `const`
  with exactly one declaration and an initializer; and treats a spread after
  the searched key as harmless only when its operand is an object literal, or
  a conditional whose branches are both object literals, whose own top-level
  members (property assignments, shorthand, methods, getters, setters) carry
  no spread, no computed key, and no member with the searched name. Spreads
  before the key are always harmless because the later literal key wins. A
  conditional in the key's own position is `not-literal`
  (`// ponytail:` branch-wise proof is the upgrade).
- `resolveCallChain` reuses `resolveCalleeName` for the chain and judges
  `unsafeReceiver` on the raw innermost receiver expression, descending
  property and element accesses without unwrapping, so `(db as any).policy.findMany`
  reports an unsafe receiver even though its chain is `db.policy.findMany`.
  An optional root (`db?.policy`) has `undefined` in its type and is unsafe by
  design. `couldMatchCallee` fires only for a property-access callee whose
  root identifier and accessed name both agree with a glob's first and last
  segments, unlike the root-only test in `checks/calls.ts`, so `*.findMany`
  does not name every unresolvable call.
- Schema (`packages/profile-software-architecture/src/policy.ts`): member
  `require-call-argument` with `files: RuleGlobList`,
  `callee: uniqueArray(CalleeGlobSchema, 1, 100)`,
  `argument: int 0..9 default 0`, `requiredPath: DottedPathSchema`,
  `allowFrom: OptionalRuleGlobList default []`. `CalleeGlobSchema` is
  `^[A-Za-z_$*][\w$*]*(?:\.[A-Za-z_$*][\w$*]*)*$`; `DottedPathSchema` is 1 to 8
  identifier segments. Both are exported so compatibility parses the subject
  with the same grammar.
- Evaluator (`packages/validator/src/checks/call-argument.ts`): for every call
  in `files` minus `allowFrom`, skipping `failedPaths`: unresolved chain at
  `error` level with a `couldMatchCallee` glob → raw `CALL_ARGUMENT_UNRESOLVED`
  with the glob as the chain; chain not matching → skip; unsafe receiver → raw
  `CALL_ARGUMENT_UNPROVABLE`; otherwise `proveObjectPath` on
  `arguments[argument]`: `missing` → raw `CALL_ARGUMENT_MISSING`,
  `unprovable` → raw `CALL_ARGUMENT_UNPROVABLE`. Subject
  `call:<chain>:argument:<index>:<requiredPath>`, location the call
  expression. `engine.ts` dispatches the kind and `ruleClaimsPath` claims
  `files`. `runner.ts` maps `CALL_ARGUMENT_MISSING` to itself and both
  `UNPROVABLE` and `UNRESOLVED` to the public `CALL_ARGUMENT_PROOF_FAILED`;
  `CALL_RESOLUTION_FAILED` stays bound to `restrict-call-site`.
- Compatibility: `messageCodesByKind["require-call-argument"]` is
  `["CALL_ARGUMENT_MISSING", "CALL_ARGUMENT_PROOF_FAILED"]`; a subject is
  compatible when it is `call:` + a chain that parses as a callee glob and
  matches one of `callee` (a glob itself matches its own pattern, which is how
  the unresolved case is accepted) + `:argument:` + the configured index + `:`
  + `requiredPath`.
- Fixture `packages/validator/fixtures/kinds/call-argument/queries.ts`
  (under `fixtures/kinds`, outside the golden include and the self-policy
  scope) with the thirteen cases spec section 3 enumerates;
  `checks/call-argument.test.ts` pins the exact finding list with subject and
  location in engine order. The spec's prose says "twelve"; its list has
  thirteen entries and all thirteen are covered.
- Self-policy rule `tenant-queries-carry-workspace`: `files: ["layer:persistence"]`,
  `callee: ["*.findFirst", "*.findMany", "*.updateMany", "*.deleteMany", "*.count"]`,
  `requiredPath: "where.workspaceId"`, `allowFrom: ["packages/persistence/src/audit.ts"]`
  (audit rows are keyed by `workspaceOpaqueId`). No persistence file needed
  an edit: `evidence.ts`'s conditional spreads are provable by the harmless
  rule above, and every other selector spells `workspaceId` literally.
- Benchmark policy gains one `require-call-argument` rule
  (`callee: ["*.findMany"]`); the corpus has no calls, so it produces no
  findings and measures only the walk.

## Invariants touched

1. Definite policy violations fail closed. A provable selector without the
   path is `CALL_ARGUMENT_MISSING`; anything the prover cannot see through
   (opaque spread, computed key, non-literal value, `any` receiver,
   unresolvable callee that could match) is `CALL_ARGUMENT_PROOF_FAILED`,
   never a pass. Proof: `argument-shape.test.ts` (every `PathProof` branch),
   `call-argument.test.ts` (exact matrix), the bite proof below.
3. Every tenant selector carries `workspaceId`. Now proven at every
   `findFirst`/`findMany`/`updateMany`/`deleteMany`/`count` call in
   `layer:persistence`, not only at `tenantSelector`'s signature. Proof: the
   bite proof below.
10. Local validation is deterministic and network-free. The prover is a pure
    function of the program; `npm run validator:self` twice produced the same
    `integrity.digest` (quoted below).
11. Public wire formats are versioned and digests are over document content.
    See Contract impact and the schema-default note.
12. Kernel packages never import a profile. Unchanged:
    `git diff --stat -- packages/domain packages/contracts packages/persistence`
    is empty after the bite restore.

Invariants 2, 4, 5, 6, 7, 8, 9 are unaffected: no control-plane change, no
governed action, no new ingress, no UI.

## Contract impact

Policy `kernel-zero.dev/v1`: additive. One new discriminated-union member;
every stored policy parses unchanged and keeps its digest. Existing rule
fields, subjects, and fingerprints are untouched.

Evidence `kernel-zero.dev/evidence/v1`: additive. The closed `messageCode`
enum grows from fifteen to seventeen public codes with
`CALL_ARGUMENT_MISSING` ("A call to a governed operation omits a required
argument field.") and `CALL_ARGUMENT_PROOF_FAILED` ("A call to a governed
operation could not be proven to carry a required argument field."). The PRP
section 6 seven-code list for this feature now has two of its seven delivered;
existing codes, strings, and fingerprints are untouched, so every stored run
still re-validates. Exception bundles: unchanged.

Generated contracts regenerated: `docs/contracts/repository-policy-v1.schema.json`,
`docs/contracts/repository-evidence-v1.schema.json`, and one paragraph in
`docs/contracts/README.md`; `npm run contracts:check` exit 0.

Golden fixture `packages/validator/fixtures/golden/**`: byte-identical
(`git diff --stat -- packages/validator/fixtures/golden` empty).

Self-policy digests (the document changed, so both moved):

| | before (policy-layers ADR) | after |
| --- | --- | --- |
| `policy.digest` | `sha256:b9191f8b8f71e78ab39d221b44a8af37635bab55c8999aedb879a99e35c424d9` | `sha256:2453c919f39582e2c9bd8c4a0cabd62853b1f7473cf67bd691f2004c46bda5a1` |
| `integrity.digest` | `sha256:3cf09d734a23a4470eb4bf3a238ec4a9782146df73c9cc3cb10be690a1bcc824` | `sha256:4cb0114b6adc3abe40f17b19fbcc87f455edd60ca41d984a373fdd49675e2177` |

The integrity digest also reflects the manifest gaining two source files
(`checks/argument-shape.ts`, `checks/call-argument.ts`; 92 to 94 files).

## Schema-default digest note

`argument` defaults to `0` and `allowFrom` to `[]`. The policy digest is
`canonicalSha256` of the schema-parsed document, so a stored policy that
declares this kind and omits either field would parse to a document carrying
both keys and its digest would move (CLAUDE.md rule 5). No stored policy can
contain this kind yet, because the kind did not exist before this change, so
nothing existing moves. The self-policy spells both fields explicitly.

## findUnique exclusion

`findUnique` is deliberately not in the callee list. Its selectors are
compound-unique objects (`where: { workspaceId_runId: { runId, workspaceId } }`
in `evidence.ts`), which put the tenant key inside the unique-key object
rather than at `where.workspaceId`, and the composite unique index already
scopes the lookup to one workspace. Listing it would produce a false
`CALL_ARGUMENT_MISSING` on every correct call; proving the nested path would
need a per-model key name the policy cannot know.

## Bite proof

Deleted `workspaceId: input.workspaceId` from the `findFirst` selector in
`requestException` (`packages/persistence/src/exceptions.ts` line 24), ran
`npm run validator:self`, restored with `git checkout -- packages/persistence/src/exceptions.ts`,
ran again.

```text
kernel-zero: fail (1 errors, 0 warnings, 0 excepted, 94 files)
error tenant-queries-carry-workspace packages/persistence/src/exceptions.ts:24:28 CALL_ARGUMENT_MISSING call:tx.policyRevision.findFirst:argument:0:where.workspaceId
  remediation: Put workspaceId in the where selector of every tenant-scoped query so a sibling tenant's rows are never reachable.
bite exit 1

(after git checkout -- packages/persistence/src/exceptions.ts)
kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 94 files)
exit 0
git diff --stat -- packages/domain packages/contracts packages/persistence   (empty)
```

Working-tree note: `git checkout --` rewrote the file with LF per
`.gitattributes` (`eol=lf`) while this checkout held a CRLF copy
(`core.autocrlf=true`), which moved the manifest digest with zero content
change (`git diff` empty in both states). The file is left at LF, the
git-clean state; the two determinism runs quoted below were taken on that
final tree, after every edit in this step.

## FR-IDs

FR-ARG-001 (schema with `CalleeGlob` and `DottedPath`, defaults 0 and `[]`),
FR-ARG-002 (literal, frozen, or same-file-const argument; non-computed,
non-spread segments; leaf other than `undefined`), FR-ARG-003 (codes and the
`call:<chain>:argument:<i>:<path>` subject; unresolvable callees at `error`
level map to `CALL_ARGUMENT_PROOF_FAILED` through raw
`CALL_ARGUMENT_UNRESOLVED` rather than reusing `CALL_RESOLUTION_FAILED`, as
spec section 3 fixes), FR-ARG-004 (self-policy rule with `audit.ts` as the
only `allowFrom`, proven to bite).

## Verification command

Node 22 (`export PATH="/c/Users/Guerr/AppData/Roaming/fnm/node-versions/v22.22.3/installation:$PATH"`).

```text
npx vitest run packages/profile-software-architecture
  Test Files  6 passed (6)
       Tests  106 passed (106)

npm run test:validator
  Test Files  11 passed (11)
       Tests  88 passed (88)

npm run validator:self   (run 1)
  kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 94 files)
  integrity.digest sha256:4cb0114b6adc3abe40f17b19fbcc87f455edd60ca41d984a373fdd49675e2177
npm run validator:self   (run 2)
  kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 94 files)
  integrity.digest sha256:4cb0114b6adc3abe40f17b19fbcc87f455edd60ca41d984a373fdd49675e2177

npm run benchmark:validator
  {"deterministic":true,"files":5000,"firstMs":7257,"limitMs":30000,"limitRssBytes":1073741824,"peakObservedRssBytes":479674368,"secondMs":5267}

npm run contracts:generate && npm run contracts:check   exit 0
git diff --stat -- packages/validator/fixtures/golden   (empty)
git diff --stat -- packages/domain packages/contracts packages/persistence   (empty)
npm run typecheck   exit 0
npm run lint        exit 0
```

`npm run verify` on this tree: exit 0.

```text
kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 94 files)
unit         Test Files 48 passed (48)   Tests 324 passed (324)
architecture Test Files 1 passed (1)     Tests 1 passed (1)
integration  Test Files 3 passed (3)     Tests 7 passed (7)
```
