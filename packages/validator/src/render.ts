import type { PolicyCustodyEvidence, StoredEvidence } from "@kernel-zero/contracts";
import type { RepositoryPolicy } from "@kernel-zero/profile-software-architecture";

/** Hard cap on rendered findings so terminal output stays bounded; the JSON artifact remains complete. */
export const RENDER_LIMIT = 200;

export type RenderableEvidence = Readonly<{ findings: readonly Pick<StoredEvidence["findings"][number], "level" | "location" | "messageCode" | "path" | "ruleId" | "subject" | "exceptionId">[]; result: StoredEvidence["result"] }>;

/** Deterministic, machine-stable terminal lines: one summary line, then one line per finding plus its remediation. */
export function renderEvidence(evidence: RenderableEvidence, remediations: ReadonlyMap<string, string>): string {
  const lines = [
    `kernel-zero: ${evidence.result.status} (${String(evidence.result.errors)} errors, ${String(evidence.result.warnings)} warnings, ${String(evidence.result.excepted)} excepted, ${String(evidence.result.filesScanned)} files)`,
  ];
  for (const finding of evidence.findings.slice(0, RENDER_LIMIT)) {
    const excepted = finding.exceptionId === null ? "" : ` excepted:${finding.exceptionId}`;
    lines.push(`${finding.level} ${finding.ruleId} ${finding.path}:${String(finding.location.startLine)}:${String(finding.location.startColumn)} ${finding.messageCode} ${finding.subject}${excepted}`);
    const remediation = remediations.get(finding.ruleId);
    if (remediation !== undefined) lines.push(`  remediation: ${remediation}`);
  }
  if (evidence.findings.length > RENDER_LIMIT) {
    lines.push(`  ... ${String(evidence.findings.length - RENDER_LIMIT)} more findings in the evidence artifact`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderPolicy(policy: RepositoryPolicy): string {
  const lines = [`policy ${policy.metadata.name} revision ${String(policy.metadata.revision)}: ${String(policy.rules.length)} rules`];
  for (const rule of policy.rules) {
    lines.push(`${rule.level} ${rule.id} (${rule.check.kind}): ${rule.title}`);
    lines.push(`  remediation: ${rule.remediation}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderCustody(custody: PolicyCustodyEvidence): string {
  const lines = [
    `custody: ${custody.result.status} (${String(custody.result.errors)} findings) policy ${custody.policy.name} revision ${String(custody.policy.revision)} approval ${custody.approval.approvalId} key ${custody.trust.keyId}`,
  ];
  for (const finding of custody.findings) {
    lines.push(`error ${finding.code} ${finding.subject}`);
    lines.push(`  ${finding.message}`);
  }
  return `${lines.join("\n")}\n`;
}

export function remediationsOf(policy: Readonly<{ rules: readonly Readonly<{ id: string; remediation: string }>[] }>): ReadonlyMap<string, string> {
  return new Map(policy.rules.map((rule) => [rule.id, rule.remediation]));
}
