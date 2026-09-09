# Implementation plan — validator rule language

Spec: `docs/plans/2026-09-09-validator-rule-language-spec.md` (revision 4). PRP: `docs/prp/2026-09-09-validator-rule-language.md`. Branch `feat/validator-rule-language`. Node 22 for every command (`export PATH="/c/Users/Guerr/AppData/Roaming/fnm/node-versions/v22.22.3/installation:$PATH"`).

Every task lists its files and the command whose exit 0 is its acceptance. Tasks inside one step may run in parallel where they touch disjoint files; steps run in order. Each step ends with `npm run verify`, a `kz-checker` verdict, and one commit in plain developer language.

Baseline on the branch before task 1, measured 2026-09-09 with `npm run verify` on `feat/validator-rule-language` (Node 22): exit 0; unit `45 passed (45)` files, `264 passed (264)` tests; architecture `1 passed`; integration `3 passed (3)` files, `7 passed (7)` tests; self-policy `kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 91 files)`; self-policy `integrity.digest` `sha256:435c3f708ebb44571c674ad6ab6f3f8abc1a32bd10d8d27846b3f399e9ed3bb8`; `policy.digest` `sha256:006a0a332433797dac544fd3b42c6f11d87f8c28e625611aed17c2d39419dec2`; golden `filesScanned` 12.

## Step 1 — named layers (FR-LAY, ADR `docs/adr/2026-09-09-policy-layers.md`)

| # | Task | Files | Acceptance |
| --- | --- | --- | --- |
| 1.1 | Schema: `LayerNameSchema`, `RuleGlobList`/`OptionalRuleGlobList`, `layers`, the three-message `superRefine` (spec §1) | `packages/profile-software-architecture/src/policy.ts`, `policy.test.ts` | `npx vitest run packages/profile-software-architecture/src/policy.test.ts` with new cases: layers accepted, malformed reference message, scope reference message, undeclared message, 51 layers rejected |
| 1.2 | `resolvePolicyLayers`, `isLayerReference`, barrel export | `packages/profile-software-architecture/src/layers.ts` (new), `layers.test.ts` (new, incl. fast-check order property), `src/index.ts` | `npx vitest run packages/profile-software-architecture/src/layers.test.ts` |
| 1.3 | Expand in `findingCompatibilityReason`; engine guard; runner expansion after digest | `compatibility.ts`, `compatibility.test.ts`, `packages/validator/src/engine.ts`, `engine.test.ts` (guard case), `packages/validator/src/runner.ts`, `runner.test.ts` (layered policy resolves) | `npm run test:validator` and `npx vitest run packages/profile-software-architecture` |
| 1.4 | Self-policy rewrite to layers (spec §1 table) | `kernel-zero.policy.json` | `npm run validator:self` twice, identical digest; the ADR records the old integrity digest (the baseline value quoted at the top of this plan, measured fresh) and the new one |
| 1.5 | Contracts and docs for layers | `scripts/generate-contracts.ts` (README paragraph), regenerated `docs/contracts/**`, `packages/validator/README.md`, `docs/validator-and-hooks.md` | `npm run contracts:generate && npm run contracts:check` |
| 1.6 | Golden pin | `packages/validator/src/golden.test.ts` (assert `filesScanned === 12` and the pinned `manifestDigest`) | `npx vitest run packages/validator/src/golden.test.ts` |
| gate | | | `npm run verify` exit 0; `git diff --stat -- packages/validator/fixtures/golden` empty; kz-checker PASS; commit |

## Step 2 — argument prover and `require-call-argument` (FR-ARG, ADR `docs/adr/2026-09-09-require-call-argument.md`)

| # | Task | Files | Acceptance |
| --- | --- | --- | --- |
| 2.1 | Prover: `proveObjectPath`, `resolveCallChain` (raw-receiver unsafety), `chainMatches`, `couldMatchCallee` (spec §2) | `packages/validator/src/checks/argument-shape.ts` (new), `argument-shape.test.ts` (new: every `PathProof` branch, harmless vs opaque spreads, nested-branch literal, unsafe and optional receivers, both-ends heuristic) | `npx vitest run packages/validator/src/checks/argument-shape.test.ts` |
| 2.2 | Schema member, `CalleeGlobSchema`, `DottedPathSchema`; message codes and strings; compatibility grammar | `policy.ts`, `policy.test.ts`, `evidence.ts`, `evidence.test.ts`, `compatibility.ts`, `compatibility.test.ts` (profile package) | `npx vitest run packages/profile-software-architecture` |
| 2.3 | Evaluator, raw codes, engine dispatch and `ruleClaimsPath`, public mapping | `checks/call-argument.ts` (new), `findings.ts`, `engine.ts`, `runner.ts` | `npx tsc --noEmit -p tsconfig.json` |
| 2.4 | Fixtures and the finding matrix (spec §3 list, 12 cases) | `packages/validator/fixtures/kinds/call-argument/queries.ts` (new), `checks/call-argument.test.ts` (new) | `npx vitest run packages/validator/src/checks/call-argument.test.ts` |
| 2.5 | Self-policy rule `tenant-queries-carry-workspace`; bite proof (delete one `workspaceId` in `exceptions.ts`, exit 1, restore). ADR `docs/adr/2026-09-09-require-call-argument.md` must contain, as named sections: the bite proof output; the schema-default digest note (spec §3: `argument`/`allowFrom` defaults move the digest of a policy that omits them, no stored policy affected, CLAUDE.md rule 5); the `findUnique` exclusion rationale (spec §7: compound-unique selectors carry the tenant key inside the unique-key object and are scoped by the composite index) | `kernel-zero.policy.json`, `docs/adr/2026-09-09-require-call-argument.md` | `npm run validator:self` exit 0 twice; bite exit 1 recorded in the ADR; `grep -c` is not acceptance, the kz-checker reads the ADR sections at the step gate |
| 2.6 | Benchmark rule, contracts, README paragraph, docs examples | `scripts/benchmark-validator.ts`, `scripts/generate-contracts.ts`, `docs/contracts/**`, `packages/validator/README.md`, `docs/validator-and-hooks.md` | `npm run benchmark:validator` exit 0 with numbers quoted; `npm run contracts:check` |
| gate | | | `npm run verify`; golden diff empty; kz-checker PASS; commit |

## Step 3 — `restrict-state-transition` (FR-STA, ADR `docs/adr/2026-09-09-restrict-state-transition.md`)

| # | Task | Files | Acceptance |
| --- | --- | --- | --- |
| 3.1 | Schema member with `transitions`; codes, strings, compatibility (two subject forms) | profile `policy.ts`, `policy.test.ts`, `evidence.ts`, `compatibility.ts`, `compatibility.test.ts` | `npx vitest run packages/profile-software-architecture` |
| 3.2 | Evaluator (spec §4 steps 1–6), raw codes, engine wiring (`ruleClaimsPath` true), public mapping | `checks/state-transition.ts` (new), `findings.ts`, `engine.ts`, `runner.ts` | `npx tsc --noEmit -p tsconfig.json` |
| 3.3 | Fixtures and matrix (spec §4: allowed writer 6 cases, rogue writer 1 case) | `fixtures/kinds/state-transition/allowed/writer.ts`, `elsewhere/rogue.ts`, `checks/state-transition.test.ts` | `npx vitest run packages/validator/src/checks/state-transition.test.ts` |
| 3.4 | Self-policy rule `policy-revision-state-is-governed`; two bite proofs (rogue write in `evidence.ts`; `draft->active` literal in `policies.ts`), both restored | `kernel-zero.policy.json` | `npm run validator:self` exit 0 twice; both bites exit 1 in the ADR |
| 3.5 | Benchmark rule, contracts, docs | as in 2.6 | `npm run benchmark:validator`; `npm run contracts:check` |
| gate | | | `npm run verify`; golden diff empty; kz-checker PASS; commit |

## Step 4 — `require-ingress-parse` (FR-ING, ADR `docs/adr/2026-09-09-require-ingress-parse.md`)

| # | Task | Files | Acceptance |
| --- | --- | --- | --- |
| 4.1 | Schema member; codes, strings, compatibility (three subject forms, `return`/`closure` literals) | profile `policy.ts`, `policy.test.ts`, `evidence.ts`, `compatibility.ts`, `compatibility.test.ts` | `npx vitest run packages/profile-software-architecture` |
| 4.2 | Evaluator (spec §5: export resolution incl. factory-bound const as proof failure, untrusted set, carrying, sinks, closures, loops), raw codes, engine wiring, public mapping. Defensive default: an untrusted value reaching any sink shape not enumerated in spec §5 (`new`, tagged template, `throw`, property assignment on an outer object, `yield`) is `INGRESS_UNRESOLVED`. The ADR records that `allowedCalls` results are trusted unconditionally (laundering hole, intentional) beside the intra-procedural `// ponytail:` ceiling | `checks/ingress.ts` (new), `findings.ts`, `engine.ts`, `runner.ts` | `npx tsc --noEmit -p tsconfig.json` |
| 4.3 | Fixtures and matrix (spec §5: POST pass, GET return, PUT log, PATCH loop, DELETE missing, HEAD factory, ignored non-export) | `fixtures/kinds/ingress/handlers.ts`, `checks/ingress.test.ts` | `npx vitest run packages/validator/src/checks/ingress.test.ts` |
| 4.4 | **Owner checkpoint first** (guardrail: removes the `createEvidencePostHandler` injection seam; the run pauses with AUTONOMOUS MODE PAUSED and proceeds only on confirmation). Then the forced route edit (spec §7 sketch): exported `POST`, `evidenceDependencies()` accessor, delete `createEvidencePostHandler`; tests via `vi.mock` for 401, 201, 200, 415 (the 415 case sends `x-correlation-id` so the exact envelope assertion holds) | `apps/control/src/app/api/evidence/v1/runs/route.ts`, `route.test.ts` | `npx vitest run apps/control/src/app/api/evidence/v1/runs/route.test.ts`; `npm run validator:self` still passes `transport-does-not-import-repositories` |
| 4.5 | Five self-policy rules `route-handlers-parse-their-input-{get,post,put,patch,delete}`; bite proof (replace `readEvidenceRequest` with `request.json()` in the route, exit 1, restore) | `kernel-zero.policy.json` | `npm run validator:self` exit 0 twice; bite exit 1 in the ADR |
| 4.6 | Benchmark rule, contracts, docs | as in 2.6 | `npm run benchmark:validator`; `npm run contracts:check` |
| gate | | | `npm run verify`; browser suite unaffected (route unchanged in behaviour; `npm run test:browser` run once here); kz-checker PASS; commit |

## Step 5 — dogfood closure and documentation (FR-DOG)

| # | Task | Files | Acceptance |
| --- | --- | --- | --- |
| 5.1 | Traceability groups FR-LAY, FR-ARG, FR-STA, FR-ING, FR-DOG; regenerate | `scripts/generate-traceability.ts`, `docs/TRACEABILITY.md` | `npm run traceability:generate` |
| 5.2 | Skill doc: `kz-policy-rule` existing-kinds list gains the three kinds and a `layers` note (added to spec §8 and PRP FR-DOG-003 as a deliverable; no `CLAUDE.md` edit) | `.claude/skills/kz-policy-rule/SKILL.md` | step gate: `npm run verify` and kz-checker review of the diff against spec §8 |
| 5.3 | Final determinism and benchmark quotes into the run-state | `docs/plans/2026-09-09-validator-rule-language-run-state.md` | `npm run validator:self` twice identical; `npm run benchmark:validator` |
| gate | | | `npm run verify` exit 0 with counts quoted; `git diff --stat -- packages/validator/fixtures/golden` empty; `git diff --stat -- packages/domain packages/contracts packages/persistence` empty; `git diff --stat -- apps/control` shows only `route.ts` and `route.test.ts`; kz-checker PASS; commit |

## Step 6 — pull request (SC-V08)

`git push -u origin feat/validator-rule-language`, then `gh pr create` against `main` with a body listing the four ADRs, the digest changes, the benchmark numbers, and the two owner checkpoints (route DI seam removal, validator version bump deferred). Record the PR URL in the run-state. No merge.

## Task execution rules

- Maker and checker differ: each step's implementation is done by a dispatched implementer agent (or inline) and verified by `kz-checker`; the orchestrator never marks a step green from its own summary.
- Any red gate goes into the run-state Failed Attempts table with a do-not-retry note before a different approach is tried.
- No new dependency; no edits outside the files named here except those the self-policy forces, which are then named in the step's ADR.
