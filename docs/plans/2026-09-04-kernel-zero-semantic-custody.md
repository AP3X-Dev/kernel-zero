# KERNEL ZERO semantic enforcement and policy custody implementation plan

Status: design complete; implementation blocked on the clean-room PRP addendum.

Source decision:
`docs/adr/2026-09-04-semantic-proof-and-policy-custody.md`.

## Phase 0 — authorize and freeze

### Slice 0.1: PRP addendum

- The human owner incorporates the ADR's new rule and custody requirements into
  `clean-room/PRP.md`, including `FR-CUS-001` through `FR-CUS-008` and `TM-19`.
- Reconcile existing `FR-VAL-005/006` wording with the frozen compatibility
  exception: legacy `PARSE_FAILURE` remains exit `2`; new semantic proof-failure
  findings use exit `1`.
- No builder starts until this addendum is approved. Product code may not treat
  the ADR alone as clean-room implementation input.

Gate: owner-approved PRP addendum whose requirements match the ADR exactly.

### Slice 0.2: compatibility baseline

Builder: `kz-policy-rule`, branch B preparation.

- Capture golden normalized raw findings, public findings, subjects, exact
  messages, fingerprints, policy digests, exception matching, evidence, and exit
  behavior for all seven existing check kinds.
- Give `require-governed-operation` extra fixtures for every current raw failure
  path and accepted static form.
- Record the current validator package version that is the last version without
  the new kinds.

Gate: old fixtures remain byte-identical; benchmark baseline captured; pinned
Node 22 `npm run verify` exits `0`; independent `kz-checker` passes.

## Phase 1 — semantic foundation

### Slice 1.1: shared closed-registry prover, no public change

Builder: `kz-policy-rule`, branch B.

- Extract only the static registry/entry/declaration analysis reusable by the
  governed-operation adapter.
- Preserve the governed action's fixed keys, call convention, raw codes, public
  code, subject grammar, and output order.
- Keep the refactor internal; do not regenerate public contracts in this slice.

Gate: governed golden suite is byte-identical, validator benchmark stays within
30 seconds and 1 GiB, full verify exits `0`, then `kz-checker` passes.

### Slice 1.2: `require-context-parameter`

Builder: `kz-policy-rule`, branch B.

Primary files:

- `packages/profile-software-architecture/src/policy.ts`
- `packages/profile-software-architecture/src/evidence.ts`
- `packages/profile-software-architecture/src/compatibility.ts`
- `packages/validator/src/engine.ts`
- their co-located tests and `packages/validator/fixtures/`
- `scripts/generate-contracts.ts` and generated `docs/contracts/`

Order:

1. Add strict policy/type-reference schemas and rejected examples.
2. Add frozen public messages and compatibility/subject validation.
3. Implement exported-symbol traversal and type-identity proof.
4. Add pass, known-invalid, configured-type-unresolved, candidate-type-unsafe,
   alias/derived/generic/intersection, union, and structural-lookalike fixtures.
5. Prove the legacy tenant rule is unchanged.
6. Regenerate contracts and update generated documentation.

Gate: exact finding/location assertions, deterministic rerun, contract checks,
benchmark, pinned full verify, then `kz-checker`.

### Slice 1.3: `require-closed-registry`

Builder: `kz-policy-rule`, branch B.

- Add the exact registry file/export and declaration-file/call schema.
- Implement arbitrary required metadata over the shared static prover while
  keeping a distinct generic adapter and public codes.
- Test direct and frozen objects, resolvable call aliases, literal-computed
  calls, registry-only entries, missing keys, invalid/duplicate IDs, duplicate
  declarations, unregistered calls, spreads, computed keys, and indirection.
- Re-run the governed-operation golden baseline after every engine change.

Gate: static-form matrix, generated contracts, governed compatibility, two-run
determinism, benchmark, pinned full verify, then `kz-checker`.

### Slice 1.4: `restrict-property-write`

Builder: `kz-policy-rule`, branch B.

- Resolve one exact exported type and property symbol per rule.
- Build one per-program write index so multiple rules do not traverse every file
  independently.
- Classify only the bounded write forms frozen in the ADR.
- Test unrelated same-named properties, import/type aliases, inheritance,
  intersections, possible unions, constrained generics, contextual object
  literals, constant/dynamic element access, unsafe receivers, allowed files,
  and every documented exclusion.
- Treat consumer path-alias/compiler-configuration failure as a proof failure;
  accepting arbitrary consumer `tsconfig` behavior is a later design.

Gate: semantic matrix and performance regression budget, generated contracts,
two-run determinism, benchmark, pinned full verify, then `kz-checker`.

## Phase 2 — agent-facing CLI

### Slice 2.1: deterministic output and `explain`

- Keep machine JSON evidence authoritative.
- Add concise stable terminal findings containing rule, path/location, code,
  subject, and policy remediation.
- Add `kernel-zero explain` over strictly parsed policy, repository evidence, or
  custody evidence. It never reads source or calls a network/model.
- Test malformed artifacts, unknown codes/kinds, stable ordering, and bounded
  output.

Gate: CLI unit/snapshot tests, installed-package smoke test, pinned full verify,
then `kz-checker`.

### Slice 2.2: safe `init`

- Add `kernel-zero init` as a local-only scaffold command.
- Refuse every overwrite by default and make the proposed target list visible.
- Scaffold a minimal policy, hook, and CI example; print the authoritative
  AGENTS/CLAUDE snippet instead of editing existing agent instructions.
- Pin the exact compatible validator version in generated adoption guidance.
- Do not modify branch protection, push, publish, or install from the network.

Gate: clean temporary-consumer tests for empty and conflicting targets,
package-content check, pinned full verify, then `kz-checker`.

## Phase 3 — pure custody and offline validation

### Slice 3.1: strict custody contracts and pure cryptography

- Add `PolicyApproval`, `WorkspaceTrustBundle`, and
  `PolicyCustodyEvidence` schemas under kernel contracts without profile imports.
- Put canonical payload/digest and Ed25519 sign/verify primitives in pure shared
  packages; private-key signing APIs must not leak into the validator surface.
- Generate schemas, canonical examples, malformed fixtures, and custody docs.
- Add property tests for canonicalization, strict JWK decoding, ID uniqueness and
  sort order, author/approver separation, integrity/signature tampering, exact
  workspace/policy/digest binding, key validity edges, and retroactive revocation.

Gate: `contracts:generate`, `contracts:check`, crypto/property suite, architecture
boundaries, pinned full verify, then `kz-checker`.

### Slice 3.2: custody-first validator flow

- Add the all-or-none custody CLI option group without changing legacy command
  behavior when absent.
- Parse all required artifacts before cryptographic use.
- On validly parsed custody failure, write only failing custody evidence and
  exit `1`; prove source discovery/program construction never runs and existing
  `--out` bytes remain untouched.
- On pass, write passing custody evidence before starting source validation.
- On malformed/unreadable input, exit `2` and write neither output.
- Keep custody findings non-exceptable and repository evidence unchanged.

Gate: complete exit/output-order matrix, deterministic custody evidence,
installed consumer test, `npm run validator:package:check`, benchmark, pinned full
verify, then `kz-checker`.

## Phase 4 — control-plane custody mechanism

### Slice 4.1: workspace authority persistence

Builder: persistence portion of `kz-governed-action`.

- Add distinct workspace-scoped `PolicyAuthorityKey` and immutable
  `PolicyApprovalArtifact` models, migration, repository operations, indexes,
  foreign keys, uniqueness, and state checks.
- Store only public key/timeline data and canonical signed artifacts. No private
  key or private-key reference column is allowed.
- Require `workspaceId` on every selector and make cross-workspace/missing rows
  indistinguishable.

Gate: Prisma validation, empty-database migration, tenant matrix,
immutability/idempotency/concurrency tests, pinned full verify, then
`kz-checker`.

### Slice 4.2: approve with custody

Builder: `kz-governed-action`.

- Add `policy.approve-with-custody` with all six metadata fields from the ADR;
  keep existing `policy.approve` behavior unchanged.
- Add a server-only injected local signer and a single application-service path.
- Make approval, signing, signature self-verification, artifact persistence, and
  audit one rollback-safe transaction.
- Ship only deterministic fixture/ephemeral signer composition. Production
  composition must fail explicitly as unavailable.
- If transport/UI is included by the PRP addendum, strictly parse, resolve actor
  and workspace, call one service, and never expose signing directly.
- Add self-policy rules for custody `server-only`, validator dependency
  direction, and every new custody boundary parser.

Gate: service/governed-action tests, author race, duplicate retry, wrong
workspace/key, signer/audit rollback, no-egress/dependency checks, self-policy
canary, pinned full verify, then `kz-checker`.

## Phase 5 — adoption and local qualification

### Slice 5.1: custody-aware adoption guidance

- Document the protected inputs: policy, workflow/validator version, and
  workspace trust bundle must be outside the governed maker's authority.
- Document CODEOWNERS/required-check setup as human operations; do not perform
  them.
- Document trust-bundle rotation/revocation and the approval-time semantics.
- Update traceability for changed FRs plus `FR-CUS-001..008` and `TM-19`.

Gate: docs/contracts/traceability checks and `kz-checker`.

### Slice 5.2: final local fixture qualification

- Run an end-to-end local fixture using only ephemeral keys: maker proposes,
  different checker approves, workspace authority signs, custody validates,
  repository validates, both evidence artifacts reproduce, tampering fails, and
  wrong-workspace proof fails.
- Re-run old v1 fixtures and prove their normalized evidence is unchanged.
- Run package check, validator benchmark, two-run determinism, architecture
  checks, and the approved clean-room contamination scan.
- Run the pinned Node 22 `npm run verify`; exit `0` is the only pass.
- Run a final independent `kz-checker` and record any external qualification not
  performed.

Stop after verified local evidence. Publication, push, PR, merge, deployment,
production keys/trust, branch protection, required checks, and live activation
remain separately human-approved.

## Slice ledger

| Slice | Public contract? | Builder | Independent gate |
| --- | --- | --- | --- |
| 0.1 PRP addendum | requirements | human owner | PRP/ADR match |
| 0.2 compatibility baseline | no | `kz-policy-rule` prep | `kz-checker` |
| 1.1 shared prover | no | `kz-policy-rule` B | `kz-checker` |
| 1.2 context parameter | additive v1 | `kz-policy-rule` B | `kz-checker` |
| 1.3 closed registry | additive v1 | `kz-policy-rule` B | `kz-checker` |
| 1.4 property writes | additive v1 | `kz-policy-rule` B | `kz-checker` |
| 2.1 explain/output | CLI additive | CLI builder | `kz-checker` |
| 2.2 init | CLI additive | adoption/CLI builder | `kz-checker` |
| 3.1 custody contracts | new custody/v1 | contracts builder | `kz-checker` |
| 3.2 offline custody | CLI additive | validator builder | `kz-checker` |
| 4.1 custody persistence | internal schema | `kz-governed-action` | `kz-checker` |
| 4.2 custody action | internal/action | `kz-governed-action` | `kz-checker` |
| 5.1 adoption | docs | `kz-adopt` guidance | `kz-checker` |
| 5.2 qualification | no | maker/checker | final `kz-checker` |

## Execution order and stop conditions

The slices are intentionally sequential at contract boundaries. Do not start a
later public slice while an earlier slice's compatibility or checker gate is
red. Stop and amend the ADR/PRP if implementation requires a different public
code, message, subject, accepted syntax, trust rule, or exit behavior.

Do not weaken policy, delete a fixture, broaden an exclusion, or reinterpret a
failure to obtain green verification. Escalate the architectural conflict to the
project lead or, when explicitly delegated, to the autonomous advisor.

