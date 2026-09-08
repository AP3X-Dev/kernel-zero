import "server-only";

import { createPersistenceClient } from "@kernel-zero/persistence";

import { loadConfig } from "./config/config";

type Runtime = Readonly<{
  config: ReturnType<typeof loadConfig>;
  prisma: ReturnType<typeof createPersistenceClient>;
}>;

let singleton: Runtime | undefined;

export function getRuntime(): Runtime {
  if (singleton !== undefined) return singleton;
  const config = loadConfig(process.env);
  singleton = Object.freeze({ config, prisma: createPersistenceClient(config.databaseUrl) });
  return singleton;
}
