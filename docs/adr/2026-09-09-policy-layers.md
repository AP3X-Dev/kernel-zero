# Named layers in the repository policy

## Context

`kernel-zero.policy.json` repeats the same glob lists across rules: the UI
pages, the transport routes, the server modules, the kernel packages, and the
validator each appear verbatim in one or more `from` and `files` lists. A
consumer policy that wants to say "a given function cannot be called from
named architectural layers" (PRP `docs/prp/2026-09-09-validator-rule-language.md`,
sentence 5) has no way to name a layer once, so every rule restates the
paths and the rules drift apart when a path moves.

The policy schema lives in `packages/profile-software-architecture/src/policy.ts`;
the validator engine (`packages/validator/src/engine.ts`) and every evaluator
match file paths against globs only. The policy digest is
`canonicalSha256` of the schema-parsed document (`packages/validator/src/runner.ts`),
so any schema default that adds a key to the parsed document moves the digest
of every existing policy.

## Decision

Add one policy-level concept, named layers, expanded by the profile before
the engine sees the policy. The engine and evaluators stay glob-only.

- `RepositoryPolicySchema` gains `layers`, an `exactOptional` record of at
  most 50 slug names (`LayerNameSchema = SlugSchema(2, 40)`) to glob lists of
  1 to 100 entries. A layer value is a glob list only; a `layer:` entry inside a
  layer value is rejected by the value schema (nesting is deferred, PRP section 9).
  `exactOptional` keeps an absent key absent in the parsed document, so a
  policy without `layers` parses to the same object and keeps its digest.
- The rule fields that name files (`from`, `files`, `allowFrom`,
  `declarationFiles`) use the `RuleGlobList` / `OptionalRuleGlobList` aliases
  (same element schema as before) and may carry `layer:<name>` entries.
  `scope.include` and `scope.exclude` keep the glob-only `GlobList` /
  `OptionalGlobList`.
- One policy-level `superRefine` is the whole enforcement, with three message
  shapes: `Layer reference is not a slug: <entry>`,
  `Layer reference is not allowed in scope: <entry>`, and
  `Layer is not declared: <name> (rule <id>, field <field>)`. Absent `layers`
  plus any rule reference is therefore a schema error (validator exit 2,
  "Policy input does not satisfy the public contract").
- `packages/profile-software-architecture/src/layers.ts` (new) exports
  `LAYER_REFERENCE_PREFIX`, `isLayerReference`, `ruleFileLists`, and
  `resolvePolicyLayers`. Expansion replaces each reference with the layer's
  globs in declaration order, de-duplicates while keeping the first occurrence,
  and returns a frozen policy; it is idempotent and leaves `layers`, `scope`,
  and rule identity untouched. Field discovery is by name on the check object,
  so a future kind that reuses those field names inherits layers. A reference
  the schema did not see throws (fail closed) rather than expanding to nothing.
- `packages/validator/src/runner.ts` computes the digest over the parsed,
  unexpanded document exactly as before and passes
  `resolvePolicyLayers(policy)` to `evaluatePolicyChecks`. `explain` and the
  returned `policy` keep the unexpanded document.
- `evaluatePolicyChecks` throws `RepositoryProgramError("Policy layers must be
  resolved before evaluation.")` if any rule file list still holds a
  reference. That is a programming-error guard, not a finding.
- `findingCompatibilityReason` resolves layers on entry. `diffRules` does not
  expand, so a layer edit diffs as a rule change.
- The self-policy declares six layers (`ui`, `transport`, `service`,
  `persistence`, `kernel`, `validator`) and rewrites
  `ui-does-not-import-persistence`, `transport-does-not-import-repositories`,
  `server-modules-declare-boundary`, `kernel-does-not-import-profiles`, and
  `validator-stays-network-and-database-free` to reference them.
  `raw-database-client-is-contained` keeps its explicit globs because its
  `from` spans apps and three packages with no matching layer. The seventh
  layer `profiles` from the original FR-LAY-005 is dropped: no rule names
  profile files, and PRP section 2 item 4 forbids shipping unexercised policy.

This is `kz-policy-rule` branch A for the self-policy rewrite (existing kinds,
new references) on top of a schema addition; no new check kind, no engine
dispatch change, no new message code.

## Invariants touched

1. Definite policy violations fail closed. A malformed, undeclared, or
   misplaced reference is a schema error (exit 2); a reference that reaches
   expansion unchecked throws; a reference that reaches the engine throws.
   Proof: `policy.test.ts` (three exact messages, 51 layers rejected),
   `layers.test.ts` (undeclared reference throws), `engine.test.ts` (guard).
6. UI and transport routes never import persistence or Prisma. The two rules
   now reference `layer:ui` and `layer:transport`. Proof: the bite proof below
   (a probe route importing `@kernel-zero/persistence` produced one
   `transport-does-not-import-repositories` finding).
8. Server modules import `server-only`. `server-modules-declare-boundary` now
   reads `files: ["layer:service", "layer:persistence"]`. Proof: the bite proof
   below (a probe server module without the import produced one
   `server-modules-declare-boundary` finding).
10. Local validation is deterministic and network-free. Expansion is a pure
    function of the parsed document; `npm run validator:self` twice produced
    the same `integrity.digest`.
11. Public wire formats are versioned and digests are over document content.
    The digest still covers the parsed, unexpanded document; no default was
    added; a layer-free policy is byte-identical. See Contract impact.
12. Kernel packages never import a profile. Unchanged:
    `git diff --stat -- packages/domain packages/contracts packages/persistence`
    is empty; the validator (not a kernel package) already imported the
    profile and now also imports `resolvePolicyLayers`, `isLayerReference`,
    and `ruleFileLists` from it.

Invariants 2, 4, 5, 7, and 9 are unaffected: no control-plane change, no new
tenant selector, no governed action, no new ingress, no publication.

## Contract impact

Policy `kernel-zero.dev/v1`: additive. `layers` is optional with no default
and the rule glob lists accept the same strings as before (`layer:x` was
already syntactically a contained relative glob). Every stored layer-free
policy parses to the same object and keeps its digest; every finding
fingerprint under it is unchanged. Subjects never contain layer names.
`docs/contracts/repository-policy-v1.schema.json` and
`docs/contracts/README.md` regenerated (`layers` in the schema; one paragraph
under "RepositoryPolicy v1").

Evidence `kernel-zero.dev/evidence/v1`: unchanged. No message code or string
changed, so every stored run still re-validates. Exception bundles: unchanged.

Golden fixture `packages/validator/fixtures/golden/**`: byte-identical
(`git diff --stat -- packages/validator/fixtures/golden` empty);
`golden.test.ts` now also pins `filesScanned === 12` and the fixture's
`manifestDigest`.

Self-policy digests (the document changed, so both moved):

| | before | after |
| --- | --- | --- |
| `policy.digest` | `sha256:006a0a332433797dac544fd3b42c6f11d87f8c28e625611aed17c2d39419dec2` | `sha256:b9191f8b8f71e78ab39d221b44a8af37635bab55c8999aedb879a99e35c424d9` |
| `integrity.digest` | `sha256:435c3f708ebb44571c674ad6ab6f3f8abc1a32bd10d8d27846b3f399e9ed3bb8` | `sha256:3cf09d734a23a4470eb4bf3a238ec4a9782146df73c9cc3cb10be690a1bcc824` |

The integrity digest also reflects the manifest gaining one source file
(`packages/profile-software-architecture/src/layers.ts`, 91 to 92 files).

## FR-IDs

FR-LAY-001 (schema), FR-LAY-002 (references in every file-naming field, schema
error on undeclared), FR-LAY-003 (expansion in the profile after the digest,
engine glob-only), FR-LAY-004 (subjects and fingerprints unchanged,
compatibility runs on the expanded policy), FR-LAY-005 (self-policy uses six
layers; `profiles` dropped as amended in the PRP).

## Verification command

Node 22 (`export PATH="/c/Users/Guerr/AppData/Roaming/fnm/node-versions/v22.22.3/installation:$PATH"`).

```text
npx vitest run packages/profile-software-architecture
  Test Files  6 passed (6)
       Tests  85 passed (85)

npm run test:validator
  Test Files  9 passed (9)
       Tests  72 passed (72)

npm run validator:self   (run 1)
  kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 92 files)
  integrity.digest sha256:3cf09d734a23a4470eb4bf3a238ec4a9782146df73c9cc3cb10be690a1bcc824
npm run validator:self   (run 2)
  kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 92 files)
  integrity.digest sha256:3cf09d734a23a4470eb4bf3a238ec4a9782146df73c9cc3cb10be690a1bcc824

npm run contracts:generate && npm run contracts:check   exit 0
git diff --stat -- packages/validator/fixtures/golden   (empty)
npm run typecheck   exit 0
npm run lint        exit 0
```

Bite proof (probe files created, validated, deleted):

```text
apps/control/src/app/api/kz-probe/route.ts   import "@kernel-zero/persistence";
apps/control/src/server/kz-probe.ts          (no server-only import)

kernel-zero: fail (2 errors, 0 warnings, 0 excepted, 94 files)
error server-modules-declare-boundary apps/control/src/server/kz-probe.ts:1:1 REQUIRED_IMPORT_MISSING file
error transport-does-not-import-repositories apps/control/src/app/api/kz-probe/route.ts:1:1 DENIED_IMPORT @kernel-zero/persistence
exit 1

(after deleting both probes)
kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 92 files)
exit 0
```

`npm run verify` on this tree: exit 0.

```text
kernel-zero: pass (0 errors, 0 warnings, 0 excepted, 92 files)
unit         Test Files 46 passed (46)   Tests 287 passed (287)
architecture Test Files 1 passed (1)     Tests 1 passed (1)
integration  Test Files 3 passed (3)     Tests 7 passed (7)
```

## Addendum (2026-09-09, final checker finding): sentence 5 dogfood rule

The PRP claimed sentence 5 ("a function cannot be called from named layers") was
already covered by a `restrict-call-site` rule in the self-policy. No such rule
existed. Rule `runtime-opens-at-the-boundary` was added: `getRuntime` may be
called only from `layer:transport` and `apps/control/src/app/app/route-context.ts`,
so services and views receive the runtime rather than opening it.

- Bite proof: a probe `export function probeRuntime() { return getRuntime(); }`
  appended to `apps/control/src/server/policy/policy-service.ts` produced
  `kernel-zero: fail (1 errors, 0 warnings, 0 excepted, 96 files)` /
  `error runtime-opens-at-the-boundary apps/control/src/server/policy/policy-service.ts:76:41 RESTRICTED_CALL getRuntime`, exit 1; restored from a byte copy, exit 0.
- Self-policy integrity digest: `sha256:b28247eb5fc05949c27daf27a042a17321218ba3eb0cf0160dd5a0ba9f39af37` before, `sha256:f7010c9acca6e98fabaa77e35952f5972d8d82208d2269020f4ad68ecfbe6998` after, identical on two runs; 17 rules.
- Contract impact: none (existing kind, existing codes). FR-IDs: FR-LAY-005, FR-DOG-001.
