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
protected operation.

Validation reads contained TypeScript and TSX files, writes normalized evidence,
and performs no network requests or source upload.

## License

KERNEL ZERO is distributed under the MIT License. Bundled third-party notices
are in `THIRD_PARTY_NOTICES.md`.
