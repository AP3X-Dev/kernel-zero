import { findingIdentity, sortFindings, type EvidenceFinding } from "@kernel-zero/contracts";
import type { Sha256Digest } from "@kernel-zero/domain";

import { manifestMessages, type ManifestMessageCode } from "./evidence";
import type { ManifestPolicy, ManifestRule } from "./policy";

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const WHOLE_FILE = Object.freeze({ endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 });

export function checkManifest(input: Readonly<{
  manifest: unknown;
  path: string;
  policy: ManifestPolicy;
  policyDigest: Sha256Digest;
}>): readonly EvidenceFinding[] {
  const manifest = asRecord(input.manifest);
  const findings: EvidenceFinding[] = [];
  for (const rule of input.policy.rules) {
    for (const [messageCode, subject] of violations(rule, manifest)) {
      findings.push(finding(rule, messageCode, subject, input.path, input.policyDigest));
    }
  }
  return Object.freeze(sortFindings(findings));
}

function* violations(rule: ManifestRule, manifest: Record<string, unknown>): Generator<[ManifestMessageCode, string]> {
  if (rule.check.kind === "allowed-licenses") {
    const license = typeof manifest.license === "string" ? manifest.license : "";
    if (!rule.check.allowed.includes(license)) yield ["LICENSE_NOT_ALLOWED", `license:${license === "" ? "missing" : license}`];
    return;
  }
  for (const field of rule.check.fields) {
    const dependencies = asRecord(manifest[field]);
    for (const name of Object.keys(dependencies).sort()) {
      const version = dependencies[name];
      if (typeof version !== "string" || !EXACT_VERSION.test(version)) yield ["DEPENDENCY_NOT_PINNED", `${field}:${name}`];
    }
  }
}

function finding(rule: ManifestRule, messageCode: ManifestMessageCode, subject: string, path: string, policyDigest: Sha256Digest): EvidenceFinding {
  const identity = findingIdentity({ location: WHOLE_FILE, messageCode, path, policyDigest, ruleId: rule.id, subject });
  return Object.freeze({
    exceptionId: null,
    fingerprint: identity.fingerprint,
    id: identity.id,
    level: rule.level,
    location: WHOLE_FILE,
    message: manifestMessages[messageCode],
    messageCode,
    path,
    ruleId: rule.id,
    subject,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
