# Add semantic proof obligations and workspace-bound offline policy custody

## Context

KERNEL ZERO currently exposes seven closed `RepositoryPolicy` check kinds. The
software-architecture validator already builds a TypeScript `Program` and
`TypeChecker`, resolves exported functions and calls, proves closed governed
registries, and emits deterministic evidence. Autonomous development needs three
additional structural proof obligations without turning KERNEL ZERO into a
general formal-verification system:

1. required context parameters beyond tenant identifiers;
2. generic closed registries for tools, commands, handlers, and similar
   declaration families; and
3. type-resolved authority over writes to selected properties.

The contributor being checked must also be unable to make a failing change pass
merely by weakening the policy. Existing protected CI and repository ownership
remain the initial custody boundary. The longer-lived design adds an offline
proof that the exact policy was approved by the workspace authority.

The original clean-room PRP predates these additions and explicitly deferred
production signing custody. Before implementation, the human owner must add the
approved contract in this ADR to the gitignored `clean-room/PRP.md`. Until that
addendum is approved, this ADR and its implementation plan authorize design only,
not product-code changes.

## Decision

### Owning layers

- `require-context-parameter`, `require-closed-registry`, and
  `restrict-property-write` are additive `RepositoryPolicy` v1 check kinds owned
  by `packages/profile-software-architecture` and executed by
  `packages/validator`.
- No `SemanticPolicy` profile is created.
- `require-tenant-parameter` and `require-governed-operation` remain first-class
  public kinds with observationally identical behavior. Shared internal helpers
  may not change their schema, defaults, raw or public findings, messages,
  subjects, fingerprints, exception matching, or exit behavior.
- Policy custody is kernel-generic. It is not a repository check or profile. The
  control plane governs approval and signing; the standalone validator performs
  offline verification over explicitly supplied artifacts.

### Failure semantics

For each new error-level semantic rule, both a known violation and inability to
prove the claimed invariant are ordinary blocking findings and produce exit `1`.
Warning-level findings are preserved in evidence but do not block. Exit `2` is
reserved for malformed or unreadable required inputs, discovery/program
construction failure, internal validator failure, and other conditions that
prevent a trustworthy judgment.

Existing `PARSE_FAILURE` behavior is the compatibility exception: current v1
evidence classifies it as status `error` and the CLI returns exit `2`. Changing
that would contradict the requirement that old v1 artifacts and outcomes remain
identical. Reclassifying legacy parse failures requires a separate versioned
contract decision.

### Generic required context parameters

The new strict check shape is:

```json
{
  "kind": "require-context-parameter",
  "files": ["src/**/*.ts"],
  "symbols": "create*",
  "parameter": "actorContext",
  "expectedType": {
    "kind": "export",
    "file": "src/auth/authorization-context.ts",
    "exportName": "AuthorizationContext"
  }
}
```

`expectedType` is optional. When present it is either an exact intrinsic
(`string`, `number`, `boolean`, or `bigint`) or an exported type identified by an
exact contained TypeScript file and export name. The evaluator covers the same
exported function surface as `require-tenant-parameter` and accepts either the
named required parameter or a required property on the first object parameter.

Optional/defaulted declarations, index-signature-only matches, and unsafe
`any`, `unknown`, `undefined`, or `void` types do not satisfy the obligation.
Exported type identity is nominal-by-symbol for this check: aliases, derived
types, matching generic targets, and intersections may preserve identity;
structural lookalikes do not. Every non-`never` union member must satisfy it.

| Public code | Exact message | Subject |
| --- | --- | --- |
| `CONTEXT_PARAMETER_INVALID` | `A required context parameter is missing or has a disallowed declaration.` | `symbol:<qualifiedName>:parameter:<parameterName>` |
| `CONTEXT_PARAMETER_PROOF_FAILED` | `The required context parameter type could not be proven.` | the symbol subject above, or `type:<relative-file>#<exportName>` when the configured type cannot resolve |

### Generic closed registries

The new strict check shape is:

```json
{
  "kind": "require-closed-registry",
  "registryFile": "src/tools/tool-policy.ts",
  "registryExport": "TOOL_POLICY",
  "declarationFiles": ["src/tools/**/*.ts"],
  "declarationCalls": ["defineTool"],
  "requiredKeys": ["classification", "authority", "approval"]
}
```

V1 has exactly one registry file/export. The registry and each entry must be a
direct object literal or exact `Object.freeze({...})`. IDs are direct identifier
or string keys matching `[A-Za-z0-9][A-Za-z0-9._/-]{0,119}`. Required metadata
keys are arbitrary bounded exact strings and must be direct own keys. Spreads,
computed keys, accessors, methods, duplicate/invalid IDs, or unresolved
indirection block proof.

Only configured declaration files and calls are governed. The first call
argument is a literal registry ID. Every declaration must have a registry entry;
duplicate declarations are invalid; reserved registry-only entries are allowed.
Alternate construction mechanisms are outside this primitive and must be
contained with import/call rules.

| Public code | Exact message | Subject grammar |
| --- | --- | --- |
| `CLOSED_REGISTRY_ENTRY_INVALID` | `A closed registry entry is missing required metadata or has an invalid identifier.` | `registry:<export>:entry:<id>:<key>` |
| `UNREGISTERED_DECLARATION` | `A declaration is not present in its required closed registry.` | `registry:<export>:declaration:<id>` |
| `CLOSED_REGISTRY_PROOF_FAILED` | `The closed registry invariant could not be proven from static declarations.` | `registry:<export>:proof:<registry-or-declaration>` |

The marker `<invalid>` represents an ID that cannot be safely rendered.

### Restricted property writes

The new strict check shape is:

```json
{
  "kind": "restrict-property-write",
  "files": ["src/**/*.ts"],
  "targetType": {
    "file": "src/domain/job.ts",
    "exportName": "Job"
  },
  "property": "status",
  "allowFrom": ["src/dataplane/state/**"]
}
```

An empty `allowFrom` permits no writer. Identity is the exact exported type
symbol plus its resolved property symbol, never property text alone. V1 covers:

- direct, compound, and logical assignments;
- prefix/postfix increment and decrement, and `delete`;
- literal or compile-time-constant element access;
- property targets in destructuring assignments;
- class-field initializers and constructor parameter properties;
- object-literal initialization contextually typed, asserted, or satisfied as
  the target type; and
- aliases, derived types, intersections, unions that may contain the target, and
  generic receivers constrained to the target.

Object-literal spreads that may author the protected property, unresolved
computed keys on a possible target, and unsafe/unresolved receivers at a direct
protected write are proof failures. Authorized files are skipped before
ambiguity findings.

V1 explicitly excludes `Object.assign`, `Reflect.set`, proxy/decorator and other
reflective APIs, serialization/ORM update documents, JavaScript, symbol/private
properties, whole-program escape analysis, assigned-value correctness, and
state-transition legality. A helper mutation is judged where its write occurs,
not at each call site.

| Public code | Exact message | Subject |
| --- | --- | --- |
| `PROPERTY_WRITE_DENIED` | `A protected property is written outside its allowed authority boundary.` | `property:<relative-type-file>#<exportName>.<property>` |
| `PROPERTY_WRITE_PROOF_FAILED` | `A protected property write could not be resolved well enough to prove its authority boundary.` | the same property subject |

### Custody contracts and proof order

Custody introduces three strict, profile-independent artifacts under
`kernel-zero.dev/custody/v1`:

- `PolicyApproval`: exact workspace and policy identity, revision/digest,
  opaque approval/author/approver UUIDv7 IDs, signed `approvedAt`, canonical
  integrity, and Ed25519 signature. Author and approver must differ. Integrity
  omits `integrity` and `signature`; the signature covers the raw digest bytes.
- `WorkspaceTrustBundle`: exact workspace, monotonic revision, and a unique
  key-ID-sorted list of strict Ed25519 public JWKs with `validFrom`, nullable
  `validUntil`, and nullable `revokedFrom`. Its integrity covers everything but
  `integrity`. It is the externally protected trust anchor and is not
  self-authenticating in V1.
- `PolicyCustodyEvidence`: deterministic workspace/policy, approval-artifact
  digest/time, trust-bundle digest/revision/key, tool, result, sorted findings,
  and integrity. It has no random or wall-clock fields and no exception support.

Authority is evaluated only at the approval artifact's signed `approvedAt`:

```text
validFrom <= approvedAt
and (validUntil is null or approvedAt <= validUntil)
and (revokedFrom is null or approvedAt < revokedFrom)
```

The CLI adds the all-or-none group `--policy-approval`, `--workspace-trust`, and
`--custody-out`. If these flags are absent, legacy validation remains exact. If
all inputs parse but custody fails, the validator writes failing custody
evidence, returns exit `1`, does not discover/scan source, and does not create or
replace ordinary `--out`. If custody passes, it first writes passing custody
evidence and then emits ordinary unchanged `RepositoryEvidence`. Unreadable or
malformed required inputs return exit `2` and write neither output.

Custody uses these frozen public findings:

| Code | Exact message | Subject family |
| --- | --- | --- |
| `CUSTODY_TRUST_INTEGRITY_INVALID` | `The workspace trust bundle integrity digest does not match its canonical content.` | `workspace:<workspaceId>` |
| `CUSTODY_APPROVAL_INTEGRITY_INVALID` | `The policy approval artifact integrity digest does not match its canonical content.` | `approval:<approvalId>` |
| `CUSTODY_MAKER_CHECKER_INVALID` | `The policy revision author and approver are not distinct.` | `approval:<approvalId>` |
| `CUSTODY_WORKSPACE_MISMATCH` | `The policy approval and trust authority do not match the requested workspace.` | `workspace:<workspaceId>` |
| `CUSTODY_POLICY_IDENTITY_MISMATCH` | `The approved policy identity or revision does not match the supplied policy.` | `policy:<kind>:<name>:<revision>` |
| `CUSTODY_POLICY_DIGEST_MISMATCH` | `The approved policy digest does not match the supplied policy.` | `policy:<kind>:<name>:<revision>` |
| `CUSTODY_AUTHORITY_UNTRUSTED` | `The approval signing authority is not present in the supplied workspace trust bundle.` | `authority:<keyId>` |
| `CUSTODY_AUTHORITY_TIME_INVALID` | `The approval signing authority was not authorized at the signed approval time.` | `authority:<keyId>` |
| `CUSTODY_APPROVAL_SIGNATURE_INVALID` | `The policy approval signature is not valid for the approved artifact.` | `approval:<approvalId>` |

The trust bundle's distribution remains outside the validator. CI orchestration
may obtain it before entering the offline validation boundary, but the validator
performs no network, environment, database, keychain, or repository lookup for
trust. Custody failures are never exception-eligible.

### Control-plane custody

Evidence signing keys and policy-authority keys remain separate trust domains.
Add workspace-scoped `PolicyAuthorityKey` and immutable
`PolicyApprovalArtifact` persistence models; never store private keys or private
key references.

Signing is not an independently callable action. Add one opt-in governed action,
leaving existing `policy.approve` behavior unchanged:

```text
actionId: policy.approve-with-custody
capability: policy.approve
tenantScope: workspace
quota: null
idempotency: idempotent
audit.actionCode: policy.revision-approved-with-custody
audit.description: Policy revision approved with workspace custody.
audit.subjectType: policy-revision
transactionTimeoutMs: 10000
```

`quota: null` is justified because approval consumes no plan-limited resource.
Idempotency is the exact `(workspaceId, revisionId)` pair. A retry returns the
same immutable artifact and never creates a second signature.

The server-only service locks the workspace revision and authority key, proves
draft state and author/approver separation, obtains one database-sourced time,
constructs and signs the canonical payload through an injected local signer,
verifies the returned signature, and atomically persists the revision approval,
artifact, and audit record. Any signing or audit failure rolls back. No remote
signer is allowed. Only fixture/ephemeral signer composition ships; production
signer composition and activation remain unavailable.

Every custody ingress strictly parses before service or cryptographic use and is
covered by deterministic boundary-parse self-policy. Custody server modules
declare `server-only`; pure contracts, canonicalization, digest construction,
and public-key verification stay reusable by the validator.

### Agent ergonomics

- `kernel-zero init` refuses to overwrite existing files, scaffolds the minimal
  policy/hook/workflow assets, and prints the AGENTS/CLAUDE authority text for a
  human to place. It does not silently rewrite existing agent instructions.
- `kernel-zero validate` retains its current command and gains concise,
  deterministic agent-readable findings plus the optional custody inputs.
- `kernel-zero explain` strictly parses policy/evidence artifacts and renders
  stable rule/finding explanation and remediation without source, network, or
  model calls.
- Adoption guidance pins the exact compatible validator version. Unknown new
  kinds on an older validator fail policy parsing with exit `2`; they are never
  ignored.

## Invariants touched

1. **Definite violations fail closed.** New semantic ambiguity is an explicit
   violation/proof-failure finding; malformed execution inputs remain exit `2`.
2. **No control-plane egress or repository content.** Policy authority stores
   and signs metadata only; artifact transport is orchestration-owned.
3. **Maker-checker separation.** Signing eligibility requires a committed
   author/approver distinction and signing is mechanical, not approval.
4. **Exact workspace selectors.** Approval, key, artifact, trust, CLI, and
   persistence workspace IDs must all match.
5. **Closed governed metadata.** The new approval-with-custody action declares
   all six fields; the old governed-operation policy remains unchanged.
6. **UI/transport do not import persistence.** Any custody route parses and
   calls one service; only repositories access custody tables.
7. **Strict public parsing.** All three custody artifacts and every new policy
   shape are strict and their ingresses are self-policy covered.
8. **Server-only boundaries.** Custody services/signers/persistence are
   server-only; offline proof primitives are pure.
9. **Human external gates.** Implementation stops before every external release
   action and every production credential/trust activation.
10. **Deterministic network-free validation.** Approval-time authority depends
    only on supplied bytes; identical inputs produce identical custody results.
11. **Versioned public wire formats.** Semantic kinds extend existing v1
    additively; custody receives `custody/v1`; all new codes/messages/subjects are
    frozen at first release.
12. **Kernel/profile seam.** Custody contains only generic policy identity and
    trust data and introduces no profile import or repository-rule field into a
    kernel package or table.

## Contract impact

This is an additive public-contract change. A new validator accepts every old v1
policy/evidence artifact and must produce byte-identical output for unchanged old
inputs. An old validator is not forward-compatible with the three new kinds and
must reject them as unsupported with exit `2`. Consumers therefore pin the first
compatible validator version exactly.

The new rule kinds, their raw/public codes, messages, subject grammars, severity,
proof behavior, fingerprints, and exception compatibility are frozen by golden
artifact tests. There is no existing-grant migration because old rules cannot
emit the new codes. Existing policy defaults, canonical bytes/digests, evidence
messages/digests, finding identities, and exception matches do not change.

Custody adds new contracts and does not add a field to `RepositoryPolicy`,
`RepositoryEvidence`, or the evidence `subject`. Generated JSON schemas,
examples, malformed examples, and documentation must be regenerated in the same
slice as their source schemas.

## FR-IDs

The PRP addendum must update `FR-POL-002`, `FR-POL-003`, `FR-POL-005`,
`FR-POL-006`; `FR-VAL-001`, `FR-VAL-003`, `FR-VAL-005`, and `FR-VAL-007` through
`FR-VAL-011`; `TM-01`, `TM-08`, `TM-09`; `NFR-PERF-004`; and `SC-001`, `SC-002`,
`SC-007`, and `SC-011`.

Custody requires new `FR-CUS-001` through `FR-CUS-008` for strict contracts,
maker-checker signing, exact binding, offline inputs, deterministic approval-time
authority, separate custody evidence, server/pure boundaries, and external trust
bootstrap/activation gates. Add `TM-19` for custody schema, crypto, tamper,
workspace, timeline, output-order, and exit-code proof.

## Human gates

No implementation slice authorizes publication, push, PR creation, merge,
deployment, production key creation/use, production trust import, policy signing
for a live workspace, branch-protection changes, required-check activation, or
live custody enforcement. Each remains a separate explicit human decision.

## Verification command

Every builder slice ends with its focused tests and then the repository's pinned
Node 22 full gate:

```text
C:\Users\Guerr\AppData\Roaming\fnm\node-versions\v22.22.3\installation\node.exe C:\Users\Guerr\AppData\Roaming\fnm\node-versions\v22.22.3\installation\node_modules\npm\bin\npm-cli.js run verify
```

Exit `0` is the only pass. Each `kz-policy-rule` or `kz-governed-action` builder
slice is followed by the read-only `kz-checker`, which independently reruns the
full gate and validator determinism checks.
