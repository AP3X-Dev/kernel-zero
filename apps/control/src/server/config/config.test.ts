import { describe, expect, it } from "vitest";

import { ConfigurationError, loadConfig } from "./config";

const base = {
  DATABASE_URL: "postgresql://local:test@127.0.0.1:5432/kernel_zero",
  NODE_ENV: "test",
  KERNEL_ZERO_APP_URL: "http://127.0.0.1:3000",
  KERNEL_ZERO_EMAIL_MODE: "local-outbox",
  KERNEL_ZERO_IDENTITY_SECRET: "local-only-change-before-production-32-bytes",
};

describe("configuration safety gates", () => {
  it("accepts explicitly local test configuration and disables partial optional providers", () => {
    const config = loadConfig(base);
    expect(config.google).toEqual({ enabled: false });
    expect(config.stripe).toEqual({ enabled: false });
    expect(config.rateLimit).toEqual({ enabled: false });
    expect(config.email).toEqual({ kind: "local-outbox" });
  });

  it("rejects partial optional-provider configuration", () => {
    expect(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: "client" })).toThrow(ConfigurationError);
    expect(() => loadConfig({ ...base, STRIPE_SECRET_KEY: "secret" })).toThrow(ConfigurationError);
    expect(() => loadConfig({ ...base, UPSTASH_REDIS_REST_URL: "https://example.test" })).toThrow(ConfigurationError);
  });

  it("reports every unsafe production requirement without exposing values", () => {
    try {
      loadConfig({
        DATABASE_URL: "sqlite:file.db",
        NODE_ENV: "production",
        KERNEL_ZERO_APP_URL: "http://example.test",
        KERNEL_ZERO_EMAIL_MODE: "local-outbox",
        KERNEL_ZERO_IDENTITY_SECRET: "local-only-change-before-production-32-bytes",
      });
      throw new Error("expected configuration failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toContain("DATABASE_URL");
      expect((error as Error).message).toContain("KERNEL_ZERO_APP_URL");
      expect((error as Error).message).toContain("KERNEL_ZERO_EMAIL_MODE");
      expect((error as Error).message).not.toContain("sqlite:file.db");
    }
  });
});
