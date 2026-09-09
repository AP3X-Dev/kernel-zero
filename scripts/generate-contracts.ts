import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { canonicalJson, type Sha256Digest } from "@kernel-zero/domain";
import {
  EXCEPTION_GRANT_SET_MEDIA_TYPE,
  EVIDENCE_MEDIA_TYPE,
  canonicalEvidenceDigest,
  deriveEvidenceSummary,
  exceptionGrantSetJsonSchema,
  findingIdentity,
} from "@kernel-zero/contracts";
import {
  REPOSITORY_POLICY_MEDIA_TYPE,
  findingMessage,
  softwareArchitectureProfile,
} from "@kernel-zero/profile-software-architecture";
import { manifestMessages, manifestProfile } from "@kernel-zero/profile-manifest";
import { pythonMessages, pythonProfile } from "@kernel-zero/profile-python";
import { workflowMessages, workflowProfile } from "@kernel-zero/profile-workflow";
import { PROFILES } from "@kernel-zero/profiles";

const kebabCase = (kind: string): string => kind.replace(/(?<!^)[A-Z]/gu, (letter) => `-${letter}`).toLowerCase();

const digest = (digit: "1" | "3" | "5"): Sha256Digest => `sha256:${digit.repeat(64)}`;
const policyExample = {
  apiVersion: "kernel-zero.dev/v1",
  kind: "RepositoryPolicy",
  metadata: { description: "Repository architecture rules", name: "service-boundaries", revision: 1 },
  scope: { exclude: ["**/*.generated.ts", "**/fixtures/**"], include: ["apps/**/*.ts", "apps/**/*.tsx", "packages/**/*.ts"], languages: ["typescript", "tsx"] },
  rules: [{
    check: { deny: ["module:@kernel-zero/persistence", "module:@prisma/client"], from: ["apps/control/**"], kind: "forbid-import-edge" },
    id: "layers-no-ui-db", level: "error", remediation: "Call an application service through a validated boundary.", title: "UI cannot import persistence",
  }],
};
const exceptionExample = {
  apiVersion: "kernel-zero.dev/exceptions/v1", kind: "ExceptionGrantSet",
  workspace: "0195f000-0000-7000-8000-000000000002", policyDigest: digest("1"),
  generatedAt: "2026-01-15T12:00:00.000Z", expiresAt: "2026-01-16T12:00:00.000Z",
  grants: [{ exceptionId: "0195f000-0000-7000-8000-000000000003", ruleId: "layers-no-ui-db", fingerprint: digest("3"), validUntil: "2026-02-01T00:00:00.000Z" }],
  integrity: { algorithm: "sha256", digest: digest("5") },
  signature: { algorithm: "ed25519", keyId: "workspace-key-id", value: Buffer.alloc(64).toString("base64") },
};
const evidenceLocation = { endColumn: 44, endLine: 8, startColumn: 1, startLine: 8 };
const evidenceFindingIdentity = findingIdentity({
  location: evidenceLocation, messageCode: "DENIED_IMPORT", path: "apps/control/ui/page.tsx",
  policyDigest: digest("1"), ruleId: "layers-no-ui-db", subject: "@prisma/client",
});
const evidenceFinding = {
  ...evidenceFindingIdentity, exceptionId: null, level: "error" as const, location: evidenceLocation,
  message: findingMessage("DENIED_IMPORT"), messageCode: "DENIED_IMPORT" as const,
  path: "apps/control/ui/page.tsx", ruleId: "layers-no-ui-db", subject: "@prisma/client",
};
const evidenceBase = {
  apiVersion: "kernel-zero.dev/evidence/v1" as const, exceptionBundleDigest: null,
  findings: [evidenceFinding], generatedAt: "2026-01-15T12:00:00.000Z",
  kind: "RepositoryEvidence" as const,
  policy: { digest: digest("1"), name: "service-boundaries", revision: 1 },
  result: { ...deriveEvidenceSummary([evidenceFinding], 42), durationMs: 1_250 },
  runId: "0195f000-0000-7000-8000-000000000001", signature: null,
  subject: { manifestDigest: digest("1"), repository: "example/service", revision: "git:0123456789abcdef0123456789abcdef01234567" },
  tool: { name: "kernel-zero-validator" as const, version: "1.0.0" },
  workspace: "0195f000-0000-7000-8000-000000000002",
};
const evidenceExample = { ...evidenceBase, integrity: { algorithm: "sha256" as const, digest: canonicalEvidenceDigest(evidenceBase) } };

const manifestPolicyExample = {
  apiVersion: "kernel-zero.dev/v1",
  kind: "ManifestPolicy",
  metadata: { description: "Manifest license and pin rules", name: "manifest-hygiene", revision: 1 },
  rules: [
    {
      check: { allowed: ["MIT", "Apache-2.0"], kind: "allowed-licenses" },
      id: "allowed-license", level: "error", remediation: "Use an allowed license in package.json.", title: "License must be allowed",
    },
    {
      check: { fields: ["dependencies"], kind: "pinned-dependencies" },
      id: "pinned-dependencies", level: "error", remediation: "Pin dependency versions exactly.", title: "Dependencies must be pinned",
    },
  ],
};
const manifestLocation = { endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 };
const manifestFindingIdentity = findingIdentity({
  location: manifestLocation, messageCode: "LICENSE_NOT_ALLOWED", path: "package.json",
  policyDigest: digest("1"), ruleId: "allowed-license", subject: "license:GPL-3.0",
});
const manifestFinding = {
  ...manifestFindingIdentity, exceptionId: null, level: "error" as const, location: manifestLocation,
  message: manifestMessages.LICENSE_NOT_ALLOWED, messageCode: "LICENSE_NOT_ALLOWED" as const,
  path: "package.json", ruleId: "allowed-license", subject: "license:GPL-3.0",
};
const manifestEvidenceBase = {
  apiVersion: "kernel-zero.dev/evidence/v1" as const, exceptionBundleDigest: null,
  findings: [manifestFinding], generatedAt: "2026-01-15T12:00:00.000Z",
  kind: "ManifestEvidence" as const,
  policy: { digest: digest("1"), name: "manifest-hygiene", revision: 1 },
  result: { ...deriveEvidenceSummary([manifestFinding], 1), durationMs: 40 },
  runId: "0195f000-0000-7000-8000-000000000001", signature: null,
  subject: { manifestDigest: digest("1"), repository: "example/service", revision: "git:0123456789abcdef0123456789abcdef01234567" },
  tool: { name: manifestProfile.toolName, version: "1.0.0" },
  workspace: "0195f000-0000-7000-8000-000000000002",
};
const manifestEvidenceExample = { ...manifestEvidenceBase, integrity: { algorithm: "sha256" as const, digest: canonicalEvidenceDigest(manifestEvidenceBase) } };

const pythonPolicyExample = {
  apiVersion: "kernel-zero.dev/v1",
  kind: "PythonPolicy",
  metadata: { description: "Python architecture boundaries", name: "python-boundaries", revision: 1 },
  scope: { exclude: ["**/tests/**"], include: ["src/**/*.py"] },
  rules: [{
    check: { deny: ["subprocess"], from: ["src/api/**/*.py"], kind: "forbid-import-edge" },
    id: "api-no-processes", level: "error", remediation: "Call the isolated worker boundary.", title: "API cannot launch processes",
  }],
};
const pythonLocation = { endColumn: 18, endLine: 4, startColumn: 1, startLine: 4 };
const pythonFindingIdentity = findingIdentity({
  location: pythonLocation, messageCode: "PYTHON_IMPORT_DENIED", path: "src/api/handler.py",
  policyDigest: digest("1"), ruleId: "api-no-processes", subject: "module:subprocess",
});
const pythonFinding = {
  ...pythonFindingIdentity, exceptionId: null, level: "error" as const, location: pythonLocation,
  message: pythonMessages.PYTHON_IMPORT_DENIED, messageCode: "PYTHON_IMPORT_DENIED" as const,
  path: "src/api/handler.py", ruleId: "api-no-processes", subject: "module:subprocess",
};
const pythonEvidenceBase = {
  apiVersion: "kernel-zero.dev/evidence/v1" as const, exceptionBundleDigest: null,
  findings: [pythonFinding], generatedAt: "2026-01-15T12:00:00.000Z",
  kind: "PythonEvidence" as const,
  policy: { digest: digest("1"), name: "python-boundaries", revision: 1 },
  result: { ...deriveEvidenceSummary([pythonFinding], 3), durationMs: 0 },
  runId: "0195f000-0000-7000-8000-000000000001", signature: null,
  subject: { manifestDigest: digest("1"), repository: "example/python-service", revision: "git:0123456789abcdef0123456789abcdef01234567" },
  tool: { name: pythonProfile.toolName, version: "0.1.0+cpython.3.12.10" },
  workspace: "0195f000-0000-7000-8000-000000000002",
};
const pythonEvidenceExample = { ...pythonEvidenceBase, integrity: { algorithm: "sha256" as const, digest: canonicalEvidenceDigest(pythonEvidenceBase) } };

const workflowPolicyExample = {
  apiVersion: "kernel-zero.dev/v1",
  kind: "WorkflowPolicy",
  metadata: { description: "GitHub Actions workflow hygiene rules", name: "workflow-hygiene", revision: 1 },
  scope: { include: [".github/workflows/*.yml", ".github/workflows/*.yaml"] },
  rules: [
    {
      check: { kind: "pinned-actions", mode: "sha" },
      id: "pinned-actions", level: "error", remediation: "Pin every action reference to a commit sha.", title: "Actions are pinned",
    },
    {
      check: { allowWrite: ["contents"], kind: "restricted-permissions" },
      id: "least-privilege-permissions", level: "error", remediation: "Declare top-level permissions and grant write only where the policy allows it.", title: "Least-privilege permissions",
    },
  ],
};
const workflowLocation = { endColumn: 1, endLine: 9, startColumn: 1, startLine: 9 };
const workflowFindingIdentity = findingIdentity({
  location: workflowLocation, messageCode: "ACTION_NOT_PINNED", path: ".github/workflows/ci.yml",
  policyDigest: digest("1"), ruleId: "pinned-actions", subject: "action:actions/checkout@v4",
});
const workflowFinding = {
  ...workflowFindingIdentity, exceptionId: null, level: "error" as const, location: workflowLocation,
  message: workflowMessages.ACTION_NOT_PINNED, messageCode: "ACTION_NOT_PINNED" as const,
  path: ".github/workflows/ci.yml", ruleId: "pinned-actions", subject: "action:actions/checkout@v4",
};
const workflowEvidenceBase = {
  apiVersion: "kernel-zero.dev/evidence/v1" as const, exceptionBundleDigest: null,
  findings: [workflowFinding], generatedAt: "2026-01-15T12:00:00.000Z",
  kind: "WorkflowEvidence" as const,
  policy: { digest: digest("1"), name: "workflow-hygiene", revision: 1 },
  result: { ...deriveEvidenceSummary([workflowFinding], 1), durationMs: 25 },
  runId: "0195f000-0000-7000-8000-000000000001", signature: null,
  subject: { manifestDigest: digest("1"), repository: "example/service", revision: "git:0123456789abcdef0123456789abcdef01234567" },
  tool: { name: workflowProfile.toolName, version: "1.0.0" },
  workspace: "0195f000-0000-7000-8000-000000000002",
};
const workflowEvidenceExample = { ...workflowEvidenceBase, integrity: { algorithm: "sha256" as const, digest: canonicalEvidenceDigest(workflowEvidenceBase) } };

softwareArchitectureProfile.policySchema.parse(policyExample);
softwareArchitectureProfile.evidenceSchema.parse(evidenceExample);
manifestProfile.policySchema.parse(manifestPolicyExample);
manifestProfile.evidenceSchema.parse(manifestEvidenceExample);
pythonProfile.policySchema.parse(pythonPolicyExample);
pythonProfile.evidenceSchema.parse(pythonEvidenceExample);
workflowProfile.policySchema.parse(workflowPolicyExample);
workflowProfile.evidenceSchema.parse(workflowEvidenceExample);

const outputs = new Map<string, string>([
  ...PROFILES.flatMap((profile) => [
    [`docs/contracts/${kebabCase(profile.policyKind)}-v1.schema.json`, `${JSON.stringify(profile.policyJsonSchema(), null, 2)}\n`],
    [`docs/contracts/${kebabCase(profile.evidenceKind)}-v1.schema.json`, `${JSON.stringify(profile.evidenceJsonSchema(), null, 2)}\n`],
  ] as const),
  ["docs/contracts/exception-grant-set-v1.schema.json", `${JSON.stringify(exceptionGrantSetJsonSchema(), null, 2)}\n`],
  ["docs/contracts/examples/repository-policy-v1.json", `${canonicalJson(policyExample)}\n`],
  ["docs/contracts/examples/exception-grant-set-v1.json", `${canonicalJson(exceptionExample)}\n`],
  ["docs/contracts/examples/repository-evidence-v1.json", `${canonicalJson(evidenceExample)}\n`],
  ["docs/contracts/examples/manifest-policy-v1.json", `${canonicalJson(manifestPolicyExample)}\n`],
  ["docs/contracts/examples/manifest-evidence-v1.json", `${canonicalJson(manifestEvidenceExample)}\n`],
  ["docs/contracts/examples/python-policy-v1.json", `${canonicalJson(pythonPolicyExample)}\n`],
  ["docs/contracts/examples/python-evidence-v1.json", `${canonicalJson(pythonEvidenceExample)}\n`],
  ["docs/contracts/malformed/python-policy-unknown-field.json", `${JSON.stringify({ ...pythonPolicyExample, interpreterCommand: "curl example.invalid" }, null, 2)}\n`],
  ["docs/contracts/examples/workflow-policy-v1.json", `${canonicalJson(workflowPolicyExample)}\n`],
  ["docs/contracts/examples/workflow-evidence-v1.json", `${canonicalJson(workflowEvidenceExample)}\n`],
  ["docs/contracts/malformed/repository-policy-unknown-field.json", `${JSON.stringify({ ...policyExample, command: "npm test" }, null, 2)}\n`],
  ["docs/contracts/malformed/repository-policy-path-escape.json", `${JSON.stringify({ ...policyExample, scope: { ...policyExample.scope, include: ["../private.ts"] } }, null, 2)}\n`],
  ["docs/contracts/malformed/exception-grant-set-private-data.json", `${JSON.stringify({ ...exceptionExample, rationale: "must never be exported" }, null, 2)}\n`],
  ["docs/contracts/malformed/repository-evidence-source-content.json", `${JSON.stringify({ ...evidenceExample, source: "private source text" }, null, 2)}\n`],
  ["docs/contracts/python-profile-v1.md", `# PythonPolicy v1 / PythonEvidence v1\n\nMedia types: \`${REPOSITORY_POLICY_MEDIA_TYPE}\` (policy), \`${EVIDENCE_MEDIA_TYPE}\` (evidence).\n\nThe closed rule kinds are \`forbid-import-edge\`, \`require-import\`, \`restrict-call-site\`, and \`require-context-parameter\`. The closed message codes are \`PYTHON_IMPORT_DENIED\`, \`PYTHON_IMPORT_REQUIRED\`, \`PYTHON_CALL_RESTRICTED\`, \`PYTHON_CONTEXT_PARAMETER_REQUIRED\`, and \`PARSE_FAILURE\`. Source is parsed locally by CPython 3.11 through 3.14 using the standard-library AST; dynamic runtime behavior is not claimed.\n`],
  ["docs/contracts/README.md", `# Public contracts\n\nGenerated by \`npm run contracts:generate\`. Do not hand-edit generated files.\n\n## RepositoryPolicy v1\n\nMedia type: \`${REPOSITORY_POLICY_MEDIA_TYPE}\`\n\nA strict, non-executable repository policy. Unknown fields, unknown check kinds, path escapes, duplicate IDs, arbitrary regular-expression fields, and unsupported languages are rejected. Canonical policy bytes use RFC 8785 before SHA-256.\n\nThe closed check kinds are \`forbid-import-edge\`, \`require-import\`, \`restrict-call-site\`, \`require-export-keys\`, \`require-tenant-parameter\`, \`require-boundary-parse\`, \`require-governed-operation\`, \`require-context-parameter\`, \`require-closed-registry\`, \`restrict-property-write\`, \`require-call-argument\`, \`restrict-state-transition\`, and \`require-ingress-parse\`.

\`layers\` is an optional map of at most 50 slug names (2 to 40 characters) to glob lists. Rule fields that name files (\`from\`, \`files\`, \`allowFrom\`, \`declarationFiles\`) may carry \`layer:<name>\` entries beside globs; the profile expands every reference to the layer's globs in declaration order, dropping duplicates and keeping the first occurrence, before the engine evaluates the policy. \`scope.include\` and \`scope.exclude\` accept globs only, and a layer value is a glob list, never another reference. A reference whose name is not a slug, a reference inside \`scope\`, or a reference to an undeclared layer is a schema error (validator exit 2). The policy digest is computed over the parsed document with its references intact, so a policy without \`layers\` keeps its digest byte for byte, and finding subjects and fingerprints never contain layer names.

\`require-context-parameter\` proves that exported functions matching \`symbols\` take a required \`parameter\` (as a named parameter or a required property of the first object parameter). An optional \`expectedType\` is either an exact intrinsic (\`{ "kind": "intrinsic", "name": "string" }\`) or one exported type (\`{ "kind": "export", "file": "src/auth/context.ts", "exportName": "AuthorizationContext" }\`); exported identity is by symbol, so aliases, derived types, generic instantiations of the type, and intersections match while structural lookalikes do not, and every non-never union member must match. Codes: \`CONTEXT_PARAMETER_INVALID\` (subject \`symbol:<qualifiedName>:parameter:<parameterName>\`) and \`CONTEXT_PARAMETER_PROOF_FAILED\` (the same subject, or \`type:<relative-file>#<exportName>\` when the configured type cannot resolve).\n\n\`require-closed-registry\` proves that one exported registry object (\`registryFile\` plus \`registryExport\`, a direct or exact \`Object.freeze\` object literal) is the only source of declarations made through \`declarationCalls\` inside \`declarationFiles\`. Entry IDs are direct identifier or string keys matching \`[A-Za-z0-9][A-Za-z0-9._/-]{0,119}\`; each entry is a plain object literal carrying every \`requiredKeys\` key; a declaration's first argument is a literal ID that must exist in the registry; registry-only entries are allowed; duplicate declarations, spreads, computed keys, accessors, methods, invalid or duplicate IDs, and unresolved indirection block proof. Codes: \`CLOSED_REGISTRY_ENTRY_INVALID\` (subject \`registry:<export>:entry:<id>:<key>\`, where key is a required key or \`id\`), \`UNREGISTERED_DECLARATION\` (subject \`registry:<export>:declaration:<id>\`), and \`CLOSED_REGISTRY_PROOF_FAILED\` (subject \`registry:<export>:proof:<id>\`, \`registry:<export>:proof:registry\`, or \`registry:<export>:proof:declaration\`). The marker \`<invalid>\` stands for an ID that cannot be rendered safely.\n\n\`require-call-argument\` proves that every call in \`files\` (minus \`allowFrom\`) whose resolved callee chain matches one of \`callee\` carries \`requiredPath\` in the argument at index \`argument\` (0 to 9, default 0). A callee glob is dotted identifier segments where \`*\` spans dots (\`*.findMany\`, \`prisma.*.updateMany\`); \`requiredPath\` is 1 to 8 identifier segments (\`where.workspaceId\`). The argument is proven when it is an object literal, an \`Object.freeze\` of one, or an identifier bound by a same-file \`const\` to one; every path segment is a literal or shorthand property; and the leaf is any expression other than the literal \`undefined\` or \`void 0\`. A spread after the key is harmless only when its operand is an object literal, or a conditional whose branches are both object literals, whose own top-level members have no spread, no computed key, and no member with the key's name; spreads before the key are always harmless. Codes: \`CALL_ARGUMENT_MISSING\` when the argument is provable and the path is absent or \`undefined\`, and \`CALL_ARGUMENT_PROOF_FAILED\` when the argument is not a provable literal, an opaque spread or non-literal computed key sits on the path, a const chain cycles, the callee resolves only through a receiver typed \`any\`, \`unknown\`, or possibly \`undefined\`, or (at \`error\` level) a property-access callee cannot be resolved while its root and accessed name both agree with a callee glob. Both use subject \`call:<chain>:argument:<index>:<requiredPath>\`, where \`<chain>\` is the resolved callee chain or, for an unresolved callee, the matching glob itself.\n\n\`restrict-state-transition\` proves that a state field is written only by its allowed writer and only through listed transitions. It inspects every call in scope whose resolved callee chain matches one of \`callee\` (the same glob grammar as \`require-call-argument\`); a call whose argument at index \`argument\` (0 to 9, default 0) provably carries \`field\` (1 to 8 identifier segments, for example \`data.state\`) is a write and must sit in an \`allowFrom\` file, and an empty \`allowFrom\` (the default) permits no writer. When \`transitions\` (default empty) lists pairs \`{ from, to }\`, where \`from\` is an identifier or \`*\` and \`to\` an identifier, every allowed write must carry a string-literal \`field\` value and a string-literal predicate value at \`field\` with its first segment replaced by \`where\` (\`where.state\` for \`data.state\`), and the pair must be listed. A call whose argument does not carry \`field\` is ignored. Codes: \`STATE_TRANSITION_DENIED\` with subject \`transition:<leaf>:<chain>\` for a writer outside \`allowFrom\` or \`transition:<leaf>:<from>-><to>\` for an unlisted pair, and \`STATE_TRANSITION_PROOF_FAILED\` with subject \`transition:<leaf>:<chain>\` when the write cannot be proven (an opaque spread or non-literal computed key on the path, a value built elsewhere, a const chain that cycles, a receiver typed \`any\`, \`unknown\`, or possibly \`undefined\`), when \`transitions\` are listed and the written value or the predicate is not a string literal or the predicate is absent, or (at \`error\` level) when a property-access callee cannot be resolved while its root and accessed name both agree with a callee glob, in which case \`<chain>\` is that glob. \`<leaf>\` is the last segment of \`field\`; the two subject forms never collide because a chain segment cannot contain \`-\`.\n\n\`require-ingress-parse\` proves that every exported function in \`files\` whose export name matches the \`symbols\` glob passes its input through one of \`parserCalls\` before that input escapes. Only a function declaration with a body or a \`const\` bound directly to an arrow or function expression is provable; any other value export shape (a handler built by a factory, a class, a re-export of one) is a proof failure, never a silent skip; type-only exports are not ingresses. Every parameter is untrusted; a single forward pass in source order widens the untrusted set through \`const\`/\`let\` declarations, assignments to locals, one level of destructuring, member and element access, \`await\` and type wrappers, object and array literals, conditionals, \`??\`/\`||\`/\`&&\`, template spans, and the results of \`readerCalls\` (default empty); membership is monotone, so a later trusted assignment never downgrades a binding. Results of \`parserCalls\` and \`allowedCalls\` (default empty) are trusted. A call whose argument or receiver is untrusted must resolve to a \`parserCalls\` entry (which satisfies the rule), a \`readerCalls\` entry, or an \`allowedCalls\` entry. Codes: \`INGRESS_PARSE_MISSING\` (subject \`symbol:<qualifiedName>:parser\`) when the function never passes an untrusted value to a parser and nothing else was reported; \`INGRESS_ESCAPE\` (subject \`symbol:<qualifiedName>:escape:<target>\`) when an untrusted value reaches any other resolved call (\`<target>\` is the callee chain), a \`return\` (\`return\`), a binding declared outside the function (its name), or a nested function that captures it and is not itself an argument to an \`allowedCalls\` call (\`closure\`); and \`INGRESS_PROOF_FAILED\` (subject \`symbol:<qualifiedName>:proof\`) for an export shape the rule cannot see inside, an unresolvable callee receiving untrusted input, any \`for\`, \`while\`, or \`do\` statement, destructuring deeper than one level of an untrusted value, or an untrusted value reaching \`new\`, a tagged template, \`throw\`, \`yield\`, or a property write on anything but a local object. Evaluation of a function stops at its first proof failure. The glob grammar has no alternation, so one rule per exported name family is declared.\n\n\`restrict-property-write\` proves that one property of one exported type (\`targetType\` as \`{ file, exportName }\` plus \`property\`) is written only from \`allowFrom\` files; an empty \`allowFrom\` permits no writer. Identity is the exact exported type symbol plus its resolved property, never property text alone, and a receiver may be the target through aliases, derived types, intersections, unions that may contain it, generic instantiations, and generics constrained to it. Covered write forms are direct, compound, and logical assignments; increment, decrement, and \`delete\`; literal or compile-time-constant element access; property targets in destructuring assignments; class-field initializers and constructor parameter properties; and object-literal initialization contextually typed, asserted, or satisfied as the target type. Spreads that may author the property, unresolved computed keys on a possible target, and unsafe or unresolved receivers at a direct protected write are proof failures; authorized files are skipped before ambiguity findings. \`Object.assign\`, \`Reflect.set\`, reflective APIs, serialization or ORM update documents, JavaScript, symbol or private properties, escape analysis, value correctness, and transition legality are out of scope. Codes: \`PROPERTY_WRITE_DENIED\` and \`PROPERTY_WRITE_PROOF_FAILED\`, both with subject \`property:<relative-type-file>#<exportName>.<property>\`.\n\n## RepositoryEvidence v1\n\nMedia type: \`${EVIDENCE_MEDIA_TYPE}\`\n\nEvidence contains normalized findings and repository metadata, never source. The required check-specific subject lets ingestion recompute each fingerprint, location-sensitive ID, and closed safe message. Integrity excludes run ID, generation time, diagnostic duration, integrity, and signature.\n\n## ExceptionGrantSet v1\n\nMedia type: \`${EXCEPTION_GRANT_SET_MEDIA_TYPE}\`\n\nBundles contain opaque grant IDs and deterministic matching fields only. Grants are sorted by exception ID. Lifetime is at most 24 hours and never extends a grant. Integrity omits \`integrity\` and \`signature\`; an Ed25519 signature covers the raw 32-byte SHA-256 digest.\n\n## ManifestPolicy v1 / ManifestEvidence v1\n\nMedia types: \`${REPOSITORY_POLICY_MEDIA_TYPE}\` (policy), \`${EVIDENCE_MEDIA_TYPE}\` (evidence) — the same two constants as RepositoryPolicy and RepositoryEvidence.\n\nThe closed rule kinds are \`allowed-licenses\` and \`pinned-dependencies\`. The closed message codes are \`LICENSE_NOT_ALLOWED\`, \`DEPENDENCY_NOT_PINNED\`, and \`PARSE_FAILURE\`.\n\n## WorkflowPolicy v1 / WorkflowEvidence v1\n\nMedia types: \`${REPOSITORY_POLICY_MEDIA_TYPE}\` (policy), \`${EVIDENCE_MEDIA_TYPE}\` (evidence) — the same two constants as RepositoryPolicy and RepositoryEvidence.\n\nGitHub Actions workflow hygiene. The closed rule kinds are \`pinned-actions\` (mode \`sha\` or \`tag\`) and \`restricted-permissions\` (an \`allowWrite\` scope list). The closed message codes are \`ACTION_NOT_PINNED\` (subject \`action:<owner/repo@ref>\`), \`PERMISSIONS_MISSING\` (subject \`permissions:top-level\`), \`PERMISSION_TOO_BROAD\` (subject \`permissions:<scope>:<value>\`), and \`PARSE_FAILURE\` (subject \`parse\`). Scope is \`include\` globs only, defaulting to \`.github/workflows/*.yml\` and \`.github/workflows/*.yaml\`.\n`],
]);

const check = process.argv.includes("--check");
const drift: string[] = [];
for (const [relativePath, content] of outputs) {
  const path = resolve(relativePath);
  if (check) {
    let existing = "";
    try { existing = readFileSync(path, "utf8"); } catch { drift.push(relativePath); continue; }
    if (existing !== content) drift.push(relativePath);
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
}
if (drift.length > 0) {
  process.stderr.write(`Generated contract drift: ${drift.join(", ")}\n`);
  process.exitCode = 1;
}
