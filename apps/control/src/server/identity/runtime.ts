import "server-only";

import { createPersistenceClient } from "@kernel-zero/persistence";

import { loadConfig } from "../config/config";
import { DevelopmentOutbox } from "../email/outbox";
import { createAuth, type KernelZeroAuth } from "./auth";
import { createIdentityEmailSender } from "./email";
import type { IdentityEmailSender } from "./email";

type Runtime = Readonly<{
  auth: KernelZeroAuth;
  config: ReturnType<typeof loadConfig>;
  emailSender: IdentityEmailSender;
  outbox: DevelopmentOutbox;
  prisma: ReturnType<typeof createPersistenceClient>;
}>;

let singleton: Runtime | undefined;

export function getRuntime(): Runtime {
  if (singleton !== undefined) return singleton;
  const config = loadConfig(process.env);
  const prisma = createPersistenceClient(config.databaseUrl);
  const outbox = new DevelopmentOutbox(config.environment);
  const emailSender = createIdentityEmailSender(config, outbox);
  const auth = createAuth(prisma, config, emailSender);
  singleton = Object.freeze({ auth, config, emailSender, outbox, prisma });
  return singleton;
}

export function getAuth(): KernelZeroAuth {
  return getRuntime().auth;
}
