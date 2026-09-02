# GitHub Actions workflow hygiene profile

Date: 2026-09-02
Status: accepted

## Context

The kernel governs repository architecture (`RepositoryPolicy`) and package
manifests (`ManifestPolicy`). Continuous integration configuration is the third
artifact this repository ships that a reviewer must currently read by hand: an
unpinned action reference or a workflow that grants broad write permissions is a
supply-chain and privilege problem no existing profile can see.

The compile-time profile seam is meant to carry exactly this: a policy schema, an
evidence schema, a pure checker, compatibility, and rule diffing, registered in
`packages/profiles` with no kernel edit. This ADR settles the design before any
code, per `kz-grill`.

## Decision

Add `packages/profile-workflow`, a third profile that judges GitHub Actions
workflow files with policy kind `WorkflowPolicy`, evidence kind
`WorkflowEvidence`, and tool name `kernel-zero-workflow`, registered in `PROFILES`
with no change to `packages/domain`, `packages/contracts`, or
`packages/persistence`.

- **Layer.** A profile package plus scripts (`scripts/run-workflow-validator.ts`)
  and root wiring (`package.json`, CI, `tsconfig.json`,
  `scripts/check-architecture.mjs`). No control-plane, persistence, or validator
  change; the control plane accepts the evidence through the existing generic
  ingress because the profile registry resolves the kind.
- **Scope.** `scope.include` globs, default
  `[".github/workflows/*.yml", ".github/workflows/*.yaml"]`. No `exclude`: a
  repository that wants a workflow unjudged narrows `include`, and a second
  mechanism for the same decision is a second thing to get wrong.
- **Rule kinds (closed).**
  - `pinned-actions` `{ kind, mode: "sha" | "tag" }`. Every step `uses:` of the
    form `owner/repo[/path]@ref` must carry a 40-hex `ref` in `sha` mode, or any
    non-empty `ref` in `tag` mode. `./local` and `docker://` uses are skipped.
  - `restricted-permissions` `{ kind, allowWrite: string[] }`. Every workflow
    must declare top-level `permissions`; `write-all` is always a finding; any
    scope whose value is `write` and which is not listed in `allowWrite` is a
    finding.
- **Message codes (closed).** `ACTION_NOT_PINNED` (subject
  `action:<owner/repo@ref>`), `PERMISSIONS_MISSING` (subject
  `permissions:top-level`), `PERMISSION_TOO_BROAD` (subject
  `permissions:<scope>:<value>`), `PARSE_FAILURE` (subject `parse`).
- **YAML.** `js-yaml` 4.3.2 (already resolved transitively; declared directly by
  the new package, `@types/js-yaml` as a devDependency), parsed with
  `load(text, { schema: DEFAULT_SCHEMA })` into `unknown` and narrowed by a
  `z.looseObject`. js-yaml 4 implements the YAML 1.2 core schema, so the `on:`
  key stays the string `"on"` rather than becoming a boolean. Parsing text is not
  I/O; the runner script owns all file reads, so the checker stays pure.
- **Location.** The finding `path` is the workflow file path relative to the
  repository root with forward slashes. The location is the line of the offending
  `uses:` or top-level `permissions:` when a plain line search finds it, otherwise
  line 1 column 1.
- **Self policy.** `kernel-zero.workflow.policy.json` uses `pinned-actions` in
  `tag` mode and `restricted-permissions` with `allowWrite: []`, both at
  `level: "error"`. This repository's workflow uses `@v4` tags and
  `permissions: contents: read`, so it passes today; moving to `mode: "sha"` is
  the documented upgrade path and is the bite check for the rule.
- **Verification wiring.** `npm run validator:workflow` runs immediately after
  `validator:self` in `verify` and as the CI step after "Validate repository
  policy", because this repository governs its own workflow hygiene.

### Deliberate ceilings

- Docker action digests are not judged. `docker://` uses are skipped entirely;
  the upgrade path is a third `mode` (`docker-digest`) on `pinned-actions`.
- Job-level `permissions:` blocks are not judged, only the top-level block. The
  finding subject has no job segment, so judging job blocks would collide two
  distinct findings onto one fingerprint. The upgrade path is a subject carrying
  the job id, which is a message-code-compatible but fingerprint-breaking change.
- The line search is a plain scan of the raw text, not a YAML source map. A
  `uses:` value that appears on several lines is reported at the first one.

## Invariants touched

Numbered from `.claude/skills/kz-grill/invariants.md`.

1. **Definite violations fail closed** — every rule reports on definite evidence
   from the parsed workflow; an unparseable workflow produces `PARSE_FAILURE`,
   which `deriveEvidenceSummary` turns into status `error` (exit 2), never a pass.
7. **Every public payload is parsed by its strict contract schema** — the runner
   parses the policy file with `WorkflowPolicySchema` and the emitted evidence
   with `WorkflowEvidenceSchema` before writing it. This adds no new control-plane
   ingress: workflow evidence arrives through the existing evidence route, which
   is already covered by rule `public-evidence-is-parsed`. Nothing new ships
   unlinted.
10. **Local validation is deterministic and network-free** — the checker is a
    pure function of file text and policy; `js-yaml` performs no I/O; the runner
    reads local files only and uploads nothing.
11. **Public wire formats are versioned** — the profile publishes
    `kernel-zero.dev/v1` policy and `kernel-zero.dev/evidence/v1` evidence, both
    new kinds. No existing digest composition changes.
12. **Kernel packages never import a profile, and carry no vendor concepts** —
    "GitHub Actions", "workflow", and `kernel-zero-workflow` appear only inside
    `packages/profile-workflow`, the runner script, and the self policy. The
    acceptance test is an empty `git diff --stat` on the three kernel packages.

Invariants 2, 3, 4, 5, 6, 8, and 9 are untouched: no route, no governed action,
no tenant selector, no UI, no server module, no publication or credential use.

## Contract impact

Additive. Two new published schemas
(`docs/contracts/workflow-policy-v1.schema.json`,
`docs/contracts/workflow-evidence-v1.schema.json`) and two new examples. No
existing schema, message code, message string, evidence `subject` key, or digest
composition changes, so every stored artifact still parses and re-validates with
the digest it already has. The four new message codes and their strings are
public contract from this commit forward: changing a code later breaks
fingerprints and orphans exception grants, and changing a string invalidates
re-validation of every stored workflow run.

This is a new profile, not a new rule kind on an existing one, so no engine,
fixture, or benchmark of the architecture validator changes.

## FR-IDs

No FR-ID. `docs/TRACEABILITY.md` carries no functional requirement for continuous
integration hygiene; this profile demonstrates the seam rather than satisfying a
numbered requirement.

## Failure modes

- Unreadable or unparseable workflow file: `PARSE_FAILURE` at subject `parse`,
  summary status `error`, runner exit code 2.
- Missing or schema-invalid policy file: the runner's `WorkflowPolicySchema.parse`
  throws, the top-level handler prints one trimmed line and exits 2.
- No workflow file matches `scope.include`: zero findings, status `pass`, exit 0.
  A repository with no workflows is not a violation.
- Findings present: status `fail`, exit code 1.

## Human gates

None crossed. The change publishes nothing, pushes nothing, deploys nothing,
touches no credential, and opens no outbound network call. `js-yaml` is already
in the lockfile, so no new package is fetched into the tree.

## Verification

    npm run validator:workflow

with `npm run verify` (which now includes it) as the full gate.
