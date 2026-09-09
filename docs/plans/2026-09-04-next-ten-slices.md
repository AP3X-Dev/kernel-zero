# Next ten slices

Working ledger for the slices chosen on 2026-09-04 from the quality review.
Source plan: `docs/plans/2026-09-04-kernel-zero-semantic-custody.md`.
Source decision: `docs/adr/2026-09-04-semantic-proof-and-policy-custody.md`.

Baseline at start (`npm run verify` exit 0; NOTE: runs before the Node 22 requalification below were on Node 20 by mistake): 288 unit tests in 57
files, 1 architecture test, 7 integration tests in 3 files, self-policy pass
over 8 rules, workflow policy pass.

Rules for this ledger: update the row at every commit, verdict, or pause. Record
failed attempts with a do-not-retry note. Never redo a slice marked done.

| # | Slice | Plan ref | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1 | PRP addendum and repo hygiene | 0.1 | done (owner approved 2026-09-04) | `next-env.d.ts` untracked and gitignored (typecheck passes without it); addendum draft at `clean-room/PRP-ADDENDUM-custody.md` awaiting owner approval and merge into `PRP.md`; ADR and plans staged for commit on request |
| 2 | Compatibility golden baseline | 0.2 | done (Node 22 verify exit 0, 290 unit tests in 58 files; kz-checker PASS) | `packages/validator/src/golden.test.ts` over `fixtures/golden/policy.json` (nine rules, all seven kinds, warning and error paths, parse-claimed file); `raw-findings.json` and `evidence.json` byte-identical across two regenerations; bite proof: renaming one frozen subject in the engine fails the test; exception matching asserted by derived grant; `npm run test:validator` 47 passed; last pre-semantic validator version is 0.1.0 (recorded in `evidence.json` `tool.version`) |
| 3 | Engine split and shared prover | 1.1 | done (Node 22 verify exit 0, 290 unit tests in 58 files, self-policy digest identical twice, package check pass, kz-checker PASS) | engine split into `program.ts`, `findings.ts`, `ast.ts`, `static-registry.ts` (shared closed-registry prover), and `checks/{imports,calls,exports,tenant,boundary,governed}.ts`; `engine.ts` keeps dispatch and re-exports so the barrel is unchanged; governed check is now an adapter over the prover; golden byte-identical; 47 validator tests pass; benchmark 6732 ms and 6683 ms, peak RSS 427,712,512 bytes, deterministic |
| 4 | `require-context-parameter` | 1.2 | done (Node 22 verify exit 0, 305 unit tests in 59 files, self-policy digest identical twice, kernel diff empty, kz-checker PASS) | schema with `expectedType` as `nullable().default(null)` (intrinsic `{kind,name}` or export `{kind,file,exportName}`); public codes `CONTEXT_PARAMETER_INVALID` and `CONTEXT_PARAMETER_PROOF_FAILED` with ADR messages; raw codes `CONTEXT_PARAMETER_{MISSING,UNSAFE,TYPE_MISMATCH,UNRESOLVED}` and `CONTEXT_TYPE_UNRESOLVED`; evaluator `checks/context.ts` over the shared exported-function traversal; nominal identity by symbol with alias/derived/generic-target/intersection/union handling and constrained generics; `checks/context.test.ts` 4 cases (22 symbols); compatibility subject grammar for both subject families; contracts regenerated and README updated; golden byte-identical; validator suite 51 passed; self-policy digest identical twice; benchmark 5574 ms and 4630 ms, peak RSS 424,271,872 bytes |
| 5 | `require-closed-registry` | 1.3 | done (Node 22 verify exit 0, 322 unit tests in 60 files, self-policy digest identical twice, kernel diff empty, kz-checker PASS) | schema `{registryFile, registryExport, declarationFiles, declarationCalls, requiredKeys(0..100)}`; public codes `CLOSED_REGISTRY_ENTRY_INVALID`, `UNREGISTERED_DECLARATION`, `CLOSED_REGISTRY_PROOF_FAILED` with ADR messages and subject grammar (raw codes identical); adapter `checks/registry.ts` over the shared prover; decision: duplicate declarations are `CLOSED_REGISTRY_PROOF_FAILED` with subject `proof:declaration` (grammar-conforming); `checks/registry.test.ts` 4 cases covering pass, key/id/duplicate/mismatch/unregistered, proof failures (indirection, spread, computed, accessor, method, sealed, dynamic id), missing export/file; compatibility grammar per code; contracts regenerated; validator+profile suites 111 passed |
| 6 | `restrict-property-write` | 1.4 | done (Node 22 verify exit 0, 332 unit tests in 61 files, self-policy digest identical twice, kernel diff empty, property-write benchmark 5001 files two rules 3984 ms and 3152 ms peak RSS 564,936,704 bytes with 1000 expected findings, kz-checker PASS) | schema `{files, targetType{file,exportName}, property, allowFrom(0..100)}`; public codes `PROPERTY_WRITE_DENIED` and `PROPERTY_WRITE_PROOF_FAILED` with ADR messages and the single `property:<file>#<export>.<property>` subject; raw codes `PROPERTY_WRITE_DENIED`, `PROPERTY_WRITE_UNRESOLVED`, `PROPERTY_TARGET_UNRESOLVED`; evaluator `checks/property-write.ts` with one lazily built per-program write index (WeakMap on the program) shared by every rule; write forms: assignment family, ++/--, delete, literal/const element access, destructuring targets, class fields and constructor parameter properties, contextually typed/asserted/satisfied object literals; containment by symbol through alias, extends, implements, generic reference target, intersection, union, constrained generic; proof failures for unsafe receivers, unresolved computed keys, unresolved spreads; `checks/property-write.test.ts` 3 cases (19 denied forms, 5 ambiguity outcomes, 3 target failures); compatibility exact-subject rule; contracts regenerated |
| 7 | Custody contracts and pure crypto | 3.1 | done (Node 22 verify exit 0, 337 unit tests in 62 files, domain and persistence diffs empty, no profile import, kz-checker PASS) | `packages/contracts/src/public/custody.ts`: strict `PolicyApproval`, `WorkspaceTrustBundle` (keys unique, key-ID sorted, strict Ed25519 JWK, non-empty validity window), `PolicyCustodyEvidence` (no run ID or wall clock) under `kernel-zero.dev/custody/v1`; canonical payload digests, `createSignedPolicyApproval` and `createWorkspaceTrustBundle` (control-plane side), pure `verifyPolicyCustody` producing deterministic evidence with the nine frozen `CUSTODY_*` codes, messages, and subjects; authority judged only at signed `approvedAt` with inclusive validFrom/validUntil and exclusive revokedFrom; `custody.test.ts` 5 cases including fast-check key-order property and single-field tamper matrix; barrel export; three JSON schemas, three canonical examples, three malformed fixtures, and README section generated; contracts:check clean; no profile import |
| 8 | Custody-first validator flow | 3.2 | done (Node 22 verify exit 0, 342 unit tests in 63 files, self-policy digest identical twice, installed CLI exit matrix 0/2/2 reproduced by checker, kz-checker PASS; note: `dist/*.tgz` is a stale pre-slice artifact, re-run `npm run validator:pack` before shipping) | all-or-none CLI group `--policy-approval`, `--workspace-trust`, `--custody-out` (contained paths resolved like the exception pair); runner parses policy, exceptions, then both custody artifacts strictly before any cryptographic use or output; custody evidence written before discovery; a valid custody failure raises `CustodyRejectedError` (carries the evidence) which the CLI maps to exit 1 with `--out` untouched and no source scan; malformed or unreadable custody input exits 2 with neither output; legacy behavior byte-identical (timing excluded) when the group is absent; `ValidationRun` gains `custody`; `custody-flow.test.ts` 5 cases (option group, pass order and determinism, fail order, exit 2 matrix, legacy equivalence); validator suite 63 passed |
| 9 | CLI `explain` and `init` | 2.1, 2.2 | done (Node 22 verify exit 0, 351 unit tests in 64 files, self-policy digest identical twice, installed bundle init/explain matrix reproduced by checker with byte-identical refusal, kz-checker PASS) | `render.ts`: deterministic summary line plus one line per finding (level, rule, path:line:col, code, subject, exception) with remediation, capped at 200 with a trailing count; `validate` now prints rendered findings and a custody line after the executor returns (JSON stays authoritative); `commands.ts`: `explain --policy|--evidence|--custody` over strictly parsed artifacts (RepositoryPolicy, kernel StoredEvidence, PolicyCustodyEvidence), unknown kinds or codes exit 2, no source or network; `init [--root] [--workspace]` scaffolds policy, pre-commit hook, and workflow with `wx` writes, refuses any overwrite listing the conflicts, prints the AGENTS/CLAUDE snippet with pinned validator 0.1.0 and never edits package.json or agent files; `commands.test.ts` 9 cases incl. CLI routing and rendered output; README and validator-and-hooks documented; validator suite 72 passed |
| 10 | Billing adapter tests, dependency exception renewal | none | done (Node 22 verify exit 0, 361 unit tests in 65 files, browser checks 6 passed, self-policy digest identical twice, final kz-checker PASS) | `apps/control/src/server/billing/stripe-adapter.test.ts` mocks the Stripe SDK module and covers all seven adapter operations: Open cancel-at-period-end and local command id, paid create with lookup key and conditional 14-day trial, in-place update with prorations, missing/interval-mismatched price and empty subscription and SDK failure mapped to `BillingProviderError`, card-only payment-method mapping for both customer shapes, idempotency keys on default/detach, fingerprint read, price resolution never throwing, signature failure as `BillingSignatureError`, subscription/invoice/unknown event normalization (10 cases); dependency exception GHSA-ggr8-5vv4-36mx re-audited 2026-09-04 (three entries, only fix is a Prisma downgrade, not reachable from user input) and renewed to 2026-12-31 in `docs/HANDOFF.md` and `docs/evidence/REPO-AUDIT.md` |

## Continuation: source plan 4.1 and onward

| Slice | Status | Evidence |
| --- | --- | --- |
| 4.1 Workspace authority persistence | done (Node 22 verify exit 0, 373 unit tests in 66 files, 10 integration tests in 4 files, self-policy digest identical twice, domain and contracts diffs empty, kz-checker PASS; note: bare `npm run prisma:validate` needs DATABASE_URL in the shell, pre-existing) | migration `20260904120000_policy_custody` adds `PolicyAuthorityKey` (public JWK `x` only, `validFrom`/`validUntil`/`revokedFrom`, unique `(workspaceId, keyId)`, timeline and key-shape checks) and immutable `PolicyApprovalArtifact` (one per `(workspaceId, revisionId)`, composite FK to the workspace's key, digest-shape check, update-rejecting trigger); repository `policy-custody.ts` with `registerPolicyAuthorityKey`, `revokePolicyAuthorityKey`, `listPolicyAuthorityKeys`, `readWorkspaceTrustBundle` (revision = keys + revocations), `findPolicyApprovalArtifact`, transaction-scoped idempotent `createPolicyApprovalArtifact`; every selector takes `workspaceId`; constraint-error map extended; unit tests 6 cases; gate 5 database test proves empty-database migration, duplicate key, check constraints, no private column, verifiable trust bundle, sibling-workspace not-found, five-way concurrent insert with one row, identical retry, conflicting retry, update rejection, retroactive revocation |
| 4.2 `policy.approve-with-custody` | done (Node 22 verify exit 0, 379 unit tests in 67 files, 11 integration tests, self-policy pass over 10 rules with identical digests, both new rules proven to bite by the maker, domain and contracts diffs empty, kz-checker PASS) | governed action defined with all six fields per ADR (`quota: null` justified inline); `freezeDraftRevision` extracted from `approvePolicyRevision` (behavior unchanged) and shared; `approvePolicyRevisionWithCustody` in persistence: signer key match, workspace-scoped revision and key lookup, one database-sourced `now()`, authority window check at that instant, freeze, canonical payload digest, injected `PolicyAuthoritySigner.sign`, self-verification against the stored public coordinate, artifact filed through the parsed-approval boundary, audit `policy.revision-approved-with-custody`, all in one transaction; retry on a custody-approved revision returns the stored artifact without signing; plainly approved revisions refuse custody; `PolicyService.approveWithCustody` behind `requireCapability`; `custody-signer.ts` ships only `createEphemeralPolicyAuthority` (in-process key, never exported) and `productionPolicyAuthoritySigner` that fails as `FEATURE_UNAVAILABLE`; two self-policy rules added and proven to bite (`validator-stays-network-and-database-free`, `custody-artifacts-are-parsed`), self-policy digest therefore changed; no transport or UI (addendum does not require it); unit tests 65 across persistence, policy service, signer, registry; gate 5 end-to-end approval with custody, verifiable artifact, idempotent retry, sibling-workspace refusal |
| 5.1 Custody-aware adoption docs and traceability | done (Node 22 verify exit 0, 379 unit tests in 67 files) | `docs/validator-and-hooks.md` gains a custody-aware adoption section (protected inputs incl. trust bundle, CODEOWNERS and required check as human operations, trust distribution outside the validator, approval-time semantics and rotation order, exit codes, what ships today); README adoption paragraph and `kz-adopt` skill step updated; traceability generator gains FR-CUS-001..008 and refreshed FR-POL and FR-VAL evidence; `docs/TRACEABILITY.md` regenerated with 97 mappings |
| 6.1 Policy custody settings surface (beyond the source plan) | done (Node 22 verify exit 0, 381 unit tests in 68 files, 13 integration tests, browser checks 6 passed with the custody route built, self-policy digest identical twice, contracts and persistence diffs empty, kz-checker PASS) | new owner-only capability `policy.authority-key.manage` (policy group; excluded from administrator and custom roles; authorization tests updated); governed action `policy-authority-key.manage` with all six fields; `PolicyCustodyService` (register and revoke behind `requireCapability`); read model `loadPolicyCustodyView` (public summaries plus the trust bundle); page `/app/settings/custody` server-rendered behind `policy.read`, forms post to strictly parsed server actions, revoke requires the key ID typed twice, trust bundle shown as canonical JSON for CI, notices via the closed mutation-state copy; navigation item and UI contract lists updated; no approve-with-custody button until a real signer exists; no persistence import above the service |
| 6.2 Trust-bundle API and authenticated custody journey | done (Node 22 verify exit 0, 385 unit tests in 69 files, 13 integration tests, browser suite 8 passed twice by the checker with no surviving database process, kz-checker PASS; integration global setup now stops a stale embedded PostgreSQL from an interrupted teardown before starting); browser journey on desktop and 320px with axe clean on the custody page and the bundle fetched over the API; fixes found by the journey: the built server runs as production so the fixture now declares NODE_ENV=test, the sign-in callback bounces new accounts to workspace setup, and the revoke form's label was ambiguous with the register form's (renamed to "Key ID to revoke") | `GET /api/custody/v1/trust-bundle`: shared `resolveRequestContext` (evidence route moved onto it), `policy.read` required, canonical bundle with its media type, `no-store`, correlation header, 401/403/404/500 envelopes, 4 route tests; browser fixture: `scripts/start-browser-server.mjs` now starts an embedded PostgreSQL on port 55330, migrates, seeds one verified owner account through Better Auth's password hash, and sets the app environment before the production server; `tests/browser/custody-journey.spec.ts` signs in through the real form, creates the workspace on first run, opens the custody page, runs axe and a keyboard check, registers a freshly generated Ed25519 public coordinate, sees it in the row list and trust bundle, revokes it with typed confirmation, and fetches the bundle over the API |
| 5.2 Final fixture qualification | done (Node 22 verify exit 0, 379 unit tests in 67 files, 13 integration tests in 5 files, browser checks 6 passed, final kz-checker PASS with two gate-hardening findings fixed) | gate 6 database test `gate6-custody-end-to-end.test.ts`: ephemeral authority key registered, maker proposes, different checker approves with custody, trust bundle exported, validator proves custody offline and validates source with exit pass, both artifacts reproduce byte for byte across two runs, tampered approval fails with integrity and signature findings, wrong workspace fails with workspace mismatch, repository evidence untouched in both failures; old v1 golden fixtures unchanged (golden test inside verify); package check pass and tarball refreshed; benchmark 19111 ms and 15417 ms (measured while the full gate ran concurrently) peak RSS 422,088,704 bytes deterministic; self-policy digest identical twice with policy digest sha256:6bae6df4...; rewrite inventory 1388 symbols, 285 call edges, 17 field-I/O across 251 files; self-check missing 0, call-graph delta 0, content diff 0, dead params 0; the reverse-contamination fingerprint scan is NOT performed here because its fingerprint input comes from the protected reference the clean-room rules bar this session from opening; it remains a human-run step before publication |

## Final checker findings on the custody slices (2026-09-05)

The final `kz-checker` passed every step but found two gate weaknesses, both
fixed in `vitest.integration.config.ts`:

- the integration config lacked `passWithNoTests: false`, so an embedded
  PostgreSQL that failed to start (an orphaned `postgres.exe` held its shared
  memory) let `npm run verify` exit 0 with zero integration tests; the guard is
  now on and proven to exit 1 with no test files;
- database tests ran under vitest's five-second default and the gate 6 fixture
  timed out under concurrent CPU load, which then let the still-running test
  overwrite a later assertion's sentinel file; `testTimeout` is now 60 seconds.

Anyone quoting `verify` exit 0 must also quote the integration `Tests N passed`
line. An orphaned embedded-postgres child after a hard timeout can still block
the next run; killing it is manual today.

## Contamination scan procedure (human step one, agent step two)

The original product is not on this machine and no agent in this repository may open it, so
the fingerprint must come from a separate analyzer session that has the original:

1. In that session, follow the clean-room skill's "Build a fingerprint" step: extract rare
   identifiers, distinctive error phrasings, unique comment phrasings, and hand-picked
   constants that would be suspicious if they appeared verbatim here. Exclude anything that is
   part of the public contract. Save one term per line to `clean-room/fingerprint.txt`
   (gitignored; `#` comments allowed).
2. Back here, run from the repository root:
   `python "C:/Users/Guerr/.codex/skills/clean-room/scripts/contamination-scan.py" clean-room/fingerprint.txt .`
   Exit 0 means no hits. Exit 1 lists file, line, and term for every hit; triage each as a
   legitimate public-contract term (remove it from the fingerprint and rerun) or a real leak
   (rewrite the code). The scanner already ignores `node_modules`, build output, and `clean-room/`.
3. Record the result in `docs/evidence/REPO-AUDIT.md` and here. Regenerate the fingerprint
   before publication if the rewrite has moved on.

Run on 2026-09-05 by the clean-room contamination reviewer agent (the only party that read the
original, at the owner-supplied path): 532 terms, first run 16 hits across 4 terms, all
triaged as library or PRP vocabulary and removed, final run exit 0 with 528 terms. Verdict
CLEAN AFTER TRIAGE. Details in `docs/evidence/REPO-AUDIT.md`; fingerprint at
`clean-room/fingerprint.txt` (gitignored).

## Decisions

- 2026-09-05, owner: **no production seal for now.** Production signer composition stays
  unavailable by design; plain `policy.approve` remains the live approval path; the
  approve-with-custody control is intentionally absent from the UI. Revisit when a customer
  requires tamper-evident approvals. The owner's options at that point are a server-side key
  file (weakest custody, fits the ADR), a local hardware module (fits the ADR, operationally
  heavy), or a cloud key service (most common, requires amending the ADR's "no remote signer"
  rule first).

- `apps/control/next-env.d.ts` is regenerated by Next 16 with different import
  paths under `next dev` (`.next/dev/types`) and `next build` (`.next/types`),
  so it cannot be tracked without churn. Root typecheck was proven to pass with
  the file absent, so it is gitignored and untracked. `next build` recreates it.

## Pre-commit review (2026-09-04)

A high-effort code review over the full working tree found ten defects, all
fixed with tests that bite before the first commit:

- destructuring defaults (`[x = 1] = arr`) crashed the write index for every
  program containing one; defaults inside assignment patterns are now skipped
  and the pattern walk records the real target;
- a declaration stashed elsewhere in the registry file bypassed the closed
  registry because entry exemption keyed on `call.parent`; exemption now keys on
  the exact call nodes the prover accepted as entry values;
- `Readonly<T>` and `Required<T>` of the expected type were type mismatches;
  they now preserve identity, while `Partial`/`Pick`/`Omit` stay mismatches;
- the configured type file of `restrict-property-write` and
  `require-context-parameter` was not claimed for parse failures and could be
  proven from a recovered tree; it is claimed and skipped when failed;
- string-literal method names (`Api.create-user`) and colon-bearing required
  keys produced valid findings that ingestion compatibility rejected;
- `init` wrote the hook without an executable mode;
- `--out` could collide with `--custody-out` or an input path; outputs must now
  be distinct from each other and from every input;
- a rejected custody run printed only a count; it now renders the custody
  findings before exiting 1;
- `explain --evidence` accepted unknown codes via the kernel schema; it now
  uses the closed RepositoryEvidence schema and refuses other evidence kinds.

Deferred cleanups from the same review: the validator version string is
declared in `runner.ts` and `commands.ts`; the custody option group is
validated in three places; the subject grammar regexes are duplicated between
the validator and the profile.

## Do-not-retry

(none yet)
