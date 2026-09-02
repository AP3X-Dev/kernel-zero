import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

import EmbeddedPostgres from "embedded-postgres";

import { isolatedTestDatabaseUrl } from "./environment";

// ponytail: 54329 collides with an unrelated local dev server (embedded-postgres
// default+offset convention) discovered empirically on this machine; 55329 avoids it.
const PORT = 55329;
const DATA_DIR = resolve(".kernel-zero", "pg-test");
const SCHEMA = resolve("packages", "persistence", "prisma", "schema.prisma");
const PRISMA_CLI = resolve("node_modules", "prisma", "build", "index.js");

function migrate(databaseUrl: string): void {
  execFileSync(process.execPath, [PRISMA_CLI, "migrate", "deploy", "--schema", SCHEMA], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
}

export default async function globalSetup(): Promise<(() => Promise<void>) | undefined> {
  const configured = process.env.TEST_DATABASE_URL?.trim();
  if (configured !== undefined && configured.length > 0) {
    migrate(isolatedTestDatabaseUrl());
    return undefined;
  }
  rmSync(DATA_DIR, { force: true, recursive: true });
  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    password: "kernel_zero_test",
    persistent: false,
    port: PORT,
    user: "kernel_zero_test",
  });
  await server.initialise();
  await server.start();
  try {
    await server.createDatabase("kernel_zero_test");
    const url = `postgresql://kernel_zero_test:kernel_zero_test@127.0.0.1:${String(PORT)}/kernel_zero_test`;
    process.env.TEST_DATABASE_URL = url;
    migrate(isolatedTestDatabaseUrl());
  } catch (error: unknown) {
    // A failed migration must not leave a postgres process behind; stop() also removes the non-persistent data dir.
    await server.stop();
    throw error;
  }
  return () => server.stop();
}
