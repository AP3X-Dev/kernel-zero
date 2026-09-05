import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import EmbeddedPostgres from "embedded-postgres";
import { startServer } from "next/dist/server/lib/start-server.js";

// The browser suite runs the production build against a throwaway embedded PostgreSQL with one
// verified fixture account, so authenticated journeys can sign in through the real form. The
// account exists only in this disposable database; nothing here touches a real environment.
const PORT = 55330;
const DATA_DIR = path.resolve(".kernel-zero", "pg-browser");
const SCHEMA = path.resolve("packages", "persistence", "prisma", "schema.prisma");
const PRISMA_CLI = path.resolve("node_modules", "prisma", "build", "index.js");
const DATABASE_URL = `postgresql://kernel_zero_browser:kernel_zero_browser@127.0.0.1:${String(PORT)}/kernel_zero_browser_test`;

export const BROWSER_FIXTURE_ACCOUNT = Object.freeze({
  email: "browser-owner@example.test",
  password: "browser-fixture-password-2026",
});

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
  await seedFixtureAccount();
} catch (error) {
  await stop();
  throw error;
}

// The built server otherwise reports NODE_ENV=production, and production configuration rightly refuses an
// HTTP app URL and the local outbox. The browser suite is a test environment and says so explicitly.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = DATABASE_URL;
process.env.KERNEL_ZERO_APP_URL ??= "http://localhost:3100";
process.env.KERNEL_ZERO_IDENTITY_SECRET ??= "browser-fixture-identity-secret-at-least-32-bytes";
process.env.KERNEL_ZERO_REGISTRATION_OPEN ??= "true";
process.env.KERNEL_ZERO_EMAIL_MODE ??= "local-outbox";

await startServer({
  allowRetry: false,
  dir: path.resolve("apps", "control"),
  hostname: "localhost",
  isDev: false,
  port: 3100,
});

async function seedFixtureAccount() {
  const { PrismaClient } = await import("@prisma/client");
  const { hashPassword } = await import(pathToFileURL(path.resolve("apps", "control", "node_modules", "better-auth", "dist", "crypto", "index.mjs")).href);
  const { generateUuidV7 } = await import(pathToFileURL(path.resolve("packages", "domain", "src", "uuid.ts")).href).catch(() => ({ generateUuidV7: undefined }));
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  try {
    const userId = uuidV7(generateUuidV7);
    await prisma.user.create({ data: {
      displayName: "Browser Owner", email: BROWSER_FIXTURE_ACCOUNT.email, emailVerified: true, id: userId, normalizedEmail: BROWSER_FIXTURE_ACCOUNT.email,
    } });
    await prisma.account.create({ data: {
      accountId: userId, id: uuidV7(generateUuidV7), password: await hashPassword(BROWSER_FIXTURE_ACCOUNT.password), providerId: "credential", userId,
    } });
  } finally {
    await prisma.$disconnect();
  }
}

// ponytail: a plain UUIDv7 generator so the seed does not depend on TypeScript sources being loadable from a .mjs script.
function uuidV7(preferred) {
  if (typeof preferred === "function") return preferred();
  const time = Date.now().toString(16).padStart(12, "0");
  const random = [...crypto.getRandomValues(new Uint8Array(10))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${random.slice(0, 3)}-${(8 + (parseInt(random.slice(3, 4), 16) & 3)).toString(16)}${random.slice(4, 7)}-${random.slice(7, 19)}`;
}
