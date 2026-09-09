# `restrict-state-transition`

## Context

PRP `docs/prp/2026-09-09-validator-rule-language.md` FR-STA: a policy
revision's `state` column moves only `draft -> approved -> active -> superseded`,
and only `packages/persistence/src/policies.ts` writes it. Nothing proved
that. `tenant-queries-carry-workspace` (step 2) proves every `updateMany`
carries `where.workspaceId`, but a second file could write
`data: { state: "approved" }` and `policies.ts` could freeze a draft straight
to `active`, and every gate stayed green.

The step-2 prover (`packages/validator/src/checks/argument-shape.ts`) already
proves a dotted path inside a call argument and returns the string literal at
the leaf, resolves callee chains with receiver safety, and carries the
both-ends unresolved heuristic. This kind is a second adapter over that
prover; the prover itself is unchanged.

This is `kz-policy-rule` branch B (new check kind) plus one branch-A rule in
the self-policy. Spec: `docs/plans/2026-09-09-validator-rule-language-spec.md`
sections 4, 6, 7, 8.

## Decision

- Schema (`packages/profile-software-architecture/src/policy.ts`): member
  `restrict-state-transition` with `callee: uniqueArray(CalleeGlobSchema, 1, 100)`,
  `argument: int 0..9 default 0`, `field: DottedPathSchema`,
  `allowFrom: OptionalRuleGlobList default []`, and
  `transitions: uniqueArray({ from: Identifier | "*", to: Identifier }, 0, 100) default []`.
  `IdentifierSchema` is now exported beside `CalleeGlobSchema` so
  compatibility parses the pair subject with the same grammar. The predicate
  path is `field` with its first segment replaced by `where`
  (`data.state` -> `where.state`).
- Evaluator (`packages/validator/src/checks/state-transition.ts`, new): every
  call in every file in scope, skipping `failedPaths`; `ruleClaimsPath` is
  `true` for every file, like `restrict-call-site`. Per call, in spec order:
  unresolved chain at `error` level with a `couldMatchCallee` glob -> raw
  `STATE_TRANSITION_UNPROVABLE` with the glob as subject; chain not matching
  -> skip; unsafe receiver -> `UNPROVABLE`; `proveObjectPath(arg, field)`
  `missing` -> not a write, skip; `unprovable` -> `UNPROVABLE`; file not in
  `allowFrom` -> `STATE_TRANSITION_DENIED_WRITER`; `transitions` empty ->
  done; written value not a string literal, or predicate absent or not a
  string literal -> `UNPROVABLE`; pair not listed (with `from: "*"` matching
  any source) -> `STATE_TRANSITION_DENIED_PAIR` with subject
  `transition:<leaf>:<from>-><to>`. Every other subject is
  `transition:<leaf>:<chain>`; location is the call expression.
- `findings.ts` gains the three raw codes; `engine.ts` dispatches the kind;
  `runner.ts` maps `DENIED_WRITER | DENIED_PAIR -> STATE_TRANSITION_DENIED`
  and `UNPROVABLE -> STATE_TRANSITION_PROOF_FAILED`.
- Compatibility: `messageCodesByKind["restrict-state-transition"]` is
  `["STATE_TRANSITION_DENIED", "STATE_TRANSITION_PROOF_FAILED"]`. Both codes
  accept `transition:<leaf>:` + a chain that parses as a callee glob and
  matches `callee`; `STATE_TRANSITION_DENIED` alone also accepts
  `transition:<leaf>:<from>-><to>` where `from` is an identifier or `*` and
  `to` an identifier. The forms cannot collide because a chain segment never
  contains `-`. The pair is checked against the grammar, not the transition
  list, because the finding reports a pair that is by definition unlisted.
- Fixtures `packages/validator/fixtures/kinds/state-transition/allowed/writer.ts`
  (the six spec cases plus one unresolved `db[key].updateMany` call, added so
  the warning-level and glob-subject branches are pinned in the same matrix)
  and `elsewhere/rogue.ts` (one denied writer); `checks/state-transition.test.ts`
  pins the exact finding list with subject and location in engine order,
  the writer-only mode (`transitions: []`), the `*` source, empty
  `allowFrom`, the warning level, and a chain outside `callee`.
- Self-policy rule `policy-revision-state-is-governed`:
  `callee: ["*.policyRevision.updateMany"]`, `argument: 0`,
  `field: "data.state"`, `allowFrom: ["packages/persistence/src/policies.ts"]`,
  transitions `draft->approved`, `approved->active`, `active->superseded`.
  No persistence file needed an edit: the three writes in `policies.ts`
  carry literal `where.state` predicates and literal `data.state` values, the
  draft-save write carries only `canonicalJson` and is ignored, and no other
  file calls `policyRevision.updateMany`.
- Benchmark policy gains one `restrict-state-transition` rule
  (`callee: ["*.updateMany"]`, `field: "data.state"`, `allowFrom: ["src/**"]`,
  one transition). The corpus has no call expressions, so the rule walks
  every node and proves nothing; the numbers below are therefore a floor for
  this evaluator, not a bound. A corpus of real `updateMany` calls would add
  the per-call `proveObjectPath` and `resolveCallChain` cost on top.

Deliberate simplifications (`// ponytail:` ceilings inherited from the
prover): a conditional in the written value's position is unprovable, and
only same-file `const` bindings are followed. A literal `from` value that is
not an identifier (for example `"in progress"`) produces a pair subject the
compatibility grammar rejects; the self-policy's states are all identifiers,
and widening the grammar is the upgrade if a consumer needs it.

## Invariants touched

1. Definite policy violations fail closed. A provable write outside
   `allowFrom` or through an unlisted pair is `STATE_TRANSITION_DENIED`;
   anything the prover cannot see through (opaque spread, computed key,
   non-literal value or predicate, absent predicate, `any` receiver,
   unresolvable callee that could match) is `STATE_TRANSITION_PROOF_FAILED`,
   never a pass. Proof: `state-transition.test.ts` (exact matrix), both bite
   proofs below.
10. Local validation is deterministic and network-free. The evaluator is a
    pure function of the program; `npm run validator:self` twice on the final
    tree produced the same `integrity.digest` (quoted below).
11. Public wire formats are versioned and digests are over document content.
    See Contract impact and the schema-default note.
12. Kernel packages never import a profile. Unchanged:
    `git diff --stat -- packages/domain packages/contracts packages/persistence`
    is empty after both bite restores.

Invariants 2, 4, 5, 6, 7, 8, 9 are unaffected: no control-plane change, no
governed action, no new ingress, no UI. Invariant 3 is withdrawn.

## Contract impact

Policy `kernel-zero.dev/v1`: additive. One new discriminated-union member;
every stored policy parses unchanged and keeps its digest. Existing rule
fields, subjects, and fingerprints are untouched.

Evidence `kernel-zero.dev/evidence/v1`: additive. The closed `messageCode`
enum grows from seventeen to nineteen public codes with
`STATE_TRANSITION_DENIED` ("A governed state field is written outside its
allowed writer or through an unlisted transition.") and
`STATE_TRANSITION_PROOF_FAILED` ("A write to a governed state field could not
be proven against the allowed transitions."). Four of the PRP section 6 seven
codes are now delivered; existing codes, strings, and fingerprints are
untouched, so every stored run still re-validates. Exception bundles:
unchanged.

Generated contracts regenerated: `docs/contracts/repository-policy-v1.schema.json`,
`docs/contracts/repository-evidence-v1.schema.json`, and one paragraph in
`docs/contracts/README.md`; `npm run contracts:check` exit 0.

Golden fixture `packages/validator/fixtures/golden/**`: byte-identical
(`git diff --stat -- packages/validator/fixtures/golden` empty).

Self-policy digests (the document changed, so both moved):

| | before (require-call-argument ADR) | after |
| --- | --- | --- |
| `policy.digest` | `sha256:2453c919f39582e2c9bd8c4a0cabd62853b1f7473cf67bd691f2004c46bda5a1` | `sha256:3fa084d236c6a05cdddc5723b581eaa58331a1696369d23ca9401d7a63089f11` |
| `integrity.digest` | `sha256:4cb0114b6adc3abe40f17b19fbcc87f455edd60ca41d984a373fdd49675e2177` | `sha256:08c2bfa7735fcb4df6162a3feb74028b077e149a5f994f458b9afefaf3a0a0e1` |

The integrity digest also reflects the manifest gaining one source file
(`checks/state-transition.ts`; 94 to 95 files).

Working-tree note: before the bite proofs, the two determinism runs on this
change gave `sha256:65284e1146a550905eefd46e5783d0ba80a9cfd7ae1e3d90cdc20232a317a271`.
`git checkout --` then rewrote `evidence.ts` and `policies.ts` with LF per
`.gitattributes` while this checkout held CRLF copies (`core.autocrlf=true`),
which moved the manifest digest with zero content change (`git diff` empty in
both states), exactly as the step-2 ADR recorded for `exceptions.ts`. The
files are left at LF, the git-clean state; the "after" value above and the
two determinism runs quoted below were taken on that final tree, after every
edit in this step.

## Schema-default digest note

`argument` defaults to `0`, `allowFrom` to `[]`, and `transitions` to `[]`.
The policy digest is `canonicalSha256` of the schema-parsed document, so a
stored policy that declares this kind and omits any of the three would parse
to a document carrying all of them and its digest would move (CLAUDE.md rule
5). No stored policy can contain this kind yet, because the kind did not
exist before this change, so nothing existing moves. The self-policy spells
all three fields explicitly.

## Bite proofs

Both taken with `npm run validator:self`, each restored with
`git checkout -- <file>` before the next step.

1. Rogue writer. Inserted
   `await tx.policyRevision.updateMany({ data: { state: "approved" }, where: { state: "draft", workspaceId: input.workspaceId } });`
   as the first statement of `storeInTransaction` in
   `packages/persistence/src/evidence.ts` (the `where` carries `workspaceId`,
   so `tenant-queries-carry-workspace` stays silent and only this rule fires).

   ```text
   kernel-zero: fail (1 errors, 0 warnings, 0 excepted, 95 files)
   error policy-revision-state-is-governed packages/persistence/src/evidence.ts:314:9 STATE_TRANSITION_DENIED transition:state:tx.policyRevision.updateMany
     remediation: Change a policy revision's state only from policies.ts, with a literal where.state predicate, through draft->approved, approved->active, or active->superseded.
   bite 1 exit=1
   restored evidence.ts
   ```

2. Unlisted pair. In `packages/persistence/src/policies.ts` changed the
   freeze write's `state: "approved"` to `state: "active"` (predicate still
   `where.state: "draft"`).

   ```text
   kernel-zero: fail (1 errors, 0 warnings, 0 excepted, 95 files)
   error policy-revision-state-is-governed packages/persistence/src/policies.ts:87:25 STATE_TRANSITION_DENIED transition:state:draft->active
     remediation: Change a policy revision's state only from policies.ts, with a literal where.state predicate, through draft->approved, approved->active, or active->superseded.
   bite 2 exit=1
   restored policies.ts
   ```

After both restores: `kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 95 files)`,
exit 0; `git diff --stat -- packages/domain packages/contracts packages/persistence`
empty.

## FR-IDs

FR-STA-001 (schema with `CalleeGlob`, `DottedPath`, identifier-or-`*`
transitions, defaults `0`, `[]`, `[]`; predicate path under `where`),
FR-STA-002 (every matching call anywhere in scope; writer outside `allowFrom`
is `STATE_TRANSITION_DENIED` with the callee subject), FR-STA-003 (literal
`to` and literal predicate `from`, listed pair or `*`; unlisted pair is
`STATE_TRANSITION_DENIED` with the pair subject; non-literal or missing
predicate is `STATE_TRANSITION_PROOF_FAILED` with the callee subject),
FR-STA-004 (writes not touching `field` ignored; spreads and computed keys
are proof failures), FR-STA-005 (self-policy rule, both bites).

## Verification command

Node 22 (`export PATH="/c/Users/Guerr/AppData/Roaming/fnm/node-versions/v22.22.3/installation:$PATH"`).

```text
npx vitest run packages/profile-software-architecture
  Test Files  6 passed (6)
       Tests  129 passed (129)

npm run test:validator
  Test Files  12 passed (12)
       Tests  93 passed (93)

npm run validator:self   (run 1, final tree)
  kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 95 files)
  integrity.digest sha256:08c2bfa7735fcb4df6162a3feb74028b077e149a5f994f458b9afefaf3a0a0e1
npm run validator:self   (run 2, final tree)
  kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 95 files)
  integrity.digest sha256:08c2bfa7735fcb4df6162a3feb74028b077e149a5f994f458b9afefaf3a0a0e1

npm run benchmark:validator   (three samples; the first ran beside typecheck and lint)
  {"deterministic":true,"files":5000,"firstMs":18478,"limitMs":30000,"limitRssBytes":1073741824,"peakObservedRssBytes":514420736,"secondMs":12841}
  {"deterministic":true,"files":5000,"firstMs":19611,"limitMs":30000,"limitRssBytes":1073741824,"peakObservedRssBytes":510558208,"secondMs":7241}
  {"deterministic":true,"files":5000,"firstMs":12980,"limitMs":30000,"limitRssBytes":1073741824,"peakObservedRssBytes":513036288,"secondMs":9438}
  All under 30,000 ms and 1 GiB; see the floor-not-bound note under Decision.

npm run contracts:generate && npm run contracts:check   exit 0
git diff --stat -- packages/validator/fixtures/golden   (empty)
git diff --stat -- packages/domain packages/contracts packages/persistence   (empty)
npm run typecheck   exit 0
npm run lint        exit 0
```

`npm run verify` on this tree: exit 0.

```text
kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 95 files)
workflow: pass (0 errors, 0 warnings, 1 files)
unit         Test Files 49 passed (49)   Tests 352 passed (352)
architecture Test Files 1 passed (1)     Tests 1 passed (1)
integration  Test Files 3 passed (3)     Tests 7 passed (7)
```
