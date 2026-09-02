---
name: kz-profile
description: Add a new governance profile to KERNEL ZERO (policy schema, evidence schema, checker, compatibility, registration) with zero kernel edits. Use when asked to "govern X with kernel zero", "add a profile", "add a new policy kind", or "make the kernel check something other than TypeScript architecture".
---

# kz-profile

Announce: "Using kz-profile; the acceptance test is 'registration only' in the kernel."

The seam lives in `packages/profiles`; read `packages/profile-manifest` as the template.

1. Invoke `kz-grill`. The ADR must state the policy kind (`<Name>Policy`), evidence kind (`<Name>Evidence`), tool name, and the closed list of message codes.
2. Copy the shape of `packages/profile-manifest` into `packages/profile-<name>`:
   - `policy.ts`: strict Zod schema; `apiVersion: "kernel-zero.dev/v1"`, `kind: z.literal("<Name>Policy")`, `metadata`, `rules` with unique slug IDs.
   - `evidence.ts`: `createEvidenceSchema({ evidenceKind, toolName, messages })` from `@kernel-zero/contracts`.
   - `check.ts`: pure function from inputs to `readonly EvidenceFinding[]`, sorted with `sortFindings`, identities from `findingIdentity`. No I/O inside the checker; the runner script reads files. Per-run identity (account, environment, target) travels in the evidence `subject` fields or the finding `subject` string, never in a new kernel column.
   - `index.ts`: `findingCompatibilityReason`, `diffRules` (delegating to `diffRulesById` from `@kernel-zero/contracts`; do not write another copy of the rule diff), and the frozen `Profile` object.
3. Register: add to `PROFILES` in `packages/profiles/src/index.ts`, add the workspace to `scripts/check-architecture.mjs` (allowed: contracts, domain), add the tsconfig path, add the dependency to `packages/profiles/package.json`. `Profile.evidenceSchema` is typed `ZodType<StoredEvidence>` (from `@kernel-zero/contracts`), so no cast is needed in `PROFILES`; if TypeScript rejects the profile without a cast, that is a design error to report, not to cast around.
4. Tests: checker test with pass, fail, and key-order determinism cases; registry uniqueness test passes unchanged; an end-to-end submission test in `apps/control/src/server/evidence/evidence-service.test.ts` following the manifest example.
5. Runner: `scripts/run-<name>-validator.ts` writing evidence and exiting 0 / 1 / 2. Add a package script. Do not add it to `verify` unless the repo itself should be governed by it.
6. Contracts: `npm run contracts:generate && npm run contracts:check` produces `docs/contracts/<name>-policy-v1.schema.json` and `<name>-evidence-v1.schema.json`. The JSON-schema functions must serialise the refined schema (`built.schema`) exactly as `packages/profile-manifest/src/evidence.ts` does.
7. README profile table: add a row.
8. Gate: `npm run verify`, expect exit 0.

Acceptance: `git diff --stat` on `packages/domain`, `packages/contracts`, `packages/persistence` is empty. If it is not, the profile needs something the seam does not offer; write that down in the ADR and stop rather than widening the kernel silently.
