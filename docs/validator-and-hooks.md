# Validator and enforcement hooks

The validator is the repository's deterministic policy authority. Run it from
the repository root:

```text
npm run validator:self
```

It writes canonical evidence to `.kernel-zero/evidence.json` and exits `0`
for a pass, `1` for definite policy violations, or `2` when validation could
not complete safely. Both nonzero outcomes must block the protected operation.

The command spelling `kernel-zero exceptions export --policy-digest <digest>
--out <file>` is reserved and returns exit `2` with `EXPORT_UNAVAILABLE`
without touching the output. Production export requires an authenticated
control-plane channel and approved signing-key custody; neither is inferred by
the standalone validator.

## Agent-facing commands

`kernel-zero explain --policy|--evidence|--custody <file>` renders one strictly
parsed artifact for a human or an agent: rules with remediation, findings with
location and remediation, or custody findings. It reads no source and performs
no network access, so unknown codes or kinds fail parsing with exit `2` instead
of being guessed at.

`kernel-zero init` scaffolds the policy, pre-commit hook, and CI workflow into a
consumer repository, refusing to overwrite anything that already exists, and
prints the AGENTS/CLAUDE authority text for a human to place. It pins the exact
validator version in that guidance and touches neither `package.json`, agent
instructions, git configuration, nor branch protection.

`kernel-zero validate` accepts the optional all-or-none custody group
`--policy-approval`, `--workspace-trust`, and `--custody-out`. See
`docs/contracts/README.md` for the custody artifacts and proof order.

## Pre-commit example

This repository includes `.githooks/pre-commit`. A developer may opt into the
example locally with:

```text
git config core.hooksPath .githooks
```

Local hooks are convenience feedback, not a security boundary: a workstation
user or untrusted contributor that controls the checkout can bypass or replace
them.

## Untrusted-contributor hook example

Configure the coding host's post-edit or stop hook to execute the same command
from the repository root and reject a nonzero exit. The host—not the
contributor—must own the hook configuration, `kernel-zero.policy.json`, the
validator package, and the protected branch settings. No source upload or
network access is required by validation.

## CI merge gate

`.github/workflows/kernel-zero.yml` installs from `package-lock.json`, validates
the repository self-policy, and preserves the evidence JSON as an artifact. A
repository administrator must make its `verify` job a required branch check.
The workflow file and required-check settings must be protected from the
contributor whose work is being judged.

For stronger custody, give the maker an isolated worktree or container and
have a separate checker run validation from a clean checkout. Disposable
worker orchestration and contributor adapters are intentionally outside this
control-plane repository's product scope; this project supplies the contract,
validator, evidence, hook, and CI gate they consume.

## Installing in another repository

The validator ships as a self-contained bundle so a consumer repository does
not need this monorepo's workspace packages. The consumer-facing surface is
the `kernel-zero` bin only. There is intentionally no JavaScript library export
in version `0.1.0`.

Install the public package in the repository it will govern:

```text
npm install --save-dev @kernel-zero/validator
```

The package installs its pinned TypeScript compiler dependency. Add a
`validator:self` script that points at the consumer's own policy file, then wire
it into `.githooks/pre-commit` the same way this repository does:

```text
"validator:self": "kernel-zero validate --policy kernel-zero.policy.json --root . --workspace <workspace-id> --out .kernel-zero/evidence.json"
```

Maintainers can produce a local tarball or run the complete consumer-artifact
check without publishing:

```text
npm run validator:pack
npm run validator:package:check
```

The package check rebuilds the CLI through its `prepack` lifecycle, asserts the
exact tarball contents and metadata, installs it into a clean temporary project,
and requires an installed `kernel-zero` validation to exit `0`.
