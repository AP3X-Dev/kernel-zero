# Publish the validator as a CLI-only npm package

## Context

`@kernel-zero/validator` already builds a self-contained `kernel-zero` command,
but its workspace manifest still marks it private and describes an unpacked
source export that is absent from the tarball. The repository documentation
also describes only local tarball distribution. Version `0.1.0` needs one
supported public surface that can be installed from npm without publishing the
control plane or the internal workspace libraries.

## Decision

Publish `@kernel-zero/validator` version `0.1.0` as a CLI-only package. Its only
consumer entry point is the `kernel-zero` executable. The package build runs as
a packaging lifecycle step, the packed file set is explicit and independently
smoke-tested, and npm metadata identifies the repository, runtime, license, and
public access level. Internal workspace packages remain private and are used
only while building the bundled executable.

Actual publication remains a distinct, authenticated release operation. It may
run only after the full repository gate and the packed-consumer check pass, and
only with explicit human approval. No credential is stored in the repository.

## Invariants touched

9. External publication remains a separate human gate. This change prepares the
   artifact and release workflow; a human must explicitly start a live publish.
10. Installed validator execution remains deterministic and network-free. The
    package check installs the tarball and proves the same local CLI contract.

The other invariants are unaffected: this adds no control-plane egress, public
payload field, schema, governed action, rule kind, profile, persistence field,
tenant selector, or kernel-to-profile dependency.

## Contract impact

This is the first npm registry release and is additive at the distribution
boundary. The public surface is the existing CLI only. The previous `exports`
entry pointed to source that was never included in the tarball, so it is removed
rather than promoted into an unsupported library API.

Command syntax, exit codes (`0`, `1`, and `2`), finding identity, policy and
evidence schemas, canonicalization, digests, signatures, and stored artifacts
do not change. Existing artifact digests are therefore unchanged.

## FR-IDs

This change adds no new functional requirement. It makes the existing validator
artifact covered by `FR-VAL-001` through `FR-VAL-011` installable from npm.

## Verification command

```text
npm run verify
npm run validator:package:check
npm publish --workspace @kernel-zero/validator --dry-run
```

The pinned Node 22 runtime is authoritative, and exit `0` is the only pass.
