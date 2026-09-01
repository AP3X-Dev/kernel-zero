# Isolated PostgreSQL tests

Database integration tests are opt-in. Set `KERNEL_ZERO_RUN_DATABASE_TESTS=1`
and provide `TEST_DATABASE_URL` whose database or schema name contains `test`.
The harness rejects production-shaped database targets before migrations or
fixtures can run. Tests must create UUIDv7 identifiers in application code and
must never reuse the normal `DATABASE_URL` implicitly.
