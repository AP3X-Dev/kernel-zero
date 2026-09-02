# Isolated PostgreSQL tests

`npm run test:integration` runs the gate suites for real. When `TEST_DATABASE_URL`
is set, it migrates and runs against that server. Otherwise `global-setup.ts`
starts an embedded PostgreSQL server (via `embedded-postgres`) in
`.kernel-zero/pg-test`, migrates it, and stops and deletes it afterward.
Whichever database is used, its database or schema name must contain `test`
— the harness rejects production-shaped database targets before migrations or
fixtures can run. Tests must create UUIDv7 identifiers in application code and
must never reuse the normal `DATABASE_URL` implicitly.
