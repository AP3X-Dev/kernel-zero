import { createPublicKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ExceptionGrantSetSchema,
  canonicalEvidenceDigest,
  deriveEvidenceSummary,
  findingIdentity,
  sortFindings,
  verifyExceptionGrantSet,
  type ExceptionGrantSet,
  type EvidenceFinding,
} from "@kernel-zero/contracts";
import { canonicalJson, canonicalSha256, generateUuidV7 } from "@kernel-zero/domain";
import {
  RepositoryEvidenceSchema,
  RepositoryPolicySchema,
  findingMessage,
  type FindingMessageCode,
  type RepositoryEvidence,
  type RepositoryPolicy,
} from "@kernel-zero/profile-software-architecture";

import type { ResolvedValidateCommand, ValidationOutcome } from "./cli";
import { createManifestDigestInput, discoverTypeScriptSources } from "./discovery";
import { createRepositoryProgram, evaluatePolicyChecks, type RawFindingMessageCode } from "./engine";

export type ValidatorRuntimeOptions = Readonly<{
  generatedAt?: Date;
  repositoryLabel?: string;
  revisionLabel?: string;
  runId?: string;
}>;

export type ValidationRun = ValidationOutcome & Readonly<{ evidence: RepositoryEvidence; policy: RepositoryPolicy }>;

const TOOL_VERSION = "0.1.0";

export class ValidatorRunError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ValidatorRunError";
  }
}

export async function runValidation(command: ResolvedValidateCommand, options: ValidatorRuntimeOptions = {}): Promise<ValidationRun> {
  const startedAt = performance.now();
  const policy = await readPolicy(command.policy);
  const policyDigest = canonicalSha256(policy);
  const generatedAt = options.generatedAt ?? new Date();
  const exceptionBundle = await readVerifiedExceptionBundle(command, policyDigest, generatedAt);
  const discovery = await discoverTypeScriptSources({
    exclude: policy.scope.exclude,
    include: policy.scope.include,
    languages: policy.scope.languages,
    root: command.root,
  });
  const repository = createRepositoryProgram({ rootPath: discovery.root, filePaths: discovery.files.map((file) => file.path) });
  const rawFindings = evaluatePolicyChecks(policy, repository);
  const grants = new Map((exceptionBundle?.grants ?? []).map((grant) => [`${grant.ruleId}\0${grant.fingerprint}`, grant.exceptionId]));
  const findings = sortFindings(rawFindings.map((finding): EvidenceFinding => {
    const messageCode = publicMessageCode(finding.messageCode);
    const identity = findingIdentity({
      location: finding.location,
      messageCode,
      path: finding.path,
      policyDigest,
      ruleId: finding.ruleId,
      subject: finding.subject,
    });
    return {
      ...identity,
      exceptionId: messageCode === "PARSE_FAILURE" ? null : grants.get(`${finding.ruleId}\0${identity.fingerprint}`) ?? null,
      level: finding.level,
      location: finding.location,
      message: findingMessage(messageCode),
      messageCode,
      path: finding.path,
      ruleId: finding.ruleId,
      subject: finding.subject,
    };
  }));
  const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
  const summary = deriveEvidenceSummary(findings, discovery.files.length);
  const base = {
    apiVersion: "kernel-zero.dev/evidence/v1" as const,
    exceptionBundleDigest: exceptionBundle?.integrity.digest ?? null,
    findings,
    generatedAt: generatedAt.toISOString(),
    kind: "RepositoryEvidence" as const,
    policy: { digest: policyDigest, name: policy.metadata.name, revision: policy.metadata.revision },
    result: { ...summary, durationMs },
    runId: options.runId ?? generateUuidV7(generatedAt.getTime()),
    signature: null,
    subject: {
      manifestDigest: canonicalSha256(createManifestDigestInput(discovery.files)),
      repository: options.repositoryLabel ?? path.basename(command.root),
      revision: options.revisionLabel ?? "working-tree",
    },
    tool: { name: "kernel-zero-validator" as const, version: TOOL_VERSION },
    workspace: command.workspace,
  };
  const evidence = RepositoryEvidenceSchema.parse({
    ...base,
    integrity: { algorithm: "sha256", digest: canonicalEvidenceDigest(base) },
  });
  await mkdir(path.dirname(command.out), { recursive: true });
  await writeFile(command.out, `${canonicalJson(evidence)}\n`, "utf8");
  return Object.freeze({ evidence, outcome: evidence.result.status === "pass" ? "pass" : evidence.result.status === "fail" ? "violations" : "error", policy });
}

type StrictEd25519Jwk = Readonly<{ crv: "Ed25519"; kid: string; kty: "OKP"; x: string }>;

async function readJson(inputPath: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(inputPath, "utf8")) as unknown;
  } catch (error) {
    throw new ValidatorRunError(`${label} is not readable JSON.`, { cause: error });
  }
}

function parseTrustKey(value: unknown): StrictEd25519Jwk {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidatorRunError("Exception trust key does not satisfy the strict public JWK contract.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join("\0") !== ["crv", "kid", "kty", "x"].join("\0")
    || record.kty !== "OKP"
    || record.crv !== "Ed25519"
    || typeof record.kid !== "string"
    || record.kid.trim() !== record.kid
    || record.kid.length < 1
    || record.kid.length > 120
    || typeof record.x !== "string"
    || !/^[A-Za-z0-9_-]+$/u.test(record.x)) {
    throw new ValidatorRunError("Exception trust key does not satisfy the strict public JWK contract.");
  }
  const decoded = Buffer.from(record.x, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== record.x) {
    throw new ValidatorRunError("Exception trust key does not satisfy the strict public JWK contract.");
  }
  return { crv: "Ed25519", kid: record.kid, kty: "OKP", x: record.x };
}

async function readVerifiedExceptionBundle(
  command: ResolvedValidateCommand,
  policyDigest: `sha256:${string}`,
  now: Date,
): Promise<ExceptionGrantSet | undefined> {
  if (command.exceptions === undefined && command.exceptionsTrustKey === undefined) return undefined;
  if (command.exceptions === undefined || command.exceptionsTrustKey === undefined) {
    throw new ValidatorRunError("Exception bundle and trust key must be supplied together.");
  }
  const bundleValue = await readJson(command.exceptions, "Exception bundle");
  const parsed = ExceptionGrantSetSchema.safeParse(bundleValue);
  if (!parsed.success) throw new ValidatorRunError("Exception bundle does not satisfy the public contract.", { cause: parsed.error });
  const trustKey = parseTrustKey(await readJson(command.exceptionsTrustKey, "Exception trust key"));
  if (parsed.data.signature.keyId !== trustKey.kid) throw new ValidatorRunError("Exception trust key ID does not match the bundle.");
  if (Date.parse(parsed.data.generatedAt) > now.getTime()) throw new ValidatorRunError("Exception bundle was generated in the future.");
  let publicKey;
  try {
    publicKey = createPublicKey({ format: "jwk", key: trustKey });
  } catch (error) {
    throw new ValidatorRunError("Exception trust key is not a valid Ed25519 public key.", { cause: error });
  }
  const verified = verifyExceptionGrantSet(parsed.data, publicKey, { now, policyDigest, workspace: command.workspace });
  if (!verified.ok) throw new ValidatorRunError(`Exception bundle verification failed: ${verified.reason}.`);
  return parsed.data;
}

async function readPolicy(policyPath: string) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(await readFile(policyPath, "utf8")) as unknown;
  } catch (error) {
    throw new ValidatorRunError("Policy input is not readable JSON.", { cause: error });
  }
  const parsed = RepositoryPolicySchema.safeParse(decoded);
  if (!parsed.success) throw new ValidatorRunError("Policy input does not satisfy the public contract.", { cause: parsed.error });
  return parsed.data;
}

function publicMessageCode(code: RawFindingMessageCode): FindingMessageCode {
  switch (code) {
    case "PARSE_FAILURE": return "PARSE_FAILURE";
    case "DENIED_IMPORT":
    case "IMPORT_RESOLUTION_FAILED": return "DENIED_IMPORT";
    case "MISSING_REQUIRED_IMPORT": return "REQUIRED_IMPORT_MISSING";
    case "CALL_RESOLUTION_FAILED":
    case "RESTRICTED_CALL_SITE": return "RESTRICTED_CALL";
    case "EXPORT_PROOF_FAILED":
    case "MISSING_EXPORT_KEY": return "REQUIRED_EXPORT_KEY_MISSING";
    case "MISSING_TENANT_PARAMETER": return "TENANT_PARAMETER_MISSING";
    case "UNPARSED_BOUNDARY": return "BOUNDARY_PARSE_REQUIRED";
    case "GOVERNED_DECLARATION_PROOF_FAILED":
    case "GOVERNED_REGISTRY_PROOF_FAILED":
    case "INVALID_GOVERNED_KEY":
    case "MISSING_GOVERNED_KEY":
    case "UNKNOWN_GOVERNED_ACTION": return "GOVERNED_OPERATION_INVALID";
    case "CONTEXT_PARAMETER_MISSING":
    case "CONTEXT_PARAMETER_UNSAFE":
    case "CONTEXT_PARAMETER_TYPE_MISMATCH": return "CONTEXT_PARAMETER_INVALID";
    case "CONTEXT_PARAMETER_UNRESOLVED":
    case "CONTEXT_TYPE_UNRESOLVED": return "CONTEXT_PARAMETER_PROOF_FAILED";
    case "CLOSED_REGISTRY_ENTRY_INVALID": return "CLOSED_REGISTRY_ENTRY_INVALID";
    case "UNREGISTERED_DECLARATION": return "UNREGISTERED_DECLARATION";
    case "CLOSED_REGISTRY_PROOF_FAILED": return "CLOSED_REGISTRY_PROOF_FAILED";
    case "PROPERTY_WRITE_DENIED": return "PROPERTY_WRITE_DENIED";
    case "PROPERTY_WRITE_UNRESOLVED":
    case "PROPERTY_TARGET_UNRESOLVED": return "PROPERTY_WRITE_PROOF_FAILED";
  }
}
