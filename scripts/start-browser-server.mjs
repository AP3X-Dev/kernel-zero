import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

import EmbeddedPostgres from "embedded-postgres";
import { startServer } from "next/dist/server/lib/start-server.js";

// The browser suite runs the production build against a throwaway embedded PostgreSQL so every
// server-rendered page has a schema to read; the database exists only for this run.
const PORT = 55330;
const DATA_DIR = path.resolve(".kernel-zero", "pg-browser");
const SCHEMA = path.resolve("packages", "persistence", "prisma", "schema.prisma");
const PRISMA_CLI = path.resolve("node_modules", "prisma", "build", "index.js");
const DATABASE_URL = `postgresql://kernel_zero_browser:kernel_zero_browser@127.0.0.1:${String(PORT)}/kernel_zero_browser_test`;

rmSync(DATA_DIR, { force: true, recursive: true });
const database = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  password: "kernel_zero_browser",
  persistent: false,
  port: PORT,
  user: "kernel_zero_browser",
});
await database.initialise();
await database.start();
const stop = async () => { try { await database.stop(); } catch { /* the data directory may still be held briefly on Windows */ } };
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => { void stop().then(() => process.exit(0)); });

try {
  await database.createDatabase("kernel_zero_browser_test");
  execFileSync(process.execPath, [PRISMA_CLI, "migrate", "deploy", "--schema", SCHEMA], {
    env: { ...process.env, DATABASE_URL },
    stdio: "inherit",
  });
} catch (error) {
  await stop();
  throw error;
}

// The built server otherwise reports NODE_ENV=production; the browser suite is a test environment and says so explicitly.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = DATABASE_URL;
process.env.KERNEL_ZERO_EVIDENCE_TOKEN ??= "browser-fixture-evidence-token-at-least-32-bytes";

await startServer({
  allowRetry: false,
  dir: path.resolve("apps", "control"),
  hostname: "localhost",
  isDev: false,
  port: 3100,
});
