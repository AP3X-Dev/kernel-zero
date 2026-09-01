export function isolatedTestDatabaseUrl(
  source: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value = source.TEST_DATABASE_URL?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error("TEST_DATABASE_URL is required for database integration tests.");
  }
  const url = new URL(value);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("TEST_DATABASE_URL must use PostgreSQL.");
  }
  const databaseName = url.pathname.slice(1).toLowerCase();
  const schema = url.searchParams.get("schema")?.toLowerCase() ?? "";
  if (!databaseName.includes("test") && !schema.includes("test")) {
    throw new Error("TEST_DATABASE_URL must name an isolated test database or schema.");
  }
  return value;
}
