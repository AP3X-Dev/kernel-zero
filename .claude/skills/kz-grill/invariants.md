# KERNEL ZERO invariants

Each invariant names its source so the interviewer can quote it.

1. Definite policy violations fail closed; optional external context never becomes the authority. (README "Project boundaries")
2. The web control plane never executes repositories, shells, Git, worker threads, or coding agents. (docs/NEXT_SESSION_HANDOFF.md "Clean-room and authority constraints")
3. Maker and checker are separate: a revision's author cannot approve it. (`policyRevisionActions` in apps/control/src/server/policy/policy-service.ts)
4. Every tenant selector requires the exact workspace identifier. (kernel-zero.policy.json rule `tenant-selector-requires-workspace`)
5. Every governed action declares capability, tenantScope, quota, audit, and idempotency. (rule `governed-actions-have-closed-metadata`)
6. UI and transport routes never import persistence or Prisma. (rules `ui-does-not-import-persistence`, `transport-does-not-import-repositories`)
7. Public evidence is parsed by the strict contract before any service sees it. (rule `public-evidence-is-parsed`)
8. Server modules import `server-only` at the boundary. (rule `server-modules-declare-boundary`)
9. External publication, PR creation, merge, deployment, and production credential use need separate human approval. (README)
10. Local validation is deterministic and network-free; the validator never uploads source. (README "Deterministic enforcement")
11. Public wire formats are versioned: policy `kernel-zero.dev/v1`, evidence `kernel-zero.dev/evidence/v1`. Changing a contract changes the digest of every existing artifact. (packages/contracts)
12. Kernel packages never import a profile; profiles are compile-time only. (kernel-zero.policy.json rule `kernel-does-not-import-profiles`)
