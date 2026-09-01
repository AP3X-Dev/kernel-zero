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

  it("builds with registration closed at configuration and persistence boundaries", () => {
    const auth = createAuth(
      {} as never,
      { ...baseConfig, registrationOpen: false },
      { send: vi.fn() },
    );
    expect(auth.handler).toBeTypeOf("function");
  });
});
