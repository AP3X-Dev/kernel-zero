# Single-operator cut: working state

ADR: `docs/adr/2026-09-08-single-operator-kernel.md`. Baseline before the cut
(from the slices ledger): `npm run verify` exit 0, 385 unit tests in 69 files,
13 integration tests, browser suite 8 passed.

| Step | Status | Evidence |
| --- | --- | --- |
| 1 Contracts and validator custody removal (forked agent) | done | validator 70 passed in 9 files, contracts 15 passed, contracts:check exit 0 |
| 2 Domain, persistence, schema, migration | done | schema rewritten to 7 models, single initial migration, persistence and domain 35 tests passed |
| 3 Control plane server, routes, pages | done | typecheck clean, lint clean; bearer-token request context; 7 pages remain |
| 4 Tests, scripts, self-policy | done | self-policy 9 rules pass, digest identical twice, `governed-actions-have-closed-metadata` proven to bite (exit 1 on a missing `tenantScope`, then restored); integration 7 passed in 3 files |
| 5 Docs, skills, dependencies | done | README, validator-and-hooks, CLAUDE.md, invariants, kz-* skills, .env.example, DEPENDENCIES.md; better-auth/resend/stripe removed, lockfile refreshed (45 packages gone) |
| 6 Full gate | done | `npm run verify` exit 0: 264 unit tests in 45 files, 1 architecture test, 7 integration tests in 3 files, self-policy pass over 9 rules (91 files), workflow pass, contracts:check clean; `npm run test:browser` 12 passed (six routes, desktop and 320px); kz-checker run last |

Decisions made during the cut (all in the ADR):
- `require-governed-operation.requiredKeys` cardinality relaxed from exactly 5 to 1..5 in the software-architecture profile schema; the enum is unchanged, so every existing policy still parses and no digest moves. Regenerated `docs/contracts`.
- `ExceptionService` deleted: after authorization left it was a pure pass-through. `PolicyService` stays because it parses documents through the profile registry.
- `FormSubmit`, `ConfirmAction`, and `LiveMutationStatus` deleted: no surviving page has a form or mutation state.
- Upstash rate limiting deleted: it had no caller and existed for the hosted SaaS.

Do-not-retry notes: heredocs with `$$` or embedded quotes fail in this shell; write files with the Write tool or a Python script file.
