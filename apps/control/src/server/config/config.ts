import "server-only";

import { isUuidV7 } from "@kernel-zero/domain";
import { z } from "zod";

/** The same identifier the repository's own validation runs use; a deployment overrides it to scope its evidence. */
export const DEFAULT_WORKSPACE_ID = "00000000-0000-7000-8000-000000000000";

const optionalTrimmed = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const rawEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: optionalTrimmed,
    KERNEL_ZERO_WORKSPACE_ID: optionalTrimmed,
    KERNEL_ZERO_EVIDENCE_TOKEN: optionalTrimmed,
  })
  .strict();

export type ConfigurationIssue = Readonly<{
  field: string;
  code: "MISSING" | "UNSAFE";
  message: string;
}>;

export type RuntimeEnvironment = "development" | "test" | "production";

export type KernelZeroConfig = Readonly<{
  environment: RuntimeEnvironment;
  databaseUrl: string;
  /** Static bearer token CI presents to the evidence ingress; the only network trust boundary left. */
  evidenceToken: string;
  workspaceId: string;
}>;

export class ConfigurationError extends Error {
  readonly issues: readonly ConfigurationIssue[];

  constructor(issues: readonly ConfigurationIssue[]) {
    super(`KERNEL ZERO configuration is invalid:\n${issues.map((issue) => `- ${issue.field}: ${issue.message}`).join("\n")}`);
    this.name = "ConfigurationError";
    this.issues = Object.freeze([...issues]);
  }
}

export function loadConfig(environment: Readonly<Record<string, string | undefined>>): KernelZeroConfig {
  const selected = Object.fromEntries(
    Object.keys(rawEnvironmentSchema.shape).map((key) => [key, environment[key]]),
  );
  const parsed = rawEnvironmentSchema.safeParse(selected);
  if (!parsed.success) {
    throw new ConfigurationError(
      parsed.error.issues.map((issue) => ({
        code: "UNSAFE" as const,
        field: issue.path.join(".") || "environment",
        message: issue.message,
      })),
    );
  }

  const raw = parsed.data;
  const issues: ConfigurationIssue[] = [];
  const databaseUrl = raw.DATABASE_URL;
  if (databaseUrl === undefined) issues.push({ code: "MISSING", field: "DATABASE_URL", message: "is required" });
  else if (!/^postgres(?:ql)?:\/\//u.test(databaseUrl)) issues.push({ code: "UNSAFE", field: "DATABASE_URL", message: "must be a PostgreSQL URL" });

  const workspaceId = raw.KERNEL_ZERO_WORKSPACE_ID ?? DEFAULT_WORKSPACE_ID;
  if (!isUuidV7(workspaceId)) issues.push({ code: "UNSAFE", field: "KERNEL_ZERO_WORKSPACE_ID", message: "must be a lowercase UUIDv7" });

  const evidenceToken = raw.KERNEL_ZERO_EVIDENCE_TOKEN;
  if (evidenceToken === undefined) issues.push({ code: "MISSING", field: "KERNEL_ZERO_EVIDENCE_TOKEN", message: "is required" });
  else if (evidenceToken.length < 32) issues.push({ code: "UNSAFE", field: "KERNEL_ZERO_EVIDENCE_TOKEN", message: "must be at least 32 characters" });

  if (issues.length > 0 || databaseUrl === undefined || evidenceToken === undefined) {
    throw new ConfigurationError(issues);
  }

  return Object.freeze({ databaseUrl, environment: raw.NODE_ENV, evidenceToken, workspaceId });
}
