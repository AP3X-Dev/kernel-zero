# KERNEL ZERO invariants

Each invariant names its source so the interviewer can quote it.

1. Definite policy violations fail closed; optional external context never becomes the authority. (README "Project boundaries")
2. The web control plane never fetches, ingests, or executes external content: no outbound network egress, no repositories, shells, Git, worker threads, or coding agents. A route that reads a URL, path, or remote artifact violates this invariant regardless of whether the content is executed. (docs/NEXT_SESSION_HANDOFF.md "Clean-room and authority constraints")
3. Maker and checker are separate: a revision's author cannot approve it. (`policyRevisionActions` in apps/control/src/server/policy/policy-service.ts)
4. Every tenant selector requires the exact workspace identifier. (kernel-zero.policy.json rule `tenant-selector-requires-workspace`)
5. Every governed action declares capability, tenantScope, quota, audit, and idempotency. (rule `governed-actions-have-closed-metadata`)
6. UI and transport routes never import persistence or Prisma. (rules `ui-does-not-import-persistence`, `transport-does-not-import-repositories`)
7. Every public payload — evidence, policy, exception, or profile artifact — is parsed by its strict contract schema before any service sees it. The linted case is evidence (rule public-evidence-is-parsed, scoped to apps/control/src/server/evidence/evidence-service.ts); any new ingress is unlinted and must state its parser by name.
8. Server modules import `server-only` at the boundary. (rule `server-modules-declare-boundary`)
9. External publication, PR creation, merge, deployment, and production credential use need separate human approval. (README)
10. Local validation is deterministic and network-free; the validator never uploads source. (README "Deterministic enforcement")
11. Public wire formats are versioned: policy `kernel-zero.dev/v1`, evidence `kernel-zero.dev/evidence/v1`. Changing a contract changes the digest of every existing artifact. (packages/contracts, plus any profile package that feeds createEvidenceSchema)
12. Kernel packages never import a profile; profiles are compile-time only. (kernel-zero.policy.json rule `kernel-does-not-import-profiles`)
