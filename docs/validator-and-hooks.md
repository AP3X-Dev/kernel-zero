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
