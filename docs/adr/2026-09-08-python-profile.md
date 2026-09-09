# Add a CPython-backed Python architecture profile

Date: 2026-09-08
Status: accepted

## Context

KERNEL ZERO's repository architecture validator understands TypeScript and TSX.
Manifest and workflow profiles are language-independent, but they cannot judge
Python imports, calls, or function signatures. Consumer teams need Python
enforcement through npm without checking out this monorepo.

An editor-oriented JavaScript grammar was considered. Its own published corpus
results show that it does not parse all current Python syntax, which conflicts
with the requirement for accurate fail-closed enforcement. Python developers
already have a Python runtime, so the standard-library `ast` parser is the
narrower and more accurate dependency.

## Decision

Add a `PythonPolicy` / `PythonEvidence` profile and a
`kernel-zero-python` executable to `@kernel-zero/validator` `0.2.0`.

- **Parser boundary.** A bundled, dependency-free Python adapter reads a
  versioned JSON request from stdin and emits versioned JSON facts to stdout.
  The Node runner owns discovery and source reads, strictly parses the adapter
  output, and passes immutable facts into a pure TypeScript checker.
- **Runtime.** CPython 3.11 through 3.14 is supported. The runner resolves
  `KERNEL_ZERO_PYTHON` when explicitly set, otherwise `python3`, `python`, then
  Windows `py -3`. The exact runtime version is included as semver build metadata
  in the evidence tool version.
- **Scope.** Strict contained include/exclude globs over `.py` files. Discovery
  skips symlinks and `.git`, `.venv`, `venv`, `__pycache__`, `site-packages`,
  `node_modules`, `dist`, and `build` directories.
- **Rule kinds.** `forbid-import-edge`, `require-import`,
  `restrict-call-site`, and `require-context-parameter`. Module matching is exact
  or a dotted descendant. Call resolution covers direct names and attribute
  chains rooted in statically declared import aliases. Context parameters must
  be named, non-variadic, and have no default.
- **Failure behavior.** Syntax failures produce `PARSE_FAILURE` and exit `2`.
  Missing/unsupported Python, malformed protocol, unreadable files, invalid
  policy, or unsafe paths also exit `2`. Definite violations exit `1`; pass exits
  `0`.
- **Evidence.** Evidence contains normalized findings and digests, never source.
  Message codes and subjects are closed and versioned.

### Deliberate ceilings

- No Python type-inference, assignment-alias tracking, reflection, dynamic
  import evaluation, decorator semantics, or monkey-patch analysis is claimed.
- Relative imports are represented with their leading dots because resolving
  them to an absolute package requires an authoritative package root that v1
  does not accept.
- Python 2 and CPython before 3.11 are unsupported.

## Invariants touched

1. Definite Python violations fail closed; claimed syntax failures are errors.
7. Policy, adapter facts, and evidence cross strict schemas before use.
10. Validation is deterministic and network-free; only a local CPython process
    is invoked.
11. `PythonPolicy` and `PythonEvidence` are additive v1 public wire kinds with
    generated schemas and frozen message codes.
12. Python concepts remain in `packages/profile-python`, its runner entry point,
    policy, fixtures, and documentation. Kernel packages do not import them.

Invariants 2 through 6, 8, and 9 are unaffected. This adds no web route,
persistence, tenant selector, governed operation, credential, deployment, or
live publication.

## Public message and subject contract

- `PYTHON_IMPORT_DENIED`, subject `module:<module>`
- `PYTHON_IMPORT_REQUIRED`, subject `module:<module>`
- `PYTHON_CALL_RESTRICTED`, subject `call:<qualified-callee>`
- `PYTHON_CONTEXT_PARAMETER_REQUIRED`, subject
  `symbol:<qualified-name>:parameter:<parameter>`
- `PARSE_FAILURE`, subject `parse`

## FR-IDs

`FR-PY-001` through `FR-PY-012` in the clean-room PRP addendum.

## Human gates

Implementation and local verification are authorized. Commit, push, and live
npm publication remain separate human gates.

## Verification

```text
npm run validator:python
npm run validator:package:check
npm run verify
```

Then run an independent `kz-checker`. Pinned Node 22 and exit `0` are required.
