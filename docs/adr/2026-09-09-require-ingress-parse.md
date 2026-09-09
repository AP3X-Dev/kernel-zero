# `require-ingress-parse`

## Context

PRP `docs/prp/2026-09-09-validator-rule-language.md` FR-ING: every external
payload is schema-validated before it reaches a service. The existing
`public-evidence-is-parsed` rule (`require-boundary-parse`) proves that one
named boundary call inside `evidence-service.ts` receives a parsed value; nothing
proved that the transport route itself parses before the request escapes. The
route was `export const POST = createEvidencePostHandler(productionDependencies)`,
a handler built by a factory, so no intra-procedural proof over the exported
symbol was possible at all.

This is `kz-policy-rule` branch B (new check kind) plus five branch-A rules in
the self-policy. Spec: `docs/plans/2026-09-09-validator-rule-language-spec.md`
sections 5, 6, 7, 8; plan step 4.

## Decision

- Schema (`packages/profile-software-architecture/src/policy.ts`): member
  `require-ingress-parse` with `files: RuleGlobList`,
  `symbols: NonemptyExactStringSchema` (a glob over exported names; the glob
  grammar has no alternation, so the self-policy declares one rule per verb),
  `parserCalls: ExactList`, `readerCalls` and `allowedCalls` as
  `uniqueArray(NonemptyExactStringSchema, 0, 100).default([])`. The spec wrote
  `ExactList.default([])`; a Zod 4 default short-circuits parsing, so that
  shape would accept an absent list and reject an explicit `[]`. An explicit
  empty list must mean the same as an absent one, hence the 0..100 element
  list.
- Evaluator (`packages/validator/src/checks/ingress.ts`, new). Exports are
  read through `checker.getExportsOfModule`; a value export matching
  `symbols` that is not a function declaration with a body or a `const`
  bound directly to an arrow or function expression is raw
  `INGRESS_UNRESOLVED` at the export (`export const HEAD = factory()` is a
  proof failure, never a silent skip). Type-only exports are not ingresses
  and are skipped. For a provable function: every parameter binding is
  untrusted; one forward pass in source order widens the set through
  declarations and assignments to locals whose right side carries untrusted,
  and through one level of destructuring; membership is monotone. An
  expression carries untrusted when it is an untrusted binding, a member or
  element access on one, a `readerCalls` result, a wrapper (`await`,
  parentheses, `as`, `satisfies`, non-null) of one, or an object or array
  literal containing one. Sinks: a call with an untrusted argument must
  resolve to `parserCalls` (sets `parsed`), `readerCalls`, or `allowedCalls`;
  an unresolvable callee is `INGRESS_UNRESOLVED`; any other chain is
  `INGRESS_ESCAPE` with `escape:<chain>`. A `return` of an untrusted value is
  `escape:return`; assignment to a binding declared outside the function is
  `escape:<name>`; a nested function referencing an untrusted binding is
  `escape:closure` unless it is itself an argument to an `allowedCalls`
  call. Any `for`/`while`/`do` statement, destructuring deeper than one
  level of an untrusted value, and (the plan's defensive default) an
  untrusted value reaching `new`, a tagged template, `throw`, `yield`, or a
  property write on a non-local object are `INGRESS_UNRESOLVED`; evaluation
  of that function stops there. After the pass, `parsed === false` with
  nothing recorded is `INGRESS_PARSE_MISSING` at the function name.
- Deliberate readings beyond the spec text, all fail-closed:
  1. The receiver of a method call counts as an argument: `request.json()`
     is an escape (`escape:request.json`) unless the chain is listed. Spec
     step 3 conditioned on arguments only, which would have let a method on
     the raw request launder its result.
  2. Carrying is widened with conditionals, `??`/`||`/`&&`, and template
     spans, so a value chosen from or built around untrusted input stays
     untrusted.
  3. A property write on a local object widens that local rather than
     failing; only a non-local target is the defensive proof failure.
  4. Closures are judged after the pass against the final untrusted set,
     which is a superset of the set at any earlier point because membership
     is monotone; only closures seen before a proof failure are judged.
- `findings.ts` gains `INGRESS_PARSE_MISSING`, `INGRESS_ESCAPE`,
  `INGRESS_UNRESOLVED`; `engine.ts` dispatches the kind and `ruleClaimsPath`
  uses `files`; `runner.ts` maps `INGRESS_UNRESOLVED -> INGRESS_PROOF_FAILED`
  and the other two to themselves.
- Compatibility: `messageCodesByKind["require-ingress-parse"]` is the three
  public codes. Subjects are `symbol:<qualifiedName>:` plus a suffix each
  code owns: `parser` for `INGRESS_PARSE_MISSING`, `proof` for
  `INGRESS_PROOF_FAILED`, `escape:<target>` for `INGRESS_ESCAPE` where
  `<target>` is an identifier chain (`return` and `closure` are identifier
  chains, so one grammar covers all three). The qualified name or its last
  segment must match `symbols`.
- Fixtures `packages/validator/fixtures/kinds/ingress/handlers.ts` (the spec's
  seven cases plus `OPTIONS` for a closure escape, `TRACE` for the
  allowed-call closure exemption, and `CONNECT` for monotone reassignment)
  and `checks/ingress.test.ts` pinning the exact matrix with subject and
  location, the symbol glob, the reader/allowed toggles, and the
  parser-missing precedence.
- **Forced route edit, owner-confirmed on 2026-09-09.** The factory-built
  export was `INGRESS_PROOF_FAILED` by construction, and the fix is the route,
  not the rule (FR-ING-006). The owner confirmed removal of
  `createEvidencePostHandler` and the `EvidenceRouteDependencies` injection
  seam before the edit (CLAUDE.md refactoring rule). `route.ts` now exports
  `async function POST(request)` whose body is the spec section 7 sketch and a
  module-level `evidenceDependencies()` accessor with no parameters returning
  `{ resolveSubmission, service }` from `getRuntime().config` and
  `EvidenceService` over `createEvidenceRepository(runtime.prisma)`; the
  `EvidenceRouteContext` and `EvidenceRouteDependencies` exports are gone.
  Behaviour is unchanged: same status codes, same envelopes, same lazy
  runtime access at request time. `route.test.ts` keeps its cases through
  `vi.mock` of the runtime module (a 46-character token, the workspace, a
  prisma stub) and of the evidence-service module (`submit` resolving
  `created` then `duplicate`): 401 without the bearer header, 201 then 200,
  and 415 for `content-encoding: br` through the real `readEvidenceRequest`
  with an `x-correlation-id` header so the envelope assertion is exact. The
  route still imports neither `@kernel-zero/persistence` nor
  `@prisma/client`, so `transport-does-not-import-repositories` stays green.
- Self-policy: five rules `route-handlers-parse-their-input-{get,post,put,patch,delete}`
  with `files: ["layer:transport"]`, `symbols` the verb,
  `parserCalls: ["readEvidenceRequest"]`,
  `readerCalls: ["dependencies.resolveSubmission"]`,
  `allowedCalls: ["dependencies.service.submit", "errorResponse"]`.
- Benchmark policy gains one rule (`symbols: "handler*"`, which matches
  nothing in the corpus), so the numbers below cover export enumeration on
  5,000 files and nothing of the per-function pass.

## Invariants touched

1. Definite policy violations fail closed. Unparsed input reaching an
   unlisted call, a `return`, an outer binding, or a closure is
   `INGRESS_ESCAPE`; a handler that never parses is `INGRESS_PARSE_MISSING`;
   everything the pass cannot follow is `INGRESS_PROOF_FAILED`, never a pass.
   Proof: `ingress.test.ts` exact matrix and the bite below.
2. Every request path resolves an actor and validates its input at the
   boundary. The route body is unchanged; the exported `POST` is now provable
   and the self-policy proves it on every gate.
10. Local validation is deterministic and network-free. Two runs on the final
    tree produced identical `integrity.digest` (quoted below).
11. Public wire formats are versioned and digests are over document content.
    See Contract impact.
12. Kernel packages never import a profile. Unchanged:
    `git diff --stat -- packages/domain packages/contracts packages/persistence`
    is empty.

Invariants 4 to 9 are unaffected: no governed action, no persistence change,
no UI. Invariant 3 is withdrawn.

## Contract impact

Policy `kernel-zero.dev/v1`: additive. One new discriminated-union member;
every stored policy parses unchanged and keeps its digest.

Evidence `kernel-zero.dev/evidence/v1`: additive. The closed `messageCode`
enum grows from nineteen to twenty-two public codes with
`INGRESS_PARSE_MISSING` ("An ingress function never passes its input through
a required parser."), `INGRESS_ESCAPE` ("Unparsed ingress input reaches a
call, return, or binding outside the allowed set."), and
`INGRESS_PROOF_FAILED` ("Ingress input flow could not be proven within the
function."). All seven PRP section 6 codes are now delivered; existing codes,
strings, and fingerprints are untouched, so every stored run still
re-validates. Exception bundles: unchanged.

Generated contracts regenerated: `docs/contracts/repository-policy-v1.schema.json`,
`docs/contracts/repository-evidence-v1.schema.json`, one paragraph in
`docs/contracts/README.md`; `npm run contracts:check` exit 0. Golden fixture
`packages/validator/fixtures/golden/**`: byte-identical.

Self-policy digests (the document changed, so both moved):

| | before (restrict-state-transition ADR) | after |
| --- | --- | --- |
| `policy.digest` | `sha256:3fa084d236c6a05cdddc5723b581eaa58331a1696369d23ca9401d7a63089f11` | `sha256:ca3bc516780a354f54f006a4c1ad0d091220c51cc37190d3c2063dbcb18a4b31` |
| `integrity.digest` | `sha256:08c2bfa7735fcb4df6162a3feb74028b077e149a5f994f458b9afefaf3a0a0e1` | `sha256:b28247eb5fc05949c27daf27a042a17321218ba3eb0cf0160dd5a0ba9f39af37` |

The integrity digest also reflects the manifest gaining one source file
(`checks/ingress.ts`; 95 to 96 files) and the rewritten route.

### Schema-default digest note

`readerCalls` and `allowedCalls` default to `[]`. The policy digest is
`canonicalSha256` of the schema-parsed document, so a stored policy that
declares this kind and omits either would parse to a document carrying both
and its digest would move (CLAUDE.md rule 5). No stored policy can contain
this kind yet, because the kind did not exist before this change, so nothing
existing moves. The self-policy spells both fields explicitly.

## Trust model ceilings

- `// ponytail:` in `checks/ingress.ts`: the proof is intra-procedural only.
  Every parameter is untrusted and nothing crosses a call boundary;
  inter-procedural flow is the upgrade if a consumer needs it.
- `allowedCalls` results are trusted unconditionally. This is a deliberate
  laundering hole: `const raw = dependencies.service.submit(request)` would
  make `raw` trusted even though the service received the raw request. The
  self-policy lists only the one service call and the response builder, both
  of which the route calls with parsed or trusted values; a consumer that
  lists a broader allowed set accepts this ceiling knowingly.
- Only same-function bindings are tracked; a local object's property write
  widens the whole local, and a closure judged against the final set may be
  reported for a capture that was trusted when the closure was created (a
  false positive, never a false negative).

## Bite proof

Taken with `npm run validator:self` on the final route. In `route.ts`,
`const document = await readEvidenceRequest(request);` was replaced with
`const document = await request.json();`.

```text
kernel-zero: fail (1 errors, 0 warnings, 0 excepted, 96 files)
error route-handlers-parse-their-input-post apps/control/src/app/api/evidence/v1/runs/route.ts:15:28 INGRESS_ESCAPE symbol:POST:escape:request.json
  remediation: Pass the request only to the request-context reader and readEvidenceRequest; hand parsed values to one application service and build every response through errorResponse or Response.json.
bite exit=1
```

The finding is `INGRESS_ESCAPE` rather than `INGRESS_PARSE_MISSING` because
the raw request reaches `request.json` (an unlisted chain) first, and a
missing parser is reported only when nothing else was recorded. The route
was restored (`git checkout` returned the committed factory route, so the new
route was written back verbatim) and `npm run validator:self` returned
`kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 96 files)`, exit 0,
with the "after" integrity digest above.

## FR-IDs

FR-ING-001 (schema; `readerCalls`/`allowedCalls` as 0..100 lists with `[]`
defaults, see Decision), FR-ING-002 (export resolution; factory-bound
export is a proof failure; parameters, member access, `await`, and reader
results are untrusted), FR-ING-003 (`INGRESS_PARSE_MISSING` with
`symbol:<qualifiedName>:parser`), FR-ING-004 (`INGRESS_ESCAPE` with
`escape:<calleeOrTarget>` for calls, returns, and outer bindings; closures as
`escape:closure`), FR-ING-005 (loops, deep destructuring, and unresolvable
callees are `INGRESS_PROOF_FAILED`; reassignment widens monotonically),
FR-ING-006 (five self-policy rules; the route corrected behind
`evidenceDependencies()`, seam removal owner-confirmed).

## Verification command

Node 22 (`export PATH="/c/Users/Guerr/AppData/Roaming/fnm/node-versions/v22.22.3/installation:$PATH"`).

```text
npx vitest run packages/profile-software-architecture
  Test Files  6 passed (6)
       Tests  151 passed (151)

npm run test:validator
  Test Files  13 passed (13)
       Tests  98 passed (98)

npx vitest run apps/control/src/app/api/evidence/v1/runs/route.test.ts
  Test Files  1 passed (1)
       Tests  3 passed (3)

npm run validator:self   (run 1, final tree)
  kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 96 files)
  integrity.digest sha256:b28247eb5fc05949c27daf27a042a17321218ba3eb0cf0160dd5a0ba9f39af37
npm run validator:self   (run 2, final tree)
  kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 96 files)
  integrity.digest sha256:b28247eb5fc05949c27daf27a042a17321218ba3eb0cf0160dd5a0ba9f39af37

npm run benchmark:validator
  {"deterministic":true,"files":5000,"firstMs":20580,"limitMs":30000,"limitRssBytes":1073741824,"peakObservedRssBytes":437968896,"secondMs":20041}
  Under 30,000 ms and 1 GiB; see the corpus note under Decision.

npm run contracts:generate && npm run contracts:check   exit 0
git diff --stat -- packages/validator/fixtures/golden   (empty)
git diff --stat -- packages/domain packages/contracts packages/persistence   (empty)
git diff --stat -- apps/control   route.ts and route.test.ts only
npm run typecheck   exit 0
npm run lint        exit 0
```

`npm run verify` on this tree: exit 0.

```text
kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 96 files)
workflow: pass (0 errors, 0 warnings, 1 files)
unit         Test Files 50 passed (50)   Tests 379 passed (379)
architecture Test Files 1 passed (1)     Tests 1 passed (1)
integration  Test Files 3 passed (3)     Tests 7 passed (7)
```

`npm run test:browser` on this tree (builds the app, drives six pages with
keyboard and axe checks): `12 passed (40.2s)`, exit 0.
