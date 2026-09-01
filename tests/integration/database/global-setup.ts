import { isolatedTestDatabaseUrl } from "./environment";

export default function globalSetup(): void {
  if (process.env.KERNEL_ZERO_RUN_DATABASE_TESTS !== "1") return;
  isolatedTestDatabaseUrl();
}
