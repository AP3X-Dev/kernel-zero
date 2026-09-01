import "server-only";

import { z } from "zod";

const LOCAL_ONLY_SECRET = "local-only-change-before-production-32-bytes";

const optionalTrimmed = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const rawEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: optionalTrimmed,
    KERNEL_ZERO_APP_URL: optionalTrimmed,
    KERNEL_ZERO_IDENTITY_SECRET: optionalTrimmed,
    KERNEL_ZERO_REGISTRATION_OPEN: z.enum(["true", "false"]).default("true"),
    KERNEL_ZERO_EMAIL_MODE: z.enum(["local-outbox", "resend"]).default("local-outbox"),
    KERNEL_ZERO_EMAIL_FROM: optionalTrimmed,
    KERNEL_ZERO_OPERATOR_EMAIL: optionalTrimmed,
    GOOGLE_CLIENT_ID: optionalTrimmed,
    GOOGLE_CLIENT_SECRET: optionalTrimmed,
    RESEND_API_KEY: optionalTrimmed,
    STRIPE_SECRET_KEY: optionalTrimmed,
    STRIPE_WEBHOOK_SECRET: optionalTrimmed,
    UPSTASH_REDIS_REST_TOKEN: optionalTrimmed,
    UPSTASH_REDIS_REST_URL: optionalTrimmed,
  })
  .strict();

export type ConfigurationIssue = Readonly<{
  field: string;
  code: "MISSING" | "PARTIAL" | "UNSAFE";
  message: string;
}>;

export type RuntimeEnvironment = "development" | "test" | "production";

export type KernelZeroConfig = Readonly<{
  environment: RuntimeEnvironment;
  databaseUrl: string;
  appUrl: URL;
  identitySecret: string;
  registrationOpen: boolean;
  email:
    | Readonly<{ kind: "local-outbox" }>
    | Readonly<{ kind: "resend"; apiKey: string; from: string }>;
  google: Readonly<{ enabled: false }> | Readonly<{ enabled: true; clientId: string; clientSecret: string }>;
  stripe:
    | Readonly<{ enabled: false }>
    | Readonly<{ enabled: true; secretKey: string; webhookSecret: string }>;
  rateLimit:
    | Readonly<{ enabled: false }>
    | Readonly<{ enabled: true; restUrl: URL; token: string }>;
  operatorEmail?: string;
}>;

export class ConfigurationError extends Error {
  readonly issues: readonly ConfigurationIssue[];

  constructor(issues: readonly ConfigurationIssue[]) {
    super(`KERNEL ZERO configuration is invalid:\n${issues.map((issue) => `- ${issue.field}: ${issue.message}`).join("\n")}`);
    this.name = "ConfigurationError";
    this.issues = Object.freeze([...issues]);
  }
}

function paired(
  first: string | undefined,
  second: string | undefined,
  firstField: string,
  secondField: string,
  issues: ConfigurationIssue[],
): boolean {
  if ((first === undefined) !== (second === undefined)) {
    issues.push({
      code: "PARTIAL",
      field: `${firstField},${secondField}`,
      message: "both values must be configured together",
    });
    return false;
  }
  return first !== undefined && second !== undefined;
}

function validHttpsUrl(value: string | undefined, field: string, production: boolean, issues: ConfigurationIssue[]): URL | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = new URL(value);
    if (production && parsed.protocol !== "https:") {
      issues.push({ code: "UNSAFE", field, message: "must use HTTPS in production" });
    }
    if (parsed.username !== "" || parsed.password !== "") {
      issues.push({ code: "UNSAFE", field, message: "must not contain embedded credentials" });
    }
    return parsed;
  } catch {
    issues.push({ code: "UNSAFE", field, message: "must be an absolute URL" });
    return undefined;
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
  const production = raw.NODE_ENV === "production";
  const issues: ConfigurationIssue[] = [];
  const databaseUrl = raw.DATABASE_URL;
  if (databaseUrl === undefined) issues.push({ code: "MISSING", field: "DATABASE_URL", message: "is required" });
  else if (!/^postgres(?:ql)?:\/\//u.test(databaseUrl)) issues.push({ code: "UNSAFE", field: "DATABASE_URL", message: "must be a PostgreSQL URL" });

  const appUrl = validHttpsUrl(raw.KERNEL_ZERO_APP_URL, "KERNEL_ZERO_APP_URL", production, issues);
  if (appUrl === undefined) issues.push({ code: "MISSING", field: "KERNEL_ZERO_APP_URL", message: "is required" });

  const identitySecret = raw.KERNEL_ZERO_IDENTITY_SECRET;
  if (identitySecret === undefined) issues.push({ code: "MISSING", field: "KERNEL_ZERO_IDENTITY_SECRET", message: "is required" });
  else if (identitySecret.length < 32 || (production && identitySecret === LOCAL_ONLY_SECRET)) {
    issues.push({ code: "UNSAFE", field: "KERNEL_ZERO_IDENTITY_SECRET", message: "must be at least 32 characters and not the local-only secret" });
  }

  const googleEnabled = paired(raw.GOOGLE_CLIENT_ID, raw.GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", issues);
  const stripeEnabled = paired(raw.STRIPE_SECRET_KEY, raw.STRIPE_WEBHOOK_SECRET, "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", issues);
  const rateLimitEnabled = paired(raw.UPSTASH_REDIS_REST_URL, raw.UPSTASH_REDIS_REST_TOKEN, "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", issues);
  const restUrl = rateLimitEnabled
    ? validHttpsUrl(raw.UPSTASH_REDIS_REST_URL, "UPSTASH_REDIS_REST_URL", true, issues)
    : undefined;

  if (production && raw.KERNEL_ZERO_EMAIL_MODE !== "resend") {
    issues.push({ code: "UNSAFE", field: "KERNEL_ZERO_EMAIL_MODE", message: "production requires resend delivery" });
  }
  const resendEnabled = raw.KERNEL_ZERO_EMAIL_MODE === "resend";
  if (resendEnabled && (raw.RESEND_API_KEY === undefined || raw.KERNEL_ZERO_EMAIL_FROM === undefined)) {
    issues.push({ code: "MISSING", field: "RESEND_API_KEY,KERNEL_ZERO_EMAIL_FROM", message: "are required for resend delivery" });
  }

  if (issues.length > 0 || databaseUrl === undefined || appUrl === undefined || identitySecret === undefined) {
    throw new ConfigurationError(issues);
  }

  const config: KernelZeroConfig = {
    appUrl,
    databaseUrl,
    email: resendEnabled && raw.RESEND_API_KEY !== undefined && raw.KERNEL_ZERO_EMAIL_FROM !== undefined
      ? { apiKey: raw.RESEND_API_KEY, from: raw.KERNEL_ZERO_EMAIL_FROM, kind: "resend" }
      : { kind: "local-outbox" },
    environment: raw.NODE_ENV,
    google: googleEnabled && raw.GOOGLE_CLIENT_ID !== undefined && raw.GOOGLE_CLIENT_SECRET !== undefined
      ? { clientId: raw.GOOGLE_CLIENT_ID, clientSecret: raw.GOOGLE_CLIENT_SECRET, enabled: true }
      : { enabled: false },
    identitySecret,
    rateLimit: rateLimitEnabled && restUrl !== undefined && raw.UPSTASH_REDIS_REST_TOKEN !== undefined
      ? { enabled: true, restUrl, token: raw.UPSTASH_REDIS_REST_TOKEN }
      : { enabled: false },
    registrationOpen: raw.KERNEL_ZERO_REGISTRATION_OPEN === "true",
    stripe: stripeEnabled && raw.STRIPE_SECRET_KEY !== undefined && raw.STRIPE_WEBHOOK_SECRET !== undefined
      ? { enabled: true, secretKey: raw.STRIPE_SECRET_KEY, webhookSecret: raw.STRIPE_WEBHOOK_SECRET }
      : { enabled: false },
    ...(raw.KERNEL_ZERO_OPERATOR_EMAIL === undefined
      ? {}
      : { operatorEmail: raw.KERNEL_ZERO_OPERATOR_EMAIL.toLowerCase() }),
  };
  return Object.freeze(config);
}
