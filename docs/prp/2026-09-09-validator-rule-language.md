# KERNEL ZERO validator rule language — Product Requirements Plan

Status: DRAFT for owner review, 2026-09-09. Supersedes the validator sections of
`clean-room/PRP.md` (sections 5, 8, 13, 14, 15 as they concern the validator).
Everything else in that document is historical after ADR
`docs/adr/2026-09-08-single-operator-kernel.md`.

## 1. Goal

Make the policy rule language expressive enough that the six architectural
sentences below are each one deterministic, fail-closed rule in
`kernel-zero.policy.json`, proven by the standalone validator with no network,
clock, or runtime instrumentation:

1. Only the repository layer may call the database client.
2. Every external payload is schema-validated before it reaches a service.
3. Every tenant query carries the tenant identifier.
4. A given state transition can happen only through one service.
5. A given function cannot be called from named architectural layers.
6. Code from any author, human or agent, must satisfy all of the above before merge.

Sentences 1 and 6 are already satisfied (`forbid-import-edge` and the
protected `verify` check on `main`). Sentence 5 has its check kind
(`restrict-call-site`) but, as the final checker found on 2026-09-09, the
self-policy carried no rule of that kind; this PRP therefore also adds one
(`runtime-opens-at-the-boundary`, allowing `getRuntime` only from
`layer:transport` and the page route context). This PRP delivers the rest by
adding one policy-level concept (named layers) and three check kinds, and by
making the repository's own policy use every one of them.

## 2. Product principles

1. Deterministic proof or fail closed. A rule either proves the property from
   the TypeScript program or emits a `*_PROOF_FAILED` finding; it never guesses.
2. Rules are data, never code. No regular expressions from policy documents, no
   plugins, no user-authored evaluators.
3. Evidence identity is stable. Existing finding fingerprints, existing policy
   digests, and the golden fixture bytes do not move.
4. The kernel dogfoods every kind. A kind that the self-policy does not use
   does not ship.
5. The console is out of scope. Effort goes to `packages/validator` and
   `packages/profile-software-architecture`.

## 3. Scope

### 3.1 In scope

- Named layers in the policy schema and their expansion before evaluation.
- Check kind `require-call-argument` (argument-shape proof for calls).
- Check kind `restrict-state-transition` (field writes and value transitions
  through calls, restricted to named writers).
- Check kind `require-ingress-parse` (every exported ingress function parses
  before its input escapes).
- A shared argument-shape prover in the validator, used by the two call kinds.
- Fixtures, engine tests, compatibility rules, message codes, generated
  contracts, `docs/contracts/README.md`, validator README, traceability rows.
- Self-policy rules exercising each addition, each proven to bite.
- Benchmark coverage for the new kinds.

### 3.2 Out of scope

- Any change under `apps/control` beyond edits the self-policy forces.
- Cross-function or cross-file data flow. Every proof is intra-procedural.
- JavaScript sources, decorators, or reflection.
- Runtime enforcement, ESLint integration, editor integration.
- Bumping the validator version. `tool.version` stays `0.1.0` in this PRP
  because it sits inside the evidence digest composition; a release commit
  bumps it separately.
- New profiles, console pages, custody, identity, billing, or anything the
  2026-09-08 ADR removed.

## 4. Existing seams this builds on

- `packages/profile-software-architecture/src/policy.ts`: `PolicyCheckSchema`
  discriminated union, `GlobList`, `ExactList`, `IdentifierSchema`,
  `RelativeTypeScriptFileSchema`, `TypeReferenceSchema`.
- `packages/profile-software-architecture/src/compatibility.ts`:
  `messageCodesByKind` and the per-kind subject grammar.
- `packages/validator/src/engine.ts`: dispatch and `ruleClaimsPath`;
  `checks/*.ts` evaluators typed as `CheckEvaluator<K>`; `findings.ts`
  `rawFinding`, `nodeLocation`, `forEachMatchingSource`, `matchesGlob`;
  `ast.ts` helpers (`walk`, `resolveCalleeName`, `propertyChainName`,
  `asObjectLiteral`, `objectLiteralKeys`, `isProofBlockingProperty`,
  `collectExportedFunctions`, `containsUnsafeType`).
- `static-registry.ts` is the model for a shared prover that never emits
  findings; the argument prover follows it.
- `runner.ts` `publicMessageCode` maps raw codes to public codes.
- Skills: `kz-grill` (one ADR per kind), `kz-policy-rule` branch B (the eight
  steps), `kz-checker` after each kind.

## 5. Functional requirements

### FR-LAY — named layers

- **FR-LAY-001** `RepositoryPolicySchema` gains optional `layers`: a strict
  object of 0..50 entries keyed by a slug (2..40 chars) with a `GlobList` value.
  Absent `layers` parses exactly as today.
- **FR-LAY-002** Every glob-list field of every check (`from`, `files`,
  `allowFrom`, `declarationFiles`) accepts `layer:<name>` entries alongside
  globs. A reference to an undeclared layer is a schema error (validator exit 2,
  "Policy input does not satisfy the public contract").
- **FR-LAY-003** Expansion happens in the profile, once, after parse and before
  the engine sees the policy: `resolvePolicyLayers(policy)` returns a policy
  whose glob lists contain only globs. The engine and every evaluator stay
  glob-only. The policy digest is computed over the parsed, unexpanded document,
  so a policy without `layers` keeps its digest byte for byte.
- **FR-LAY-004** Subject strings never contain layer names; fingerprints are
  unchanged by expansion. `findingCompatibilityReason` runs against the expanded
  policy.
- **FR-LAY-005** The self-policy declares layers `ui`, `transport`, `service`,
  `persistence`, `kernel`, `validator` and rewrites every existing rule to
  reference them where a glob list names a layer today. Its digest changes
  (the document changed); that is recorded in the ADR. (Amended during the
  autonomous run on 2026-09-09: `profiles` was dropped because no rule names
  profile files and section 2 item 4 forbids shipping unexercised policy.)

### FR-ARG — `require-call-argument`

- **FR-ARG-001** Schema:
  `{ kind: "require-call-argument", files: GlobList, callee: uniqueArray(CalleeGlob, 1, 100), argument: int 0..9 (default 0), requiredPath: DottedPath, allowFrom: OptionalGlobList (default []) }`.
  `CalleeGlob` is a glob over the resolved callee chain that
  `restrict-call-site` already computes (for example `*.findMany`,
  `prisma.*.updateMany`). `DottedPath` is 1..8 identifier segments joined by
  `.` (for example `where.workspaceId`).
- **FR-ARG-002** For every call in `files` (minus `allowFrom`) whose resolved
  callee matches, the argument at `argument` must prove `requiredPath`:
  the argument is an object literal, or an identifier bound by `const` in the
  same function or module to an object literal; each path segment is a
  non-computed, non-spread property; the leaf value is any expression other
  than the literal `undefined`.
- **FR-ARG-003** Codes and subjects, all under subject
  `call:<resolvedCallee>:argument:<index>:<requiredPath>`:
  - `CALL_ARGUMENT_MISSING` (public) when the literal is provable and the path
    is absent or `undefined`.
  - `CALL_ARGUMENT_PROOF_FAILED` (public) when the argument is not a provable
    literal, a spread or computed key sits on the path, or the callee resolves
    to a matching chain only through an unsafe (`any`/`unknown`) receiver.
  - Unresolvable callees on `error` rules reuse the `restrict-call-site`
    behaviour: raw `CALL_RESOLUTION_FAILED` when the expression root could be a
    matching callee, mapped to `CALL_ARGUMENT_PROOF_FAILED`.
- **FR-ARG-004** Self-policy rule `tenant-queries-carry-workspace`: every
  `*.findFirst`, `*.findMany`, `*.updateMany`, `*.deleteMany`, `*.count`
  call in layer `persistence` must carry `where.workspaceId`, with
  `allowFrom` naming `packages/persistence/src/audit.ts` (audit rows use
  `workspaceOpaqueId`) and nothing else. Proven to bite by deleting one
  `workspaceId` from a selector.

### FR-STA — `restrict-state-transition`

- **FR-STA-001** Schema:
  `{ kind: "restrict-state-transition", callee: uniqueArray(CalleeGlob, 1, 100), argument: int 0..9 (default 0), field: DottedPath, allowFrom: OptionalGlobList, transitions: uniqueArray({ from: Identifier | "*", to: Identifier }, 0, 100) (default []) }`.
  `field` is the path of the written value inside the argument (for example
  `data.state`); the predicate path is the same leaf under `where` (for
  example `where.state`).
- **FR-STA-002** Every matching call anywhere in scope whose argument writes
  `field` (provably, per FR-ARG-002) must sit in `allowFrom`; otherwise
  `STATE_TRANSITION_DENIED` with subject `transition:<fieldLeaf>:<callee>`.
- **FR-STA-003** When `transitions` is non-empty, each allowed writer's call
  must have a string-literal `to` value at `field` and a string-literal `from`
  value at the predicate path; the pair must be listed (or `from: "*"`).
  A listed pair passes; an unlisted pair is `STATE_TRANSITION_DENIED` with
  subject `transition:<fieldLeaf>:<from>-><to>`; a non-literal value or a
  missing predicate is `STATE_TRANSITION_PROOF_FAILED` with the callee subject.
- **FR-STA-004** Writes that do not touch `field` are ignored; writes through
  spreads or computed keys at any level of the argument are
  `STATE_TRANSITION_PROOF_FAILED`.
- **FR-STA-005** Self-policy rule `policy-revision-state-is-governed`:
  `*.policyRevision.updateMany` writing `data.state` is allowed only from
  `packages/persistence/src/policies.ts`, with transitions
  `draft->approved`, `approved->active`, `active->superseded`. Proven to bite by
  adding an `updateMany` state write in `evidence.ts` and, separately, by
  changing one transition literal to `draft->active`.

### FR-ING — `require-ingress-parse`

- **FR-ING-001** Schema:
  `{ kind: "require-ingress-parse", files: GlobList, symbols: NonemptyExactStringSchema (glob over exported function names), parserCalls: ExactList, readerCalls: ExactList (default []), allowedCalls: ExactList (default []) }`.
- **FR-ING-002** For every exported symbol matching `symbols` in `files`:
  only direct function declarations and arrow or function expressions bound by
  an exported `const` are provable; any other export shape (for example
  `export const X = createHandler(...)`) is a proof failure, never a silent
  skip. Every parameter of a provable function is untrusted. Within the function
  body, an untrusted value is the parameter, any property access on it, any
  `await` of it, and the result of any `readerCalls` call that receives it.
- **FR-ING-003** The body must contain at least one call to `parserCalls`
  whose argument is untrusted; otherwise `INGRESS_PARSE_MISSING` with subject
  `symbol:<qualifiedName>:parser`.
- **FR-ING-004** An untrusted value passed as an argument to any call that is
  not in `parserCalls`, `readerCalls`, or `allowedCalls`, or returned, or
  assigned to an exported or module-level binding, is `INGRESS_ESCAPE` with
  subject `symbol:<qualifiedName>:escape:<calleeOrTarget>`.
- **FR-ING-005** Loops, destructuring into more than one level, or a callee
  that cannot be resolved are `INGRESS_PROOF_FAILED` with subject
  `symbol:<qualifiedName>:proof`. Assigning an untrusted value to a local
  binding (declaration or reassignment) widens the untrusted set to that
  binding; membership is monotone, so a later trusted reassignment never
  downgrades it. (Amended 2026-09-09 during the autonomous run: the original
  text made any reassignment a proof failure, which would have flagged the
  route's own correlation-id handling and made the rule unusable on the one
  route the kernel has.)
- **FR-ING-006** Self-policy rules `route-handlers-parse-their-input-{get,post,put,patch,delete}`
  (five rules; the glob grammar has no alternation): files `layer:transport`,
  symbols the verb, `parserCalls` `readEvidenceRequest`, `readerCalls`
  `dependencies.resolveSubmission`, `allowedCalls` `dependencies.service.submit`
  and `errorResponse`. If the existing evidence route does not pass, the route
  is corrected, not the rule. (Amended 2026-09-09 during the autonomous run:
  `resolveRequestContext` moves behind a no-argument `evidenceDependencies()`
  accessor so the exported `POST` can be proven intra-procedurally; the reader
  and allowed chains are therefore the accessor's members. Correcting the route
  removes the `createEvidencePostHandler` dependency-injection seam, which is an
  owner checkpoint before the edit, see section 12 step 4.)

### FR-DOG — dogfooding, contracts, documentation

- **FR-DOG-001** `kernel-zero.policy.json` uses layers and all three kinds; the
  ADR records the new self-policy digest and each bite proof.
- **FR-DOG-002** `docs/contracts/repository-policy-v1.schema.json` and
  `repository-evidence-v1.schema.json` regenerate; `contracts:check` is clean;
  `docs/contracts/README.md` documents each kind, its codes, and its subject
  grammar in the same register as the existing kinds.
- **FR-DOG-003** `packages/validator/README.md` and `docs/validator-and-hooks.md`
  show one example of each kind, and `.claude/skills/kz-policy-rule/SKILL.md`
  lists the new kinds (amended 2026-09-09 during the autonomous run so the
  builder skill does not fall behind the schema).
- **FR-DOG-004** `scripts/generate-traceability.ts` gains FR-LAY, FR-ARG,
  FR-STA, FR-ING, FR-DOG groups; `docs/TRACEABILITY.md` regenerates.
- **FR-DOG-005** The benchmark policy gains one rule of each new kind so the
  30-second and 1 GiB limits are measured with them active.

## 6. Public contract impact

- Policy `kernel-zero.dev/v1`: additive. `layers` is optional with no default;
  three new discriminated-union members. Every stored policy parses unchanged
  and keeps its digest. The self-policy's own digest changes because its
  document changes.
- Evidence `kernel-zero.dev/evidence/v1`: additive. Seven new public message
  codes in the closed `messageCode` enum:
  `CALL_ARGUMENT_MISSING`, `CALL_ARGUMENT_PROOF_FAILED`,
  `STATE_TRANSITION_DENIED`, `STATE_TRANSITION_PROOF_FAILED`,
  `INGRESS_PARSE_MISSING`, `INGRESS_ESCAPE`, `INGRESS_PROOF_FAILED`, plus the
  message strings for each. Existing codes, strings, and fingerprints are
  untouched, so every stored run still re-validates.
- Exception bundles: unchanged.
- Golden fixture: `packages/validator/fixtures/golden/**` stays byte-identical.

## 7. Non-functional requirements

- **NFR-DET-001** Two runs over an unchanged tree produce identical
  `integrity.digest` for the self-policy and for every fixture.
- **NFR-PERF-001** `npm run benchmark:validator` with one rule of each new
  kind active stays under 30,000 ms per run and 1 GiB peak RSS on the 5,000
  file corpus; both numbers are quoted in the ADR.
- **NFR-SAFE-001** No new dependency. No network, clock, or environment reads
  in any evaluator (the existing `validator-stays-network-and-database-free`
  rule remains green).
- **NFR-TYPE-001** `strictTypeChecked` lint clean; no `any`; `unknown` only at
  parse boundaries and type guards.

## 8. Technology and pattern constraints

- Node 22, npm workspaces, TypeScript 5 compiler API, Zod 4, Vitest,
  fast-check where a property is natural (path expansion, glob matching).
- One evaluator file per kind under `packages/validator/src/checks/`, exported
  as `CheckEvaluator<K>`; a shared `checks/argument-shape.ts` prover that
  never emits findings, mirroring `static-registry.ts`.
- Findings only through `rawFinding`; raw codes mapped in
  `runner.ts` `publicMessageCode`.
- `// ponytail:` comments for any deliberate ceiling (for example
  "intra-procedural only; inter-procedural flow if a consumer needs it").
- Each kind goes through `kz-grill` (its own ADR under `docs/adr/`) and
  `kz-policy-rule` branch B, then `kz-checker`.
- Commit per kind, plain developer language, no attribution trailers, on a
  branch off `main`. `main` is protected and PR-only; the run ends with a
  pull request, never a merge.

## 9. Rejected and deferred

Rejected: regular expressions in policy, user evaluators, runtime hooks,
inter-procedural data flow "just for the evidence route", any console work.

Deferred: layer inheritance, a `layer-allowed-dependencies` matrix kind,
`require-call-argument` value constraints beyond presence, validator version
bump and npm publication (owner's release checkpoint).

## 10. Test matrix

| ID | Layer | Required proof |
| --- | --- | --- |
| TM-V01 | Schema | Each new kind and `layers` accepts a canonical example and rejects unknown fields, bad slugs, undeclared layer references, invalid dotted paths, and out-of-range indices. |
| TM-V02 | Profile | `resolvePolicyLayers` expands references, is idempotent, leaves a layer-free policy identical, and a fast-check property shows expansion order never changes the sorted glob set. |
| TM-V03 | Engine | Per kind: a passing fixture, a failing fixture, and a proof-failure fixture, with `engine.test.ts` asserting the exact finding list including `subject` and `location`. |
| TM-V04 | Compatibility | Every new code has a `rule_code_mismatch` and `rule_subject_mismatch` case. |
| TM-V05 | Golden | `golden.test.ts` byte-identical before and after. |
| TM-V06 | Self-policy | Each new rule proven to bite (exit 1, one finding with its rule ID) and restored (exit 0); digest identical across two runs. |
| TM-V07 | Benchmark | Numbers quoted under limits with the new rules active. |
| TM-V08 | Contracts | `contracts:generate` then `contracts:check` exit 0; README sections present. |
| TM-V09 | Gate | `npm run verify` exit 0 with unit, architecture, and integration counts quoted. |

## 11. Success criteria

- [ ] **SC-V01** Sentences 2, 3, and 4 in section 1 are each one rule in
      `kernel-zero.policy.json`, and sentence 5's existing rule uses a layer name.
- [ ] **SC-V02** Every FR-ID in section 5 has a row in `docs/TRACEABILITY.md`
      naming executable evidence.
- [ ] **SC-V03** `npm run verify` exit 0; unit, architecture, and integration
      counts quoted; self-policy pass with an identical digest on two runs.
- [ ] **SC-V04** Benchmark under limits with the new kinds active, numbers quoted.
- [ ] **SC-V05** Golden fixture unchanged; `git diff --stat -- packages/validator/fixtures/golden` empty.
- [ ] **SC-V06** `git diff --stat -- packages/domain packages/contracts packages/persistence apps/control` shows only edits the self-policy forced, each named in an ADR.
- [ ] **SC-V07** One ADR per kind under `docs/adr/`, each with the bite proof
      and digest.
- [ ] **SC-V08** Work lands as one pull request against `main` whose `verify`
      check is green; no merge, no version bump, no publication.

## 12. Implementation sequence and gates

1. Layers (FR-LAY). Gate: TM-V01, TM-V02, TM-V05, TM-V06 for the rewritten
   self-policy, `npm run verify`.
2. Argument prover plus `require-call-argument` (FR-ARG). Gate: TM-V01, TM-V03,
   TM-V04, TM-V06, TM-V07, TM-V08, `npm run verify`.
3. `restrict-state-transition` (FR-STA), reusing the prover. Same gate.
4. `require-ingress-parse` (FR-ING). Same gate. **Owner checkpoint before
   the route edit:** removing `createEvidencePostHandler` and its injection
   type deletes shipped functionality; the run pauses and asks the owner to
   confirm that removal before touching `route.ts`. If confirmation is
   absent the run stops at the end of step 3 with steps 1 to 3 delivered.
5. Dogfooding and documentation (FR-DOG). Gate: TM-V08, TM-V09, SC-V01..V07.
6. Pull request (SC-V08).

Each step is one commit on the branch, one ADR, one `kz-checker` verdict.

## 13. Publication boundary

Completion means a green pull request. Merge, validator version bump, npm
publication, and any change to branch protection are the owner's separate
decisions.
