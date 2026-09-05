import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./tests/support/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["./tests/integration/database/global-setup.ts"],
    // A database that fails to start must fail the gate, never pass it with zero tests.
    passWithNoTests: false,
    pool: "forks",
    sequence: { concurrent: false },
    // Real PostgreSQL work under a loaded CI runner needs more than vitest's five-second default.
    testTimeout: 60_000,
  },
});
