<p align="center">
  <img src="docs/assets/kernel-zero.png" alt="KERNEL ZERO" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/AP3X-Dev/KERNEL-ZERO/actions/workflows/kernel-zero.yml"><img src="https://github.com/AP3X-Dev/KERNEL-ZERO/actions/workflows/kernel-zero.yml/badge.svg" alt="Kernel Zero build status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-informational" alt="MIT licensed" /></a>
  <img src="https://img.shields.io/badge/node-22-informational" alt="Node 22" />
  <a href="https://www.npmjs.com/package/@kernel-zero/validator"><img src="https://img.shields.io/npm/v/@kernel-zero/validator" alt="npm validator version" /></a>
</p>

# KERNEL ZERO

KERNEL ZERO is a policy-first governance kernel and control plane. Rules become
versioned policy artifacts that deterministic validators enforce in development
and protected CI, with a tamper-evident record of what they found.

Profiles apply that kernel to TypeScript architecture, Python architecture,
package manifests, and GitHub Actions workflows. They share policy revisions,
controlled exceptions, audit records, and tamper-evident verification evidence.
For coding agents, findings and policy remediation form a correction loop:
edit, validate, repair, and validate again before the protected CI check passes.

The monorepo contains a TypeScript kernel and single-operator control console,
profile packages, and standalone validators. TypeScript analysis uses the
TypeScript compiler API; Python analysis uses a bundled CPython AST analyzer
script with a locally installed interpreter. Additional profiles reuse the
kernel without creating separate products or control planes.

## How it works

1. **Policy** is a JSON document, not code. It declares rules such as "nothing
   under `apps/**` may import the persistence package". It cannot execute.
2. **The validators** are network-free CLIs. Each profile checks the relevant
   source, manifests, or workflow files and writes **evidence**: normalized
   findings, never source. Exit 0 passes, 1 reports definite violations, and 2
   means validation could not complete safely. Both nonzero outcomes block.
3. **The control plane** stores policies and their revisions, ingests evidence
   runs over a token-protected API, and grants exceptions that expire. Every
   record is fingerprinted, so an altered one stops verifying. It is a local
   single-operator console: there is no sign-in, and one configured workspace
   identifier scopes every stored row.
4. **The gate** is CI. A local hook gives fast feedback; the protected branch
   check is what actually blocks a merge.

## Local start

Requirements: Node 22 and npm 10 or newer. PostgreSQL is needed to run the
control application; the test suites start their own database. Python validation
requires local CPython 3.11–3.14, with no third-party Python packages. Set
`KERNEL_ZERO_PYTHON` to an interpreter path if automatic discovery is unsuitable.

```text
npm ci
npm run prisma:generate
npx prisma migrate deploy --schema packages/persistence/prisma/schema.prisma
npm run dev
```

Copy `.env.example` to `.env` and replace the evidence token before exposing
the API beyond your machine. The application is served at
`http://127.0.0.1:3000` by default. The control plane accepts evidence at
`POST /api/evidence/v1/runs` with
`Authorization: Bearer $KERNEL_ZERO_EVIDENCE_TOKEN` when a submitter is configured.
The current GitHub Actions workflow validates locally and uploads
`.kernel-zero/evidence.json` as the `kernel-zero-evidence` Actions artifact;
it does not POST evidence to the control plane.

## Deterministic enforcement

```text
npm run validator:self       # this repository against its own policy
npm run validator:manifest   # licenses and dependency pinning
npm run validator:python     # Python architecture profile fixture
npm run validator:workflow   # workflow hygiene profile
npm run verify              # the full local gate; exit 0 is the only pass
```

Repository validation writes `.kernel-zero/evidence.json`; the other runners
write `manifest-evidence.json`, `python-evidence.json`, and
`workflow-evidence.json` in the same directory. Two runs with unchanged inputs
produce the same integrity digest, because run identity and timing are excluded
from it. The validators never upload repository source.

The current `verify` script and CI run repository, workflow, and Python checks;
manifest validation is a separate command. CI also checks that `verify` is a
required check on `main`, and runs build, package, and browser checks beyond the
local `verify` script.

## Agent correction loop

KERNEL ZERO gives a coding agent an explicit policy to follow and structured
feedback to repair its work:

1. **Read the contract.** The npm package includes versioned schemas, examples,
   and malformed fixtures under `contracts`. `kernel-zero explain --policy
   kernel-zero.policy.json` renders the rules and their remediation.
2. **Edit and validate.** The coding host can run validation after edits or at
   a stop hook. Repository validation prints finding locations, codes, subjects,
   and policy remediation alongside the authoritative JSON evidence.
3. **Correct and repeat.** The agent uses the findings, or
   `kernel-zero explain --evidence .kernel-zero/evidence.json`, to repair the
   change and rerun validation. A nonzero exit keeps the operation blocked.
4. **Verify independently.** This repository's builder skills hand off to
   `kz-checker`, which reruns the full gate and checks digest repeatability.
   A protected CI check gates merge; the agent's completion claim is not proof.

Version 0.3.0 goes beyond import boundaries: named layers keep policies readable,
and checks can require a workspace identifier in query arguments, restrict state
transitions, and prove that handler input passes through a declared parser
before escaping. Findings identify missing requirements and failed static proofs.

The coding host owns the correction cycle and any isolated workers; the web
control plane does not run agents or repository code. Local hooks can be bypassed.
For untrusted contributors, the host or maintainer must control the policy,
validator, hook configuration, workflow, and required-check settings. See
[validator and hook setup](docs/validator-and-hooks.md) for the enforcement model.

## Adopting it in another repository

The published [@kernel-zero/validator package](https://www.npmjs.com/package/@kernel-zero/validator)
ships four binaries in version 0.3.0: `kernel-zero`, `kernel-zero-manifest`,
`kernel-zero-python`, and `kernel-zero-workflow`. Consumers need no access to
this monorepo; Python checks additionally need the local interpreter described
above. There is no public JavaScript library API.

```text
npm install --save-dev @kernel-zero/validator
```

Run `npx kernel-zero init` to scaffold a policy, pre-commit hook, and CI workflow
without overwriting existing files. It prints the `validator:self` script and
agent guidance for you to add; it does not edit `package.json`, agent instructions,
Git configuration, or branch protection. The
[package README](packages/validator/README.md) carries the commands for all four
binaries, and [hook setup](docs/validator-and-hooks.md) explains making the check
required and protecting the workflow, policy, and validator from the
contributors being judged. Maintainers can run `npm run validator:package:check`
to build, pack, install, and exercise the exact consumer artifact before a
release.

## Profiles

The kernel parses only policy and evidence envelopes. A profile owns the full
policy schema, the evidence schema, finding compatibility, and rule diffing, and
is statically registered and bundled through `packages/profiles`. At runtime,
the application resolves a registered profile by policy kind to parse and handle
its documents. Profiles are not dynamically loaded plugins, and the control
plane does not run their repository analyzers.

| Policy kind        | Evidence kind        | Tool                   | Governs                                    | Package                                 |
| ------------------ | -------------------- | ---------------------- | ------------------------------------------ | --------------------------------------- |
| `RepositoryPolicy` | `RepositoryEvidence` | `kernel-zero`          | TypeScript architecture and semantic checks | `packages/profile-software-architecture` |
| `ManifestPolicy`   | `ManifestEvidence`   | `kernel-zero-manifest` | Licenses and pinned dependencies           | `packages/profile-manifest`              |
| `PythonPolicy`     | `PythonEvidence`     | `kernel-zero-python`   | Python imports, calls, context parameters   | `packages/profile-python`                |
| `WorkflowPolicy`   | `WorkflowEvidence`   | `kernel-zero-workflow` | GitHub Actions pinning, permissions         | `packages/profile-workflow`              |

To add a profile: create `packages/profile-<name>` exporting a `Profile`, add it
to `PROFILES`, and allow it in `scripts/check-architecture.mjs`. Kernel packages
may not import it; the self-policy rule `kernel-does-not-import-profiles`
enforces that. Adding one must leave `packages/domain`, `packages/contracts`, and
`packages/persistence` untouched.

## Project boundaries

- The web application is a control plane; it does not execute repository code.
- Local validation is deterministic and network-free.
- Definite policy violations fail closed. Optional external context must not be
  treated as the policy authority.
- Local hooks improve feedback; protected CI is the merge gate.
- External publication, pull-request creation, merge, deployment, and production
  credential use require separate human approval.

## Engineering skills

Project skills live in `.claude/skills`: `kz-grill` (design interview, run
first), `kz-governed-action`, `kz-policy-rule`, `kz-profile`, `kz-adopt`. After
`kz-governed-action`, `kz-policy-rule`, or `kz-profile` reports done, run the
`kz-checker` agent in `.claude/agents`. Engineering rules for the repository are
in `CLAUDE.md`; design decisions are recorded in `docs/adr`.

## License

KERNEL ZERO is available under the [MIT License](LICENSE).
