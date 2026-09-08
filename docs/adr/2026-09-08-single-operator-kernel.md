# Reduce KERNEL ZERO to a single-operator governance kernel

Date: 2026-09-08. Owner decision, recorded by the engineer on duty.

## Context

The control plane carried a multi-tenant SaaS shell that existed only because the
clean-room PRP treated the product as a hosted service: Better Auth identity with
recovery and verification email, workspaces with memberships, roles, invitations
and ownership transfer, a system-operator boundary, Stripe billing with plans,
quotas, trials and a payment-event ledger, Upstash rate limiting, and a second
custody system (workspace policy-authority keys, signed approval artifacts, trust
bundles, and a custody-first validator flow). The owner decided on 2026-09-05
that no production seal ships, and on 2026-09-08 that the SaaS shell goes.

The owner answered the grill in their own words:

- Tenancy: **no auth at all, single operator**. The control plane is a local
  single-user tool.
- Quotas and entitlements: **remove entirely**.
- Custody: **keep evidence signing keys (attested runs, signed exception
  bundles); remove policy custody** (authority keys, approval artifacts, trust
  bundle, custody CLI flow, custody contracts, custody page and route).
- Public contracts: **keep the Zod schemas and the generated `docs/contracts`
  apparatus; only the custody schemas leave the generated set.**

## Decision

1. Identity, sessions, accounts, verification, recovery, registration, email
   delivery, invitations, memberships, role profiles, ownership transfer,
   workspace creation and deletion, the operator boundary, billing, plans,
   quotas, trial fingerprints, payment receipts, and rate limiting are deleted
   from every layer, together with their pages, routes, tests, migrations, and
   dependencies (`better-auth`, `resend`, `stripe`).
2. The tenant identifier stays. `workspaceId` is part of the evidence contract
   (`workspace`), of every finding fingerprint, and of the lint rule
   `tenant-selector-requires-workspace`, so removing it would be a contract
   break the owner did not ask for. It becomes a configured constant
   (`KERNEL_ZERO_WORKSPACE_ID`, default `00000000-0000-7000-8000-000000000000`,
   the same value the self-validation already uses). There is no `Workspace`
   table; the column is a bare UUID that scopes every selector.
3. There is exactly one actor, the operator. Author, approver, requester,
   decider, revoker, creator, and submitter columns are dropped. Audit records
   carry `actorKind` `operator` or `system`. Maker-checker separation is no
   longer enforced in code or by database constraint; the ADR records this as a
   deliberate loss (invariant 3) and the upgrade path is to reintroduce
   identities, not to fake them.
4. Governed actions keep the closed registry and the serializable audit-in-
   transaction executor, with four fields: `audit`, `idempotency`,
   `tenantScope`, `transactionTimeoutMs`. `capability` and `quota` are gone with
   the systems that consumed them. The self-policy rule
   `governed-actions-have-closed-metadata` requires the remaining keys.
5. The evidence ingress `POST /api/evidence/v1/runs` is the only network
   ingress and is called from CI, so it keeps one trust boundary: a static
   bearer token from `KERNEL_ZERO_EVIDENCE_TOKEN` (at least 32 characters). Web
   pages are unauthenticated; they are the operator's local console.
6. Evidence retention takes an explicit `retentionDays` instead of a plan.
7. The database schema is rewritten in the single initial migration; the
   custody migration is deleted. Nothing is deployed and nothing was ever
   pushed, so there is no upgrade path to preserve. Existing local databases
   must be recreated.
8. The clean-room `PRP.md` still describes the SaaS product. The owner's
   instruction overrides it; the PRP is untracked and owner-owned, so it is not
   edited here. Requirement groups FR-AUTH, FR-TEN, FR-TEAM, FR-CUS, FR-ENT,
   FR-BILL, and FR-RATE are withdrawn from `docs/TRACEABILITY.md`.

## Invariants touched (numbered from `.claude/skills/kz-grill/invariants.md`)

- 3 (maker and checker are separate): **no longer holds**; single operator.
- 4 (every tenant selector requires the workspace identifier): holds; the
  identifier is now a configured constant and the lint rule still bites.
- 5 (governed actions declare closed metadata): holds with four keys.
- 6, 8: hold unchanged.
- 7 (public payloads parsed at the boundary): holds; the custody ingress that
  rule `custody-artifacts-are-parsed` guarded is deleted with the rule.
- 11 (versioned wire formats): evidence, policy, and exception contracts are
  byte-identical; the `kernel-zero.dev/custody/v1` family is removed.
- 12 (kernel never imports a profile): holds.
- 2, 9, 10: hold; the evidence token adds no egress.

## Contract impact

Evidence, policy, and exception-grant-set schemas, examples, and digests are
unchanged. `PolicyApproval`, `WorkspaceTrustBundle`, and `PolicyCustodyEvidence`
are removed from `packages/contracts` and from `docs/contracts`. The validator
loses `--policy-approval`, `--workspace-trust`, `--custody-out`, and
`explain --custody`; every other CLI behavior is byte-identical (golden fixture
inside `verify`).

## FR-IDs

Withdrawn: FR-AUTH-001..006, FR-TEN-001..006, FR-TEAM-001..009, FR-CUS-001..008,
FR-ENT-001..006, FR-BILL-001..010, FR-RATE-001..004. Retained: FR-POL, FR-VAL,
FR-EVD, FR-EXC, FR-AUD, FR-UI with maker-checker lines struck.

## Verification command

```text
npm run verify
npm run test:browser
git diff --stat
```
