import { PolicyEnvelopeSchema, type PolicyEnvelope, type Profile } from "@kernel-zero/contracts";
import { softwareArchitectureProfile } from "@kernel-zero/profile-software-architecture";

export const PROFILES: readonly Profile[] = Object.freeze([
  softwareArchitectureProfile as Profile,
]);

const byPolicyKind: ReadonlyMap<string, Profile> = new Map(PROFILES.map((profile) => [profile.policyKind, profile]));

export function profileForPolicyKind(kind: string): Profile | null {
  return byPolicyKind.get(kind) ?? null;
}

export function parsePolicyDocument(document: unknown): Readonly<{ policy: PolicyEnvelope; profile: Profile }> | null {
  const envelope = PolicyEnvelopeSchema.safeParse(document);
  if (!envelope.success) return null;
  const profile = profileForPolicyKind(envelope.data.kind);
  if (profile === null) return null;
  const policy = profile.policySchema.safeParse(document);
  return policy.success ? Object.freeze({ policy: policy.data, profile }) : null;
}
