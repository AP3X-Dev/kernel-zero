---
name: kz-policy-rule
description: Add or change a KERNEL ZERO architecture policy rule, either a new rule using an existing check kind or a brand-new check kind in the validator. Use when asked to "add a rule", "forbid imports from", "require X in Y", "add a check kind", or "extend the validator".
---

# kz-policy-rule

Announce: "Using kz-policy-rule; branch A (existing kind) or branch B (new kind)."

Invoke `kz-grill` first. Its ADR must say which branch.

## Branch A: new rule, existing kind

Existing kinds: `forbid-import-edge`, `require-import`, `restrict-call-site`, `require-export-keys`, `require-tenant-parameter`, `require-boundary-parse`, `require-governed-operation`. Schema: `packages/profile-software-architecture/src/policy.ts`.

1. Add the rule object to `kernel-zero.policy.json` with `id`, `title`, `level`, `check`, `remediation`. Rule IDs are slugs, 3 to 80 chars, unique.
2. Prove it bites: introduce the violation on purpose in one file, run `npm run validator:self`, expect exit 1 and one finding with your rule ID. Revert the violation.
3. Run `npm run validator:self` again, expect exit 0.
4. Record the new `integrity.digest` from `.kernel-zero/evidence.json` in the ADR; the policy changed so the digest changed.
5. Gate: `npm run verify`, expect exit 0.

## Branch B: new check kind

This touches the profile schema, the engine, compatibility, fixtures, benchmark, and generated contracts. Each step has its own check.

1. Schema: add a `z.strictObject({ kind: z.literal("<new-kind>"), ... })` member to `PolicyCheckSchema`. Run `npx vitest run packages/profile-software-architecture`; the schema test must cover an accepted and a rejected example.
2. Message code: add `<NEW_CODE>` and its message string to the profile's message table (`packages/profile-software-architecture/src/evidence.ts`). Add the mapping in `findingCompatibilityReason` (`packages/profile-software-architecture/src/compatibility.ts`) including a `rule_subject_mismatch` rule for the new subject format.
3. Engine: add the `case "<new-kind>"` in `packages/validator/src/engine.ts` dispatch and its evaluator. Emit findings only through the existing finding constructor so IDs and fingerprints stay canonical.
4. Fixtures: add a passing and a failing fixture under `packages/validator/fixtures/` and a test in `engine.test.ts` that asserts the exact finding list, including `subject` and `location`.
5. Determinism: run `npm run validator:self` twice; `integrity.digest` must be identical both times.
6. Benchmark: `npm run benchmark:validator`; must stay under 30 seconds and 1 GiB peak RSS for the 5,000-file corpus. Quote both numbers.
7. Contracts: `npm run contracts:generate` then `npm run contracts:check`. Update `docs/contracts/README.md` with the new kind.
8. Gate: `npm run verify`, expect exit 0.

Never: emit a finding without a rule ID, reuse an existing message code for new semantics, or make a rule's outcome depend on the network, the clock, or environment variables.

If a requested check needs the network, the clock, or a registry, refuse it as a rule kind and redirect: a deterministic rule over the lockfile or package.json belongs in the manifest profile (`packages/profile-manifest`, skill kz-profile), not in the validator.
