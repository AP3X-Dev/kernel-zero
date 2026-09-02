import { isUuidV7 } from "@kernel-zero/domain";
import { describe, expect, it, vi } from "vitest";

import type { KernelZeroConfig } from "../config/config";
import { createAuth } from "./auth";

const baseConfig: KernelZeroConfig = {
  appUrl: new URL("http://localhost:3000"),
  databaseUrl: "postgresql://local/test",
  email: { kind: "local-outbox" },
  environment: "test",
  google: { enabled: false },
  identitySecret: "test-only-identity-secret-32-characters",
  rateLimit: { enabled: false },
  registrationOpen: true,
  stripe: { enabled: false },
};

describe("createAuth", () => {
  it("builds with email/password and no partial OAuth provider", () => {
    const auth = createAuth({} as never, baseConfig, { send: vi.fn() });
    expect(auth.handler).toBeTypeOf("function");
  });

  it("issues UUIDv7 identifiers because every identity table keys on a uuid column", () => {
    const auth = createAuth({} as never, baseConfig, { send: vi.fn() });
    const generateId = auth.options.advanced.database.generateId;
    const first = generateId();
    const second = generateId();
    expect(isUuidV7(first)).toBe(true);
    expect(isUuidV7(second)).toBe(true);
    expect(first).not.toBe(second);
  });

  it("declares the normalized email so the create hook reaches the database, and refuses client input for it", () => {
    const auth = createAuth({} as never, baseConfig, { send: vi.fn() });
    expect(auth.options.user.additionalFields.normalizedEmail).toMatchObject({
      input: false,
      required: false,
      type: "string",
    });
  });

  it("builds with registration closed at configuration and persistence boundaries", () => {
    const auth = createAuth(
      {} as never,
      { ...baseConfig, registrationOpen: false },
      { send: vi.fn() },
    );
    expect(auth.handler).toBeTypeOf("function");
  });
});
