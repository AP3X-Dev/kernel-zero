import { findingIdentity, sortFindings, type EvidenceFinding, type FindingLocation } from "@kernel-zero/contracts";
import type { Sha256Digest } from "@kernel-zero/domain";
import { DEFAULT_SCHEMA, load } from "js-yaml";
import { z } from "zod";

import { workflowMessages, type WorkflowMessageCode } from "./evidence";
import type { WorkflowPolicy, WorkflowRule } from "./policy";

const WHOLE_FILE: FindingLocation = Object.freeze({ endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 });
const COMMIT_SHA = /^[0-9a-f]{40}$/u;

/** The narrow view of a workflow this profile judges; every other key stays untouched. */
const WorkflowDocumentSchema = z.looseObject({
  // ponytail: job-level permissions are read but not judged, because the finding subject has no job
  // segment; the upgrade path is a subject carrying the job id.
  jobs: z.record(z.string(), z.looseObject({
    permissions: z.unknown().optional(),
    steps: z.array(z.looseObject({ uses: z.string().optional() })).optional(),
  })).optional(),
  permissions: z.unknown().optional(),
});

type WorkflowDocument = z.infer<typeof WorkflowDocumentSchema>;

type Violation = Readonly<{ anchors: readonly string[]; messageCode: WorkflowMessageCode; subject: string }>;

export function checkWorkflows(input: Readonly<{
  files: readonly Readonly<{ path: string; text: string }>[];
  policy: WorkflowPolicy;
  policyDigest: Sha256Digest;
}>): readonly EvidenceFinding[] {
  const byIdentity = new Map<string, EvidenceFinding>();
  for (const file of input.files) {
    const document = parseWorkflow(file.text);
    if (document === null) {
      // An unparseable workflow cannot be judged by any rule, so report the parse failure the policy
      // already declares; the kernel summary turns any PARSE_FAILURE into status "error".
      const rule = input.policy.rules.find((candidate) => candidate.level === "error") ?? input.policy.rules[0];
      if (rule !== undefined) remember(byIdentity, finding(rule, "PARSE_FAILURE", "parse", file.path, WHOLE_FILE, input.policyDigest));
      continue;
    }
    const lines = file.text.split(/\r?\n/u);
    for (const rule of input.policy.rules) {
      for (const violation of violations(rule, document)) {
        remember(byIdentity, finding(rule, violation.messageCode, violation.subject, file.path, locate(lines, violation.anchors), input.policyDigest));
      }
    }
  }
  return Object.freeze(sortFindings([...byIdentity.values()]));
}

function parseWorkflow(text: string): WorkflowDocument | null {
  let document: unknown;
  try {
    document = load(text, { schema: DEFAULT_SCHEMA });
  } catch {
    return null;
  }
  const parsed = WorkflowDocumentSchema.safeParse(document);
  return parsed.success ? parsed.data : null;
}

function* violations(rule: WorkflowRule, document: WorkflowDocument): Generator<Violation> {
  if (rule.check.kind === "pinned-actions") {
    for (const job of Object.values(document.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        const reference = step.uses?.trim();
        // Local composite actions and docker images carry no action reference this rule can judge.
        // ponytail: docker digests are unjudged; the upgrade path is a "docker-digest" mode.
        if (reference === undefined || reference.startsWith("./") || reference.startsWith("docker://")) continue;
        const at = reference.lastIndexOf("@");
        const ref = at === -1 ? "" : reference.slice(at + 1);
        const pinned = rule.check.mode === "sha" ? COMMIT_SHA.test(ref) : ref.length > 0;
        if (!pinned) yield { anchors: [reference], messageCode: "ACTION_NOT_PINNED", subject: `action:${reference}` };
      }
    }
    return;
  }
  const permissions = document.permissions;
  if (typeof permissions === "string") {
    if (permissions.trim() === "write-all") yield { anchors: ["permissions:"], messageCode: "PERMISSION_TOO_BROAD", subject: "permissions:all:write-all" };
    return;
  }
  if (!isRecord(permissions)) {
    yield { anchors: [], messageCode: "PERMISSIONS_MISSING", subject: "permissions:top-level" };
    return;
  }
  for (const scope of Object.keys(permissions).sort()) {
    const value = permissions[scope];
    if (typeof value === "string" && value.trim() === "write" && !rule.check.allowWrite.includes(scope)) {
      yield { anchors: [`${scope}:`, "permissions:"], messageCode: "PERMISSION_TOO_BROAD", subject: `permissions:${scope}:write` };
    }
  }
}

/** ponytail: a plain line scan, not a YAML source map; a repeated value is reported at its first line. */
function locate(lines: readonly string[], anchors: readonly string[]): FindingLocation {
  for (const anchor of anchors) {
    const index = lines.findIndex((line) => line.includes(anchor));
    if (index !== -1) return Object.freeze({ endColumn: 1, endLine: index + 1, startColumn: 1, startLine: index + 1 });
  }
  return WHOLE_FILE;
}

function finding(
  rule: WorkflowRule,
  messageCode: WorkflowMessageCode,
  rawSubject: string,
  path: string,
  location: FindingLocation,
  policyDigest: Sha256Digest,
): EvidenceFinding {
  const subject = safeSubject(rawSubject);
  const identity = findingIdentity({ location, messageCode, path, policyDigest, ruleId: rule.id, subject });
  return Object.freeze({
    exceptionId: null,
    fingerprint: identity.fingerprint,
    id: identity.id,
    level: rule.level,
    location,
    message: workflowMessages[messageCode],
    messageCode,
    path,
    ruleId: rule.id,
    subject,
  });
}

/** Subjects quote workflow text, so they are clamped to the printable, bounded shape evidence allows. */
function safeSubject(subject: string): string {
  return subject.replace(/[^\x20-\x7e]/gu, "?").slice(0, 200);
}

function remember(findings: Map<string, EvidenceFinding>, candidate: EvidenceFinding): void {
  if (!findings.has(candidate.id)) findings.set(candidate.id, candidate);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
