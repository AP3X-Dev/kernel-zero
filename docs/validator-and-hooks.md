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

## Named layers

`kernel-zero.policy.json` declares its architectural layers once under
`layers` and references them from rule file lists (`from`, `files`,
`allowFrom`, `declarationFiles`) as `layer:<name>`. `scope.include` and
`scope.exclude` accept globs only. The repository self-policy uses six layers:

```json
"layers": {
  "ui": ["apps/control/src/app/**/page.tsx", "apps/control/src/app/**/layout.tsx"],
  "transport": ["apps/control/src/app/api/**/*.ts"],
  "service": ["apps/control/src/server/**/*.ts"],
  "persistence": ["packages/persistence/src/**/*.ts"],
  "kernel": ["packages/domain/**/*.ts", "packages/contracts/**/*.ts", "packages/persistence/**/*.ts"],
  "validator": ["packages/validator/**/*.ts"]
}
```

and `transport-does-not-import-repositories` reads
`"from": ["layer:transport"]`. References are expanded after the policy digest
is computed and before evaluation, so subjects, fingerprints, and the digest
of a layer-free policy are unchanged. An undeclared or malformed reference, or
one placed in `scope`, is a policy contract failure (exit `2`).

## Required call arguments

The self-policy rule `tenant-queries-carry-workspace` uses
`require-call-argument` to prove that every `*.findFirst`, `*.findMany`,
`*.updateMany`, `*.deleteMany`, and `*.count` call in `layer:persistence`
carries `where.workspaceId` in its first argument; `audit.ts` is the only
`allowFrom` file because audit rows are keyed by `workspaceOpaqueId`.

```json
"check": {
  "kind": "require-call-argument",
  "files": ["layer:persistence"],
  "callee": ["*.findFirst", "*.findMany", "*.updateMany", "*.deleteMany", "*.count"],
  "argument": 0,
  "requiredPath": "where.workspaceId",
  "allowFrom": ["packages/persistence/src/audit.ts"]
}
```

Deleting one `workspaceId` from a selector fails the gate with
`CALL_ARGUMENT_MISSING` at the call; a selector the validator cannot prove
(an opaque spread, a value built elsewhere, a receiver typed `any`) fails with
`CALL_ARGUMENT_PROOF_FAILED`. `findUnique` is not listed: compound-unique
selectors carry the tenant key inside the unique-key object, which the
composite index already scopes.

## Governed state transitions

The self-policy rule `policy-revision-state-is-governed` uses
`restrict-state-transition` to prove that `*.policyRevision.updateMany`
writes `data.state` only from `packages/persistence/src/policies.ts`, and
only as `draft->approved`, `approved->active`, or `active->superseded`, read
from the literal `where.state` predicate and the literal `data.state` value.

```json
"check": {
  "kind": "restrict-state-transition",
  "callee": ["*.policyRevision.updateMany"],
  "argument": 0,
  "field": "data.state",
  "allowFrom": ["packages/persistence/src/policies.ts"],
  "transitions": [
    { "from": "draft", "to": "approved" },
    { "from": "approved", "to": "active" },
    { "from": "active", "to": "superseded" }
  ]
}
```

A state write anywhere else fails the gate with `STATE_TRANSITION_DENIED`
and the callee chain as subject; a write in `policies.ts` through an
unlisted pair fails with the same code and subject `transition:state:<from>-><to>`;
a write whose `where` carries no literal `state`, or whose `data` is a spread,
fails with `STATE_TRANSITION_PROOF_FAILED`. Writes that touch other columns
are ignored.

## Agent-facing commands

`kernel-zero explain --policy|--evidence <file>` renders one strictly parsed
artifact for a human or an agent: rules with remediation, or findings with
location and remediation. It reads no source and performs no network access, so
unknown codes or kinds fail parsing with exit `2` instead of being guessed at.

`kernel-zero init` scaffolds the policy, pre-commit hook, and CI workflow into a
consumer repository, refusing to overwrite anything that already exists, and
prints the AGENTS/CLAUDE authority text for a human to place. It pins the exact
validator version in that guidance and touches neither `package.json`, agent
instructions, git configuration, nor branch protection.

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

For stronger separation, give the maker an isolated worktree or container and
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
