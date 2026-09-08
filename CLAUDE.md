# KERNEL ZERO engineering rules

Every rule here is binding. When a rule and a request conflict, say so and stop.

## 1. Build into the architecture that exists

This repository is a policy-first governance kernel with a compile-time profile seam. Your job is to extend it, not to reinvent it. Before writing anything new, find the existing pattern and follow it. The patterns are:

- Kernel packages: `packages/domain` (pure primitives), `packages/contracts` (strict Zod schemas, public wire formats), `packages/persistence` (Prisma, workspace-scoped repositories, transactions). The workspace identifier is the configured `KERNEL_ZERO_WORKSPACE_ID` constant; there is one operator and no identity, tenancy, billing, or quota layer (ADR 2026-09-08-single-operator-kernel).
- Profiles: `packages/profile-*` own a policy schema, an evidence schema, a checker, and compatibility rules. `packages/profiles` registers them. Kernel packages never import a profile; the self-policy enforces it.
- Control plane: `apps/control/src/server/*` holds application services, `apps/control/src/app/api/**` holds transport routes, `apps/control/src/app/**` holds server-rendered pages.
- Validator: `packages/validator` is a standalone, network-free CLI over the TypeScript compiler API.

Only when no existing seam can carry the feature do you add one, and then it goes through `kz-grill` first.

## 2. Search before you create

Every type, schema, helper, message code, configuration key, and rule id you need most likely exists. Find it before writing it:

1. `grep -rl <symbol> packages apps` to list candidate files, then read only those.
2. Package barrels are the public surface: `packages/*/src/index.ts`. If a symbol is not exported there, it is private to that package on purpose.
3. Rule ids live in `kernel-zero.policy.json`; governed actions in `apps/control/src/server/governed-actions.ts`; configuration keys in `apps/control/src/server/config/config.ts`.

Never duplicate a schema, type, or helper because searching felt slow. Never add a dependency for something a few lines or an installed package already does.

## 3. The layered request path

1. **Transport route** (`apps/control/src/app/api/**`): resolve the request context (bearer token, workspace, correlation id) with `resolveRequestContext`, parse the body with the strict contract schema, call exactly one application service, map errors through the existing error helpers. Routes never import `@kernel-zero/persistence` or `@prisma/client`.
2. **Application service** (`apps/control/src/server/<area>/`): `import "server-only"` first. Parse anything untrusted before any lookup. Hold the business decisions. No raw Prisma.
3. **Governed action**: every mutation is declared with `defineGovernedAction` and all four fields: `audit`, `idempotency`, `tenantScope`, `transactionTimeoutMs`. Audit is written in the same serializable transaction as the write or the mutation rolls back. The audit actor is `{ kind: "operator" }` or `{ kind: "system", reference }`.
4. **Persistence** (`packages/persistence`): the only layer that touches the database. Every tenant selector takes `workspaceId`. Missing and sibling-tenant objects both return the same not-found.
5. **Profile logic** stays in the profile package. Kernel services look up the profile by policy `kind` through `@kernel-zero/profiles` and never import a profile directly.

Pages read through application view functions and never import persistence.

## 4. Types and TypeScript

- `strictTypeChecked` lint is on. `any` is banned. `unknown` is fine where the codebase already uses it: values entering a parse boundary (narrowed by a Zod parse before use), caught errors narrowed by a type guard, hand-written domain guards, and JSON-schema return values. Never use it to skip narrowing.
- Types come from Zod inference in `packages/contracts` or from Prisma. Do not hand-write a type that a schema already infers. Domain-only types live in `packages/domain`.
- Prefer `Readonly<>` inputs and frozen objects, matching the existing code.
- Run `npm run typecheck` before handing anything over. Never report a gate you did not run.

## 5. Validate every input at the boundary

Every route, page action, CLI argument, and stored document must be parsed by a strict Zod schema (`z.strictObject`, closed enums, bounded strings) before a service sees it. Only the evidence ingress is lint-enforced (rule `public-evidence-is-parsed`); every other boundary relies on you. Definite violations fail closed. Optional external context never becomes the authority.

Changing a public contract (`kernel-zero.dev/v1` policy, `kernel-zero.dev/evidence/v1` evidence, exception bundles) changes what stored artifacts still parse and, for content inside the digest composition, invalidates re-validation of every stored run. Policy digests are computed over the schema-parsed policy, so adding a schema default moves the digest of an unchanged policy file and every fingerprint under it. Treat any such change as breaking until `npm run contracts:check` and the kz-grill contract question say otherwise.

## 6. Comments

Comment the outcome, not the code. A deliberate simplification with a known ceiling gets a `// ponytail:` note naming the ceiling and the upgrade path. Do not introduce a new comment convention.

## 7. UI

- Pages are server components and read through `workspaceRoute()`. Forms post to server actions. There are no client components today; if a form needs pending or confirmation state, add exactly one shared client component beside `ui-components.tsx` and reuse it. No client state library.
- Reusable pieces live in `apps/control/src/app/app/ui-components.tsx`; route-local pieces sit beside their route. Extend or compose an existing component before adding a similar one.
- Colors come only from the tokens in `apps/control/src/app/globals.css` (`--canvas`, `--surface`, `--ink`, `--muted`, `--line`, `--brand`, `--positive`, `--warning`, `--danger`, `--focus`). No literal hex values, no forced theme classes.
- Every primary route must keep passing the keyboard and axe checks in `npm run test:browser`.

## 8. Delivery and gates

- The gate is `npm run verify` on Node 22. Exit 0 is the only pass. Quote the unit-test count and the self-policy result in your report.
- After adding a rule or check kind, prove it bites: introduce the violation, watch `npm run validator:self` exit 1, revert.
- Adding a profile must leave `git diff --stat -- packages/domain packages/contracts packages/persistence` empty.
- No scripts, seeds, or probe files that could not ship. Anything under `scripts/` that mutates state needs the user's explicit permission first.
- Finish the whole feature. If a piece is missing, finish it or name it explicitly in the report.
- Git: commit only when asked. Stage files explicitly, never `git add -A`. Plain developer language in messages, no attribution trailers. Never push, open a PR, merge, deploy, or touch production credentials; those are the user's checkpoints.

## 9. Skills

Use the project skills in `.claude/skills` for their triggers: `kz-grill` before any design decision, `kz-governed-action`, `kz-policy-rule`, `kz-profile` for the corresponding changes, `kz-adopt` for consumer repositories. After a builder skill reports done, run the `kz-checker` agent.

## 10. Clean room

This codebase was built clean-room from a requirements document, not from another product's code. If a local, untracked `clean-room/` directory exists, its `PRP.md` is the requirements authority and the reference repository it names must not be opened, searched, or quoted. Otherwise the current source and its executable checks are the authority.
