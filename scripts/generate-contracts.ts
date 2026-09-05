import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { canonicalJson, type Sha256Digest } from "@kernel-zero/domain";
import {
  EXCEPTION_GRANT_SET_MEDIA_TYPE,
  EVIDENCE_MEDIA_TYPE,
  POLICY_APPROVAL_MEDIA_TYPE,
  POLICY_CUSTODY_EVIDENCE_MEDIA_TYPE,
  PolicyApprovalSchema,
  PolicyCustodyEvidenceSchema,
  WORKSPACE_TRUST_BUNDLE_MEDIA_TYPE,
  WorkspaceTrustBundleSchema,
  canonicalEvidenceDigest,
  custodyMessages,
  deriveEvidenceSummary,
  exceptionGrantSetJsonSchema,
  findingIdentity,
  policyApprovalJsonSchema,
  policyCustodyEvidenceJsonSchema,
  workspaceTrustBundleJsonSchema,
} from "@kernel-zero/contracts";
import { canonicalSha256 } from "@kernel-zero/domain";
import {
  REPOSITORY_POLICY_MEDIA_TYPE,
  findingMessage,
  softwareArchitectureProfile,
} from "@kernel-zero/profile-software-architecture";
import { manifestMessages, manifestProfile } from "@kernel-zero/profile-manifest";
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

const custodyPolicy = { digest: digest("1"), kind: "RepositoryPolicy", name: "service-boundaries", revision: 1 };
const policyApprovalExample = {
  apiVersion: "kernel-zero.dev/custody/v1", kind: "PolicyApproval",
  workspace: "0195f000-0000-7000-8000-000000000002", policy: custodyPolicy,
  approvalId: "0195f000-0000-7000-8000-000000000012", authorId: "0195f000-0000-7000-8000-000000000010", approverId: "0195f000-0000-7000-8000-000000000011",
  approvedAt: "2026-01-15T12:00:00.000Z",
  integrity: { algorithm: "sha256", digest: digest("3") },
  signature: { algorithm: "ed25519", keyId: "workspace-authority-1", value: Buffer.alloc(64).toString("base64") },
};
const workspaceTrustBundleExample = {
  apiVersion: "kernel-zero.dev/custody/v1", kind: "WorkspaceTrustBundle",
  workspace: "0195f000-0000-7000-8000-000000000002", revision: 1,
  keys: [{ keyId: "workspace-authority-1", kty: "OKP", crv: "Ed25519", x: "A".repeat(43), validFrom: "2026-01-01T00:00:00.000Z", validUntil: null, revokedFrom: null }],
  integrity: { algorithm: "sha256", digest: digest("5") },
};
const custodyEvidenceBase = {
  apiVersion: "kernel-zero.dev/custody/v1" as const, kind: "PolicyCustodyEvidence" as const,
  workspace: "0195f000-0000-7000-8000-000000000002", policy: custodyPolicy,
  approval: { approvalId: "0195f000-0000-7000-8000-000000000012", digest: digest("3"), approvedAt: "2026-01-15T12:00:00.000Z" },
  trust: { digest: digest("5"), revision: 1, keyId: "workspace-authority-1" },
  tool: { name: "kernel-zero-validator" as const, version: "1.0.0" },
  result: { status: "fail" as const, errors: 1 },
  findings: [{ code: "CUSTODY_AUTHORITY_TIME_INVALID" as const, message: custodyMessages.CUSTODY_AUTHORITY_TIME_INVALID, subject: "authority:workspace-authority-1" }],
};
const policyCustodyEvidenceExample = { ...custodyEvidenceBase, integrity: { algorithm: "sha256" as const, digest: canonicalSha256(custodyEvidenceBase) } };

PolicyApprovalSchema.parse(policyApprovalExample);
WorkspaceTrustBundleSchema.parse(workspaceTrustBundleExample);
PolicyCustodyEvidenceSchema.parse(policyCustodyEvidenceExample);
softwareArchitectureProfile.policySchema.parse(policyExample);
softwareArchitectureProfile.evidenceSchema.parse(evidenceExample);
manifestProfile.policySchema.parse(manifestPolicyExample);
manifestProfile.evidenceSchema.parse(manifestEvidenceExample);
workflowProfile.policySchema.parse(workflowPolicyExample);
workflowProfile.evidenceSchema.parse(workflowEvidenceExample);

const outputs = new Map<string, string>([
  ...PROFILES.flatMap((profile) => [
    [`docs/contracts/${kebabCase(profile.policyKind)}-v1.schema.json`, `${JSON.stringify(profile.policyJsonSchema(), null, 2)}\n`],
    [`docs/contracts/${kebabCase(profile.evidenceKind)}-v1.schema.json`, `${JSON.stringify(profile.evidenceJsonSchema(), null, 2)}\n`],
  ] as const),
  ["docs/contracts/exception-grant-set-v1.schema.json", `${JSON.stringify(exceptionGrantSetJsonSchema(), null, 2)}\n`],
  ["docs/contracts/policy-approval-v1.schema.json", `${JSON.stringify(policyApprovalJsonSchema(), null, 2)}\n`],
  ["docs/contracts/workspace-trust-bundle-v1.schema.json", `${JSON.stringify(workspaceTrustBundleJsonSchema(), null, 2)}\n`],
  ["docs/contracts/policy-custody-evidence-v1.schema.json", `${JSON.stringify(policyCustodyEvidenceJsonSchema(), null, 2)}\n`],
  ["docs/contracts/examples/policy-approval-v1.json", `${canonicalJson(policyApprovalExample)}\n`],
  ["docs/contracts/examples/workspace-trust-bundle-v1.json", `${canonicalJson(workspaceTrustBundleExample)}\n`],
  ["docs/contracts/examples/policy-custody-evidence-v1.json", `${canonicalJson(policyCustodyEvidenceExample)}\n`],
  ["docs/contracts/malformed/policy-approval-unknown-field.json", `${JSON.stringify({ ...policyApprovalExample, privateKey: "must never appear" }, null, 2)}\n`],
  ["docs/contracts/malformed/workspace-trust-bundle-unsorted-keys.json", `${JSON.stringify({ ...workspaceTrustBundleExample, keys: [{ ...workspaceTrustBundleExample.keys[0], keyId: "zeta" }, { ...workspaceTrustBundleExample.keys[0], keyId: "alpha" }] }, null, 2)}\n`],
  ["docs/contracts/malformed/policy-custody-evidence-wall-clock.json", `${JSON.stringify({ ...policyCustodyEvidenceExample, generatedAt: "2026-01-15T12:00:00.000Z" }, null, 2)}\n`],
  ["docs/contracts/examples/repository-policy-v1.json", `${canonicalJson(policyExample)}\n`],
  ["docs/contracts/examples/exception-grant-set-v1.json", `${canonicalJson(exceptionExample)}\n`],
  ["docs/contracts/examples/repository-evidence-v1.json", `${canonicalJson(evidenceExample)}\n`],
  ["docs/contracts/examples/manifest-policy-v1.json", `${canonicalJson(manifestPolicyExample)}\n`],
  ["docs/contracts/examples/manifest-evidence-v1.json", `${canonicalJson(manifestEvidenceExample)}\n`],
  ["docs/contracts/examples/workflow-policy-v1.json", `${canonicalJson(workflowPolicyExample)}\n`],
  ["docs/contracts/examples/workflow-evidence-v1.json", `${canonicalJson(workflowEvidenceExample)}\n`],
  ["docs/contracts/malformed/repository-policy-unknown-field.json", `${JSON.stringify({ ...policyExample, command: "npm test" }, null, 2)}\n`],
  ["docs/contracts/malformed/repository-policy-path-escape.json", `${JSON.stringify({ ...policyExample, scope: { ...policyExample.scope, include: ["../private.ts"] } }, null, 2)}\n`],
  ["docs/contracts/malformed/exception-grant-set-private-data.json", `${JSON.stringify({ ...exceptionExample, rationale: "must never be exported" }, null, 2)}\n`],
  ["docs/contracts/malformed/repository-evidence-source-content.json", `${JSON.stringify({ ...evidenceExample, source: "private source text" }, null, 2)}\n`],
  ["docs/contracts/README.md", `# Public contracts\n\nGenerated by \`npm run contracts:generate\`. Do not hand-edit generated files.\n\n## RepositoryPolicy v1\n\nMedia type: \`${REPOSITORY_POLICY_MEDIA_TYPE}\`\n\nA strict, non-executable repository policy. Unknown fields, unknown check kinds, path escapes, duplicate IDs, arbitrary regular-expression fields, and unsupported languages are rejected. Canonical policy bytes use RFC 8785 before SHA-256.\n\nThe closed check kinds are \`forbid-import-edge\`, \`require-import\`, \`restrict-call-site\`, \`require-export-keys\`, \`require-tenant-parameter\`, \`require-boundary-parse\`, \`require-governed-operation\`, \`require-context-parameter\`, \`require-closed-registry\`, and \`restrict-property-write\`.

\`require-context-parameter\` proves that exported functions matching \`symbols\` take a required \`parameter\` (as a named parameter or a required property of the first object parameter). An optional \`expectedType\` is either an exact intrinsic (\`{ "kind": "intrinsic", "name": "string" }\`) or one exported type (\`{ "kind": "export", "file": "src/auth/context.ts", "exportName": "AuthorizationContext" }\`); exported identity is by symbol, so aliases, derived types, generic instantiations of the type, and intersections match while structural lookalikes do not, and every non-never union member must match. Codes: \`CONTEXT_PARAMETER_INVALID\` (subject \`symbol:<qualifiedName>:parameter:<parameterName>\`) and \`CONTEXT_PARAMETER_PROOF_FAILED\` (the same subject, or \`type:<relative-file>#<exportName>\` when the configured type cannot resolve).\n\n\`require-closed-registry\` proves that one exported registry object (\`registryFile\` plus \`registryExport\`, a direct or exact \`Object.freeze\` object literal) is the only source of declarations made through \`declarationCalls\` inside \`declarationFiles\`. Entry IDs are direct identifier or string keys matching \`[A-Za-z0-9][A-Za-z0-9._/-]{0,119}\`; each entry is a plain object literal carrying every \`requiredKeys\` key; a declaration's first argument is a literal ID that must exist in the registry; registry-only entries are allowed; duplicate declarations, spreads, computed keys, accessors, methods, invalid or duplicate IDs, and unresolved indirection block proof. Codes: \`CLOSED_REGISTRY_ENTRY_INVALID\` (subject \`registry:<export>:entry:<id>:<key>\`, where key is a required key or \`id\`), \`UNREGISTERED_DECLARATION\` (subject \`registry:<export>:declaration:<id>\`), and \`CLOSED_REGISTRY_PROOF_FAILED\` (subject \`registry:<export>:proof:<id>\`, \`registry:<export>:proof:registry\`, or \`registry:<export>:proof:declaration\`). The marker \`<invalid>\` stands for an ID that cannot be rendered safely.\n\n\`restrict-property-write\` proves that one property of one exported type (\`targetType\` as \`{ file, exportName }\` plus \`property\`) is written only from \`allowFrom\` files; an empty \`allowFrom\` permits no writer. Identity is the exact exported type symbol plus its resolved property, never property text alone, and a receiver may be the target through aliases, derived types, intersections, unions that may contain it, generic instantiations, and generics constrained to it. Covered write forms are direct, compound, and logical assignments; increment, decrement, and \`delete\`; literal or compile-time-constant element access; property targets in destructuring assignments; class-field initializers and constructor parameter properties; and object-literal initialization contextually typed, asserted, or satisfied as the target type. Spreads that may author the property, unresolved computed keys on a possible target, and unsafe or unresolved receivers at a direct protected write are proof failures; authorized files are skipped before ambiguity findings. \`Object.assign\`, \`Reflect.set\`, reflective APIs, serialization or ORM update documents, JavaScript, symbol or private properties, escape analysis, value correctness, and transition legality are out of scope. Codes: \`PROPERTY_WRITE_DENIED\` and \`PROPERTY_WRITE_PROOF_FAILED\`, both with subject \`property:<relative-type-file>#<exportName>.<property>\`.\n\n## RepositoryEvidence v1\n\nMedia type: \`${EVIDENCE_MEDIA_TYPE}\`\n\nEvidence contains normalized findings and repository metadata, never source. The required check-specific subject lets ingestion recompute each fingerprint, location-sensitive ID, and closed safe message. Integrity excludes run ID, generation time, diagnostic duration, integrity, and signature.\n\n## ExceptionGrantSet v1\n\nMedia type: \`${EXCEPTION_GRANT_SET_MEDIA_TYPE}\`\n\nBundles contain opaque grant IDs and deterministic matching fields only. Grants are sorted by exception ID. Lifetime is at most 24 hours and never extends a grant. Integrity omits \`integrity\` and \`signature\`; an Ed25519 signature covers the raw 32-byte SHA-256 digest.\n\n## PolicyApproval v1 / WorkspaceTrustBundle v1 / PolicyCustodyEvidence v1\n\nMedia types: \`${POLICY_APPROVAL_MEDIA_TYPE}\`, \`${WORKSPACE_TRUST_BUNDLE_MEDIA_TYPE}\`, \`${POLICY_CUSTODY_EVIDENCE_MEDIA_TYPE}\`. All three are profile-independent kernel contracts under \`kernel-zero.dev/custody/v1\`.\n\nA \`PolicyApproval\` binds one workspace, one policy identity (\`kind\`, \`name\`, \`revision\`, \`digest\`), opaque UUIDv7 approval, author, and approver IDs (author and approver must differ), and a signed \`approvedAt\`. Its integrity digest is RFC 8785 SHA-256 over every field except \`integrity\` and \`signature\`; the Ed25519 signature covers the raw 32-byte digest.\n\nA \`WorkspaceTrustBundle\` is the externally protected trust anchor: one workspace, a monotonic revision, and a unique key-ID-sorted list of strict Ed25519 public JWKs (\`kty\` \`OKP\`, \`crv\` \`Ed25519\`, 32-byte unpadded base64url \`x\`) each with \`validFrom\`, nullable \`validUntil\`, and nullable \`revokedFrom\`. Its integrity covers everything but \`integrity\`. It is not self-authenticating.\n\n\`PolicyCustodyEvidence\` is the deterministic offline proof: workspace, policy identity, approval digest and time, trust-bundle digest, revision, and key ID, tool, result, sorted findings, and integrity. It has no run ID, wall-clock, or exception fields. Authority is judged only at the signed \`approvedAt\`: \`validFrom <= approvedAt\`, \`validUntil\` null or \`approvedAt <= validUntil\`, and \`revokedFrom\` null or \`approvedAt < revokedFrom\`. The closed finding codes are \`CUSTODY_TRUST_INTEGRITY_INVALID\` and \`CUSTODY_WORKSPACE_MISMATCH\` (subject \`workspace:<workspaceId>\`), \`CUSTODY_APPROVAL_INTEGRITY_INVALID\`, \`CUSTODY_MAKER_CHECKER_INVALID\`, and \`CUSTODY_APPROVAL_SIGNATURE_INVALID\` (subject \`approval:<approvalId>\`), \`CUSTODY_POLICY_IDENTITY_MISMATCH\` and \`CUSTODY_POLICY_DIGEST_MISMATCH\` (subject \`policy:<kind>:<name>:<revision>\`), and \`CUSTODY_AUTHORITY_UNTRUSTED\` and \`CUSTODY_AUTHORITY_TIME_INVALID\` (subject \`authority:<keyId>\`). Custody findings are never exception-eligible.\n\n## ManifestPolicy v1 / ManifestEvidence v1\n\nMedia types: \`${REPOSITORY_POLICY_MEDIA_TYPE}\` (policy), \`${EVIDENCE_MEDIA_TYPE}\` (evidence) — the same two constants as RepositoryPolicy and RepositoryEvidence.\n\nThe closed rule kinds are \`allowed-licenses\` and \`pinned-dependencies\`. The closed message codes are \`LICENSE_NOT_ALLOWED\`, \`DEPENDENCY_NOT_PINNED\`, and \`PARSE_FAILURE\`.\n\n## WorkflowPolicy v1 / WorkflowEvidence v1\n\nMedia types: \`${REPOSITORY_POLICY_MEDIA_TYPE}\` (policy), \`${EVIDENCE_MEDIA_TYPE}\` (evidence) — the same two constants as RepositoryPolicy and RepositoryEvidence.\n\nGitHub Actions workflow hygiene. The closed rule kinds are \`pinned-actions\` (mode \`sha\` or \`tag\`) and \`restricted-permissions\` (an \`allowWrite\` scope list). The closed message codes are \`ACTION_NOT_PINNED\` (subject \`action:<owner/repo@ref>\`), \`PERMISSIONS_MISSING\` (subject \`permissions:top-level\`), \`PERMISSION_TOO_BROAD\` (subject \`permissions:<scope>:<value>\`), and \`PARSE_FAILURE\` (subject \`parse\`). Scope is \`include\` globs only, defaulting to \`.github/workflows/*.yml\` and \`.github/workflows/*.yaml\`.\n`],
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
