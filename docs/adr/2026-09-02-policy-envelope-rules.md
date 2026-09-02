# Policy envelope requires rules

## Context
The governance view rendered a policy's rules through a cast because the kernel-side `PolicyEnvelopeSchema` only guaranteed `apiVersion`, `kind`, and `metadata`. Every profile already requires `rules[]` with `check.kind`, `id`, `level`, `remediation`, and `title`.

## Decision
`PolicyEnvelopeSchema` now requires `rules` (at least one) whose items carry those five fields; items stay loose so profile-specific fields pass through. The view builds its rows from the envelope, with no cast.

## Invariants touched
11 (contract change). The envelope is not a published schema; `docs/contracts` is unchanged.

## Contract impact
Policy digests are computed over the profile-parsed policy, so no digest moves for any profile-produced document. Every profile rule schema is at least as strict as the envelope, so documents that parsed under a profile still parse. A stored document that lacks `rules` or violates those bounds could only have been hand-built; no deployed workspace holds one, so no backfill is needed. If one is found, it fails closed at approval and evidence ingestion, which is the intended behaviour.

## FR-IDs
No FR-ID.

## Verification
`npm run verify` (contracts test `packages/contracts/src/public/profile.test.ts`).
