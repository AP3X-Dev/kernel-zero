import { describe, expect, it } from "vitest";

import { isolatedTestDatabaseUrl } from "./environment";

describe("isolated PostgreSQL test harness", () => {
  it("accepts explicitly isolated database and schema names", () => {
    expect(
      isolatedTestDatabaseUrl({ TEST_DATABASE_URL: "postgresql://app:app@localhost/kernel_zero_test" }),
    ).toContain("kernel_zero_test");
    expect(
      isolatedTestDatabaseUrl({ TEST_DATABASE_URL: "postgresql://app:app@localhost/app?schema=gate_test" }),
    ).toContain("schema=gate_test");
  });

  it("rejects missing and production-shaped targets before setup", () => {
    expect(() => isolatedTestDatabaseUrl({})).toThrow(/required/u);
    expect(() =>
      isolatedTestDatabaseUrl({ TEST_DATABASE_URL: "postgresql://app:app@db.internal/kernel_zero" }),
    ).toThrow(/isolated/u);
  });
});
