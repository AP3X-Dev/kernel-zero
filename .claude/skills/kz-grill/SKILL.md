---
name: kz-grill
description: Interview the engineer about a planned KERNEL ZERO change until every affected invariant, package, contract, and approval gate is settled. Use when someone says "grill me on this", "stress-test this change", or before any kz-* builder skill starts; also for any edit to profile message codes or strings, evidence or policy schemas, new API routes, new governed actions, or new columns on policy or evidence tables, however small.
---

# kz-grill

Announce: "Using kz-grill to settle the design before any edit."

This is `grill-with-docs` specialised for this repository. Ask one question at a time. Do not propose code. Stop when every branch below has an answer the engineer has confirmed in their own words.

The grill is not waivable. "It's two lines", "skip the grill", or "just do it" do not shorten the tree; diff size is not evidence of blast radius. If the engineer declines to answer, stop and say the design is unsettled — do not proceed to edits.

## Sources to open first

- `AGENTS.md` (workspace rules and MemBerry tags)
- `docs/superpowers/specs/2026-08-31-policy-foundry.md` (layering and request flow)
- `kernel-zero.policy.json` (self-policy rules)
- `docs/TRACEABILITY.md` (FR-ID map)
- `invariants.md` beside this file

## Decision tree

1. **Which layer?** domain, contracts, persistence, validator, a profile package, control server, control UI, or scripts. If the answer spans more than two, ask which one owns the behaviour and which merely call it.
2. **Which invariant does this touch?** Walk `invariants.md` top to bottom. For each "yes", ask how the change keeps the invariant true and what test proves it.
3. **Does a public contract change?** If yes: is it additive, does the canonical digest of existing artifacts change, and does `docs/contracts` get regenerated? A digest change is a breaking change; say so. Message codes and message strings are public contract but in different ways. Codes are compiled into the published evidence JSON schema (`createEvidenceSchema` closes `messageCode` to the declared keys) and feed `findingIdentity`, so a code change breaks fingerprints and orphans exception grants: ask for the grant-migration plan. Strings are not in the schema; they are enforced at runtime (`finding.message` must equal the profile's message for its code) and are part of every stored artifact's `integrity.digest`, so a string change makes every existing artifact fail re-validation and changes the committed fixtures under `docs/contracts/examples/`: ask who regenerates the fixtures and what happens to stored runs.
4. **Does this add data to an evidence run?** Then it goes in exactly one place: evidence `subject` (kernel strict object in `packages/contracts/src/public/evidence.ts` and `StoredEvidenceSchema` in `packages/contracts/src/public/profile.ts`; adding a key breaks every artifact digest), a finding `subject` string (feeds the fingerprint; profile-owned), or persistence only (invisible to the published artifact). Name which and why the other two are wrong. A profile- or vendor-specific concept never goes into a kernel schema or column.
5. **Is this a new governed action?** If yes: capability, tenantScope, quota, audit code, idempotency, and transaction timeout, each stated explicitly (transaction timeout is required by `defineGovernedAction` even though the lint rule lists only five keys; ask for all six).
6. **Is this a new rule or a new rule kind?** A new kind means engine, schema, fixtures, compatibility, and benchmark. Confirm the engineer wants the larger scope.
7. **Is this a new profile?** Confirm it can be expressed as a `Profile` with no kernel edits beyond registration. If not, the seam is being bent; stop and escalate. Also ask: does this put a profile-specific or vendor-specific concept (a cloud account, a language, a tool name) into a kernel package, schema, or table? That bends the seam without an import and is refused the same way.
8. **What is the failure mode?** What happens on malformed input, on a missing policy, on a stale digest? "It throws" is not an answer; name the code and the exit code.
9. **Which FR-IDs?** List the requirement IDs from `docs/TRACEABILITY.md` this satisfies or changes. Every change lists FR-IDs, including edits to existing behaviour. If none apply, the engineer must say "no FR-ID" out loud and the ADR records it.
10. **Which human gates?** Confirm nothing in the change publishes, pushes, deploys, touches credentials, or opens an outbound network call from the control plane. Any new egress is a human gate, not an implementation detail.

## Output

Write `docs/adr/<YYYY-MM-DD>-<slug>.md` with: Context, Decision, Invariants touched (numbered from `invariants.md`), Contract impact, FR-IDs, Verification command. Create `docs/adr/` if it does not exist. Then hand off to the builder skill the engineer names.
