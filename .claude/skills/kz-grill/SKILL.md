---
name: kz-grill
description: Interview the engineer about a planned KERNEL ZERO change until every affected invariant, package, contract, and approval gate is settled. Use when someone says "grill me on this", "stress-test this change", or before any kz-* builder skill starts.
---

# kz-grill

Announce: "Using kz-grill to settle the design before any edit."

This is `grill-with-docs` specialised for this repository. Ask one question at a time. Do not propose code. Stop when every branch below has an answer the engineer has confirmed in their own words.

## Sources to open first

- `AGENTS.md` (workspace rules and MemBerry tags)
- `docs/superpowers/specs/2026-08-31-policy-foundry.md` (layering and request flow)
- `kernel-zero.policy.json` (self-policy rules)
- `docs/TRACEABILITY.md` (FR-ID map)
- `invariants.md` beside this file

## Decision tree

1. **Which layer?** domain, contracts, persistence, validator, a profile package, control server, control UI, or scripts. If the answer spans more than two, ask which one owns the behaviour and which merely call it.
2. **Which invariant does this touch?** Walk `invariants.md` top to bottom. For each "yes", ask how the change keeps the invariant true and what test proves it.
3. **Does a public contract change?** If yes: is it additive, does the canonical digest of existing artifacts change, and does `docs/contracts` get regenerated? A digest change is a breaking change; say so.
4. **Is this a new governed action?** If yes: capability, tenantScope, quota, audit code, idempotency, and transaction timeout, each stated explicitly.
5. **Is this a new rule or a new rule kind?** A new kind means engine, schema, fixtures, compatibility, and benchmark. Confirm the engineer wants the larger scope.
6. **Is this a new profile?** Confirm it can be expressed as a `Profile` with no kernel edits beyond registration. If not, the seam is being bent; stop and escalate.
7. **What is the failure mode?** What happens on malformed input, on a missing policy, on a stale digest? "It throws" is not an answer; name the code and the exit code.
8. **Which FR-IDs?** List the requirement IDs from `docs/TRACEABILITY.md` this satisfies or changes. New behaviour with no FR-ID needs the engineer to say so out loud.
9. **Which human gates?** Confirm nothing in the change publishes, pushes, deploys, or touches credentials.

## Output

Write `docs/adr/<YYYY-MM-DD>-<slug>.md` with: Context, Decision, Invariants touched (numbered from `invariants.md`), Contract impact, FR-IDs, Verification command. Create `docs/adr/` if it does not exist. Then hand off to the builder skill the engineer names.
