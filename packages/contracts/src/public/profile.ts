import { z } from "zod";

import type { EvidenceFinding } from "./evidence";
import { DigestSchema, SlugSchema, UuidV7Schema } from "./shared";

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

export type PolicyRuleDiff = Readonly<{
  after: unknown;
  before: unknown;
  id: string;
  status: "added" | "changed" | "removed";
}>;

export type Profile<
  TPolicy extends PolicyEnvelope = PolicyEnvelope,
  TEvidence extends EvidenceEnvelope = EvidenceEnvelope,
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
