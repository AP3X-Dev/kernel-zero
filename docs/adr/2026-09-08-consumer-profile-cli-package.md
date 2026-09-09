# Ship profile validators in the public npm package

Date: 2026-09-08
Status: accepted

## Context

The public `@kernel-zero/validator` package currently installs only the
repository architecture validator. The manifest and workflow profiles are
implemented and locally verified, but their executable adapters live in the
KERNEL ZERO monorepo. Consumer developers do not have that repository and need
the mature validators available from one npm installation.

The team has also settled the initial operating model: each developer is
responsible for the agent they drive and may manage their own approvals and
exceptions. Stronger centralized custody is future hardening, not a prerequisite
for making the deterministic validators usable.

## Decision

Release `@kernel-zero/validator` version `0.2.0` with four CLI-only binaries:

- `kernel-zero` for `RepositoryPolicy` validation and existing custody support;
- `kernel-zero-manifest` for `ManifestPolicy` validation;
- `kernel-zero-python` for `PythonPolicy` validation, under the separate Python
  profile ADR;
- `kernel-zero-workflow` for `WorkflowPolicy` validation.

The profile executables are bundled at package build time from their existing
profile packages and runner adapters. Consumers install only
`@kernel-zero/validator`; no workspace package, source checkout, hosted service,
or network access is needed at execution time. The existing `kernel-zero`
command, policy contracts, evidence contracts, finding identities, digests, and
exit-code meanings remain unchanged.

This slice does not mint approvals or exception grants. The package continues
to consume and verify signed artifacts. Developer-owned artifact creation will
be a separate additive CLI slice because its input format, key lifecycle, and
audit fields are public contracts that should not be improvised inside a
distribution change.

## Invariants touched

10. All four installed validators remain deterministic and network-free. The
    packed-tarball check executes each binary from a clean consumer install.
11. Public wire formats remain versioned and unchanged. This release changes
    only npm distribution and executable entry points.
12. The kernel does not import manifest or workflow concepts. Their existing
    runners remain profile-side build entry points and produce separate bundled
    executables.

Invariant 9 still applies: npm publication is a separate authenticated human
gate after local verification and exact-tarball checks pass.

## Contract and compatibility impact

The npm package version changes from `0.1.0` to `0.2.0`. Adding executable names
is backward-compatible for existing CLI consumers. The `kernel-zero` binary and
all v1 JSON artifacts retain their current syntax and meaning. Internal profile
workspace packages remain private and are not runtime dependencies of the
installed tarball. Evidence continues to identify the unchanged validator and
profile engine contract as `0.1.0`; the npm distribution version advances
independently because this slice adds package entry points without changing the
engines or their evidence semantics.

## FR-IDs

This distribution slice adds no new product requirement. It makes the existing
manifest and workflow profile contracts usable by external developers and
retains coverage of `FR-VAL-001` through `FR-VAL-011` for repository validation.

## Failure modes

- Invalid or unreadable policy/input: exit `2`, with no passing claim.
- Definite profile violation: exit `1` with normalized evidence.
- Passing validation: exit `0` with normalized evidence.
- Missing package build input or accidental tarball expansion: package check
  fails before publication.

## Human gates

Implementation, tests, packing, and clean installation are authorized. Commit,
push, and live npm publication remain separate gates. The current npm session is
not authenticated, so publication will additionally require an npm login or
access token.

## Verification

```text
npm run verify
npm run validator:package:check
npm publish --workspace @kernel-zero/validator --dry-run
```

The pinned Node 22 runtime is authoritative and exit `0` is the only pass.
