import { canonicalJson } from "@kernel-zero/domain";
import { z } from "zod";

import {
  EvidenceFindingSchema,
  EvidenceResultSchema,
  EvidenceSignatureSchema,
  type EvidenceFinding,
} from "./evidence";
import { DigestSchema, InstantSchema, SlugSchema, UuidV7Schema } from "./shared";

export const PolicyEnvelopeSchema = z.looseObject({
  apiVersion: z.literal("kernel-zero.dev/v1"),
  kind: z.string().min(3).max(64).regex(/^[A-Z][A-Za-z]+Policy$/u),
  metadata: z.looseObject({
    name: SlugSchema(3, 64),
    revision: z.number().int().min(1),
    description: z.string().trim().min(1).max(500),
  }),
});

export type PolicyEnvelope = z.infer<typeof PolicyEnvelopeSchema>;

export const EvidenceEnvelopeSchema = z.looseObject({
  apiVersion: z.literal("kernel-zero.dev/evidence/v1"),
  kind: z.string().min(3).max(64).regex(/^[A-Z][A-Za-z]+Evidence$/u),
  policy: z.strictObject({ digest: DigestSchema, name: SlugSchema(3, 64), revision: z.number().int().min(1) }),
  workspace: UuidV7Schema,
});

export type EvidenceEnvelope = z.infer<typeof EvidenceEnvelopeSchema>;

/** The kernel-generic evidence shape the control plane stores; profile-specific rules stay in the profile. */
export const StoredEvidenceSchema = EvidenceEnvelopeSchema.extend({
  exceptionBundleDigest: DigestSchema.nullable(),
  findings: z.array(EvidenceFindingSchema).max(5_000),
  generatedAt: InstantSchema,
  integrity: z.strictObject({ algorithm: z.literal("sha256"), digest: DigestSchema }),
  result: EvidenceResultSchema,
  runId: UuidV7Schema,
  signature: EvidenceSignatureSchema.nullable(),
  subject: z.strictObject({
    manifestDigest: DigestSchema,
    repository: z.string().min(1).max(200),
    revision: z.string().min(1).max(200),
  }),
  tool: z.strictObject({ name: z.string().min(1).max(80), version: z.string().min(1).max(80) }),
});

export type StoredEvidence = z.infer<typeof StoredEvidenceSchema>;

export type PolicyRuleDiff = Readonly<{
  after: unknown;
  before: unknown;
  id: string;
  status: "added" | "changed" | "removed";
}>;

export function diffRulesById(
  before: Readonly<{ rules: readonly Readonly<{ id: string }>[] }>,
  after: Readonly<{ rules: readonly Readonly<{ id: string }>[] }>,
): readonly PolicyRuleDiff[] {
  const left = new Map(before.rules.map((rule) => [rule.id, rule]));
  const right = new Map(after.rules.map((rule) => [rule.id, rule]));
  const result: PolicyRuleDiff[] = [];
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const beforeRule = left.get(id) ?? null;
    const afterRule = right.get(id) ?? null;
    if (beforeRule === null) result.push(Object.freeze({ after: afterRule, before: null, id, status: "added" }));
    else if (afterRule === null) result.push(Object.freeze({ after: null, before: beforeRule, id, status: "removed" }));
    else if (canonicalJson(beforeRule) !== canonicalJson(afterRule)) result.push(Object.freeze({ after: afterRule, before: beforeRule, id, status: "changed" }));
  }
  return Object.freeze(result);
}

export type Profile<
  TPolicy extends PolicyEnvelope = PolicyEnvelope,
  TEvidence extends StoredEvidence = StoredEvidence,
> = Readonly<{
  policyKind: string;
  evidenceKind: string;
  toolName: string;
  policySchema: z.ZodType<TPolicy>;
  evidenceSchema: z.ZodType<TEvidence>;
  findingCompatibilityReason(policy: TPolicy, finding: EvidenceFinding): string | null;
  diffRules(before: TPolicy, after: TPolicy): readonly PolicyRuleDiff[];
  policyJsonSchema(): Record<string, unknown>;
  evidenceJsonSchema(): Record<string, unknown>;
}>;
