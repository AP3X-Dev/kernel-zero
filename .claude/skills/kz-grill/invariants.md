# KERNEL ZERO invariants

Each invariant names its source so the interviewer can quote it.

1. Definite policy violations fail closed; optional external context never becomes the authority. (README "Project boundaries")
2. The web control plane never fetches, ingests, or executes external content: no outbound network egress, no repositories, shells, Git, worker threads, or coding agents. A route that reads a URL, path, or remote artifact violates this invariant regardless of whether the content is executed. (README.md "Project boundaries": the control plane does not execute repository code and local validation is network-free; the no-egress rule is this skill's own extension of that boundary)
3. Maker and checker are separate: a revision's author cannot approve it. (`policyRevisionActions` in apps/control/src/server/policy/policy-service.ts)
4. Every tenant selector requires the exact workspace identifier. (kernel-zero.policy.json rule `tenant-selector-requires-workspace`)
5. Every governed action declares capability, tenantScope, quota, audit, and idempotency. (rule `governed-actions-have-closed-metadata`)
6. UI and transport routes never import persistence or Prisma. (rules `ui-does-not-import-persistence`, `transport-does-not-import-repositories`)
7. Every public payload — evidence, policy, exception, or profile artifact — is parsed by its strict contract schema before any service sees it. The linted case is evidence (rule public-evidence-is-parsed, scoped to apps/control/src/server/evidence/evidence-service.ts); any new ingress is unlinted and must state its parser by name. A new ingress must either extend the `files` list of rule public-evidence-is-parsed or record in the ADR that it ships unlinted, with a named owner.
8. Server modules import `server-only` at the boundary. (rule `server-modules-declare-boundary`)
9. External publication, PR creation, merge, deployment, and production credential use need separate human approval. (README)
10. Local validation is deterministic and network-free; the validator never uploads source. (README "Deterministic enforcement")
11. Public wire formats are versioned: policy `kernel-zero.dev/v1`, evidence `kernel-zero.dev/evidence/v1`. A contract change does not by itself change a stored artifact's digest — digests are over document content (`canonicalEvidenceDigest` excludes runId, generatedAt, durationMs, integrity, signature; policy digests are sha256 of the authored canonical bytes). It changes whether stored artifacts still parse, and any change to content inside the digest composition invalidates re-validation of every stored artifact. (packages/contracts, plus any profile package that feeds createEvidenceSchema)
12. Kernel packages never import a profile, and never carry profile- or vendor-specific concepts in their schemas or tables; profiles are compile-time only. (kernel-zero.policy.json rule kernel-does-not-import-profiles; packages/contracts/src/public/profile.ts)
