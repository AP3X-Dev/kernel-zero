import { describe, expect, it } from "vitest";

import { ConfigurationError, DEFAULT_WORKSPACE_ID, loadConfig } from "./config";

const base = {
  DATABASE_URL: "postgresql://local:test@127.0.0.1:5432/kernel_zero",
  KERNEL_ZERO_EVIDENCE_TOKEN: "local-only-evidence-token-at-least-32-bytes",
  NODE_ENV: "test",
};

describe("configuration safety gates", () => {
  it("accepts a minimal local configuration and defaults the workspace identifier", () => {
    const config = loadConfig(base);
    expect(config.workspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(config.environment).toBe("test");
  });

  it("rejects a workspace identifier that is not a UUIDv7 and a short evidence token", () => {
    expect(() => loadConfig({ ...base, KERNEL_ZERO_WORKSPACE_ID: "workspace" })).toThrow(ConfigurationError);
    expect(() => loadConfig({ ...base, KERNEL_ZERO_EVIDENCE_TOKEN: "short" })).toThrow(ConfigurationError);
  });

  it("reports every missing or unsafe requirement without exposing values", () => {
    try {
      loadConfig({ DATABASE_URL: "sqlite:file.db", NODE_ENV: "production" });
      throw new Error("expected configuration failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toContain("DATABASE_URL");
      expect((error as Error).message).toContain("KERNEL_ZERO_EVIDENCE_TOKEN");
      expect((error as Error).message).not.toContain("sqlite:file.db");
    }
  });
});
