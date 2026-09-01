# KERNEL ZERO

KERNEL ZERO is a policy-first governance kernel and control plane. Its first
profile governs software architecture through versioned policy, deterministic
repository validation, maker-checker decisions, controlled exceptions, and
tamper-evident verification records.

The repository is a single TypeScript monorepo. Shared identity, tenancy,
authorization, policy, exception, audit, and evidence primitives live beside
the control application and deterministic validator. Additional profiles can
reuse those primitives without creating separate products or control planes.

## Local start

Requirements: Node 22, npm 10 or newer, and PostgreSQL.

```text
npm ci
npm run prisma:generate
npx prisma migrate deploy --schema packages/persistence/prisma/schema.prisma
npm run dev
```

Copy `.env.example` to `.env` and replace every local-only value before using a
shared environment. The application is served at `http://127.0.0.1:3000` by
default.

## Deterministic enforcement

```text
npm run validator:self
npm run verify
```

The validator writes `.kernel-zero/evidence.json`. See
`docs/validator-and-hooks.md` for pre-commit, coding-host, and CI custody
examples. The validator never uploads repository source.

## Project boundaries

- The web application is a control plane; it does not execute repository code.
- Local validation is deterministic and network-free.
- Definite policy violations fail closed. Optional external context must not be
  treated as the policy authority.
- Local hooks improve feedback; protected CI is the merge gate.
- External publication, pull-request creation, merge, deployment, and
  production credential use require separate human approval.

## License

KERNEL ZERO is available under the [MIT License](LICENSE).
