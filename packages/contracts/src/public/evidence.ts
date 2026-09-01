import { z } from "zod";

import { canonicalSha256, type Sha256Digest } from "@kernel-zero/domain";

import { DigestSchema, InstantSchema, SlugSchema, UuidV7Schema } from "./shared";

export const EVIDENCE_MEDIA_TYPE = "application/vnd.kernel-zero.evidence+json;version=1" as const;
/** @deprecated alias kept for the architecture profile's generated docs */
export const REPOSITORY_EVIDENCE_MEDIA_TYPE = EVIDENCE_MEDIA_TYPE;

export const PARSE_FAILURE_CODE = "PARSE_FAILURE" as const;
export const MessageCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u);

const SafePrintableSchema = z.string().min(1).max(500).regex(/^[\x20-\x7e]+$/u);
const RelativeEvidencePathSchema = z.string().min(1).max(1_000).superRefine((value, context) => {
  const segments = value.split("/");
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/u.test(value) || segments.includes("..") || value.includes("\0")) {
    context.addIssue({ code: "custom", message: "Finding paths must be contained relative POSIX paths." });
  }
});
const SemverSchema = z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u);

export const FindingLocationSchema = z.strictObject({
  endColumn: z.number().int().positive(),
  endLine: z.number().int().positive(),
  startColumn: z.number().int().positive(),
  startLine: z.number().int().positive(),
}).superRefine((location, context) => {
  if (location.endLine < location.startLine || (location.endLine === location.startLine && location.endColumn < location.startColumn)) {
    context.addIssue({ code: "custom", message: "Finding end must not precede its start." });
  }
});

export type FindingLocation = z.infer<typeof FindingLocationSchema>;

export const EvidenceFindingSchema = z.strictObject({
  exceptionId: UuidV7Schema.nullable(),
  fingerprint: DigestSchema,
  id: DigestSchema,
  level: z.enum(["error", "warning"]),
  location: FindingLocationSchema,
  message: z.string().min(1).max(500),
  messageCode: MessageCodeSchema,
  path: RelativeEvidencePathSchema,
  ruleId: SlugSchema(3, 80),
  subject: SafePrintableSchema,
});

export type EvidenceFinding = z.infer<typeof EvidenceFindingSchema>;

export const EvidenceResultSchema = z.strictObject({
  durationMs: z.number().int().nonnegative(),
  errors: z.number().int().min(0).max(5_000),
  excepted: z.number().int().min(0).max(5_000),
  filesScanned: z.number().int().nonnegative(),
  status: z.enum(["error", "fail", "pass"]),
  warnings: z.number().int().min(0).max(5_000),
});

export const EvidenceSignatureSchema = z.strictObject({
  algorithm: z.literal("ed25519"),
  keyId: z.string().trim().min(1).max(120),
  value: z.base64(),
});

export type EvidenceMessages = Readonly<Record<string, string>>;

export function createEvidenceSchema(options: Readonly<{ evidenceKind: string; toolName: string; messages: EvidenceMessages }>) {
  const messages: EvidenceMessages = Object.freeze({
    ...options.messages,
    [PARSE_FAILURE_CODE]: options.messages[PARSE_FAILURE_CODE] ?? "A claimed source file could not be parsed.",
  });

  const FindingSchema = EvidenceFindingSchema.extend({
    messageCode: z.enum(Object.keys(messages) as [string, ...string[]]),
  });

  const base = z.strictObject({
    apiVersion: z.literal("kernel-zero.dev/evidence/v1"),
    exceptionBundleDigest: DigestSchema.nullable(),
    findings: z.array(FindingSchema).max(5_000),
    generatedAt: InstantSchema,
    integrity: z.strictObject({ algorithm: z.literal("sha256"), digest: DigestSchema }),
    kind: z.literal(options.evidenceKind),
    policy: z.strictObject({ digest: DigestSchema, name: SlugSchema(3, 64), revision: z.number().int().min(1) }),
    result: EvidenceResultSchema,
    runId: UuidV7Schema,
    signature: EvidenceSignatureSchema.nullable(),
    subject: z.strictObject({
      manifestDigest: DigestSchema,
      repository: z.string().min(1).max(200).regex(/^[\x20-\x7e]+$/u),
      revision: z.string().min(1).max(200).regex(/^[\x20-\x7e]+$/u),
    }),
    tool: z.strictObject({ name: z.literal(options.toolName), version: SemverSchema }),
    workspace: UuidV7Schema,
  });

  const schema = base.superRefine((evidence, context) => {
    const sorted = sortFindings(evidence.findings);
    if (sorted.some((finding, index) => finding.id !== evidence.findings[index]?.id)) {
      context.addIssue({ code: "custom", path: ["findings"], message: "Findings must use canonical order." });
    }
    for (const [index, finding] of evidence.findings.entries()) {
      const identity = findingIdentity({
        location: finding.location,
        messageCode: finding.messageCode,
        path: finding.path,
        policyDigest: evidence.policy.digest,
        ruleId: finding.ruleId,
        subject: finding.subject,
      });
      if (finding.fingerprint !== identity.fingerprint) context.addIssue({ code: "custom", path: ["findings", index, "fingerprint"], message: "Finding fingerprint does not match its canonical identity." });
      if (finding.id !== identity.id) context.addIssue({ code: "custom", path: ["findings", index, "id"], message: "Finding ID does not match its canonical identity." });
      if (finding.message !== messages[finding.messageCode]) context.addIssue({ code: "custom", path: ["findings", index, "message"], message: "Finding message does not match its closed message code." });
      if (finding.messageCode === PARSE_FAILURE_CODE && finding.subject !== "parse") context.addIssue({ code: "custom", path: ["findings", index, "subject"], message: "Parse failures require the parse subject." });
      if (finding.messageCode === PARSE_FAILURE_CODE && finding.exceptionId !== null) context.addIssue({ code: "custom", path: ["findings", index, "exceptionId"], message: "Validator errors cannot be excepted." });
    }
    const summary = deriveEvidenceSummary(evidence.findings, evidence.result.filesScanned);
    for (const key of ["errors", "excepted", "filesScanned", "status", "warnings"] as const) {
      if (evidence.result[key] !== summary[key]) context.addIssue({ code: "custom", path: ["result", key], message: "Evidence summary does not match findings." });
    }
    if (canonicalEvidenceDigest(evidence) !== evidence.integrity.digest) context.addIssue({ code: "custom", path: ["integrity", "digest"], message: "Evidence integrity digest does not match canonical content." });
  });

  return Object.freeze({ base, messages, schema });
}

export type GenericEvidence = z.infer<ReturnType<typeof createEvidenceSchema>["base"]>;

export function findingIdentity(input: Readonly<{
  location: FindingLocation;
  messageCode: string;
  path: string;
  policyDigest: Sha256Digest;
  ruleId: string;
  subject: string;
}>): Readonly<{ fingerprint: Sha256Digest; id: Sha256Digest }> {
  const fingerprint = canonicalSha256({ messageCode: input.messageCode, path: input.path, ruleId: input.ruleId, subject: input.subject });
  return Object.freeze({ fingerprint, id: canonicalSha256({ fingerprint, location: input.location, policyDigest: input.policyDigest }) });
}

export function deriveEvidenceSummary(findings: readonly EvidenceFinding[], filesScanned: number): Readonly<{
  errors: number;
  excepted: number;
  filesScanned: number;
  status: "error" | "fail" | "pass";
  warnings: number;
}> {
  const unexcepted = findings.filter((finding) => finding.exceptionId === null);
  const errors = unexcepted.filter((finding) => finding.level === "error").length;
  const warnings = unexcepted.filter((finding) => finding.level === "warning").length;
  const excepted = findings.length - unexcepted.length;
  const incomplete = findings.some((finding) => finding.messageCode === PARSE_FAILURE_CODE);
  return Object.freeze({ errors, excepted, filesScanned, status: incomplete ? "error" : errors > 0 ? "fail" : "pass", warnings });
}

export function sortFindings(findings: readonly EvidenceFinding[]): EvidenceFinding[] {
  return [...findings].sort((left, right) => left.ruleId.localeCompare(right.ruleId)
    || left.path.localeCompare(right.path)
    || left.location.startLine - right.location.startLine
    || left.location.startColumn - right.location.startColumn
    || left.id.localeCompare(right.id));
}

export function canonicalEvidenceDigest(evidence: Omit<GenericEvidence, "integrity"> | GenericEvidence): Sha256Digest {
  return canonicalSha256({
    apiVersion: evidence.apiVersion,
    exceptionBundleDigest: evidence.exceptionBundleDigest,
    findings: sortFindings(evidence.findings),
    kind: evidence.kind,
    policy: evidence.policy,
    result: {
      errors: evidence.result.errors,
      excepted: evidence.result.excepted,
      filesScanned: evidence.result.filesScanned,
      status: evidence.result.status,
      warnings: evidence.result.warnings,
    },
    subject: evidence.subject,
    tool: evidence.tool,
    workspace: evidence.workspace,
  });
}
