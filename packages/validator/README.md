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
