# `@kernel-zero/validator`

The KERNEL ZERO validator is a deterministic, network-free command-line checker
for versioned repository architecture policy. Version `0.1.0` intentionally
provides a CLI only; it has no JavaScript library API.

## Install

Node 22 and npm 10 or newer are required.

```text
npm install --save-dev @kernel-zero/validator
```

The package installs the exact TypeScript compiler version used by the
validator.

## Run

```text
kernel-zero validate \
  --policy kernel-zero.policy.json \
  --root . \
  --workspace 00000000-0000-7000-8000-000000000000 \
  --out .kernel-zero/evidence.json
```

Replace the workspace value with the governed workspace identifier. A policy
example and the complete hook and CI setup are available in the
[KERNEL ZERO repository](https://github.com/AP3X-Dev/KERNEL-ZERO/blob/main/docs/validator-and-hooks.md).

The command exits `0` when policy passes, `1` for definite violations, and `2`
when validation cannot complete safely. Both nonzero outcomes should block the
protected operation. The JSON evidence at `--out` is authoritative; the command
also prints one summary line and one deterministic line per finding (level,
rule, path:line:column, code, subject) followed by the policy remediation.

## Layers

A policy may name architectural layers once and reference them from rule
file lists with `layer:<name>`; `scope` stays glob-only. The validator expands
each reference before evaluation, and the policy digest covers the document
as written, so a policy without `layers` keeps its digest.

```json
{
  "layers": {
    "ui": ["src/app/**/page.tsx", "src/app/**/layout.tsx"],
    "persistence": ["src/persistence/**/*.ts"]
  },
  "rules": [{
    "id": "ui-does-not-import-persistence",
    "title": "UI routes use application services",
    "level": "error",
    "check": { "kind": "forbid-import-edge", "from": ["layer:ui"], "deny": ["module:@prisma/client"] },
    "remediation": "Move persistence access behind a server application service."
  }]
}
```

A reference to an undeclared layer, a non-slug name, or a reference inside
`scope` fails policy parsing with exit `2`.

## Required call arguments

`require-call-argument` proves that every call whose resolved callee matches
a glob carries a dotted path in one argument, so a tenant identifier cannot be
dropped from a query selector. Proof is static: an object literal, an
`Object.freeze` of one, or a same-file `const` bound to one, with no opaque
spread or computed key on the path. Anything the validator cannot prove is
`CALL_ARGUMENT_PROOF_FAILED`; a provable selector without the path is
`CALL_ARGUMENT_MISSING`.

```json
{
  "id": "tenant-queries-carry-workspace",
  "title": "Tenant queries carry the workspace identifier",
  "level": "error",
  "check": {
    "kind": "require-call-argument",
    "files": ["layer:persistence"],
    "callee": ["*.findFirst", "*.findMany", "*.updateMany", "*.deleteMany", "*.count"],
    "requiredPath": "where.workspaceId",
    "allowFrom": ["src/persistence/audit.ts"]
  },
  "remediation": "Put workspaceId in the where selector of every tenant-scoped query."
}
```

## Governed state transitions

`restrict-state-transition` proves that a state field is written only from
its allowed writer files and, when `transitions` are listed, only through a
listed `from -> to` pair, read from the literal `where` predicate and the
literal written value. A write outside `allowFrom` or through an unlisted
pair is `STATE_TRANSITION_DENIED`; a write the validator cannot prove (a
spread, a value built elsewhere, a predicate without the field) is
`STATE_TRANSITION_PROOF_FAILED`. Calls that do not write the field are
ignored.

```json
{
  "id": "policy-revision-state-is-governed",
  "title": "Policy revision state changes only through the governed lifecycle",
  "level": "error",
  "check": {
    "kind": "restrict-state-transition",
    "callee": ["*.policyRevision.updateMany"],
    "field": "data.state",
    "allowFrom": ["src/persistence/policies.ts"],
    "transitions": [
      { "from": "draft", "to": "approved" },
      { "from": "approved", "to": "active" },
      { "from": "active", "to": "superseded" }
    ]
  },
  "remediation": "Change revision state only from policies.ts through a listed transition."
}
```

## Explain and init

```text
kernel-zero explain --policy kernel-zero.policy.json
kernel-zero explain --evidence .kernel-zero/evidence.json
kernel-zero init [--root <dir>] [--workspace <uuid>]
```

`explain` strictly parses one artifact and renders rules or findings with their
remediation; it reads no source and makes no network calls. `init` scaffolds
`kernel-zero.policy.json`, `.githooks/pre-commit`, and
`.github/workflows/kernel-zero.yml` into an empty spot, refuses to overwrite any
existing file, and prints the AGENTS/CLAUDE snippet, the `validator:self`
script, and the exact validator version to install. It never edits
`package.json`, agent instructions, git configuration, or branch protection.

Validation reads contained TypeScript and TSX files, writes normalized evidence,
and performs no network requests or source upload.

## License

KERNEL ZERO is distributed under the MIT License. Bundled third-party notices
are in `THIRD_PARTY_NOTICES.md`.
