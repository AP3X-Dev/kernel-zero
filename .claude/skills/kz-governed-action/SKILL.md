---
name: kz-governed-action
description: Add a new governed server mutation to KERNEL ZERO end to end: action definition, persistence operation, service, transport ingress, audit, tests. Use when asked to "add an action", "add an endpoint", or "let the operator do X" in the control plane.
---

# kz-governed-action

Announce: "Using kz-governed-action; grilling first."

1. Invoke `kz-grill`. Do not continue without its ADR.
2. Read these before writing anything:
   - `apps/control/src/server/governed-actions.ts` (`defineGovernedAction`, `GOVERNED_ACTIONS`, `executeGovernedAction`)
   - `apps/control/src/server/policy/policy-service.ts` as the service template and `apps/control/src/app/api/evidence/v1/runs/route.ts` as the route template
   - `apps/control/src/server/authorization/request-context.ts` (the bearer-token request context every API route resolves)
3. Order of edits, smallest diff first:
   a. Action: `defineGovernedAction("<area>.<verb>", { audit: { actionCode, description, subjectType }, idempotency, tenantScope: "workspace", transactionTimeoutMs })`. All four metadata fields, no omissions.
   b. Persistence operation inside `runSerializableTransaction`, using the tenant-scoped repository set. Every selector takes `workspaceId`. The audit actor is `{ kind: "operator" }` or `{ kind: "system", reference }`.
   c. Application service: parse anything untrusted, then the operation. No Prisma import.
   d. Transport route: resolve `resolveRequestContext` first, parse with a strict Zod schema at ingress, call exactly one service, map errors through the existing error helpers. No persistence import: neither @kernel-zero/persistence nor @prisma/client, at any layer above the service. "For performance" is not an exception; put the query in the repository set and call one service.
   e. UI only if the ADR asks for it, and only through the application service.
4. Tests, in this order: service test with a fake repository (see `policy-service.test.ts`), governed-action registry test (`governed-actions.test.ts` already asserts closed metadata), route test if one exists for the template route.
5. Gate:

```text
npm run verify
```
Expected exit 0. Quote the unit-test count and the self-policy result in the report. If `governed-actions-have-closed-metadata` fails, the definition is missing a field; fix the definition, never the rule.
6. Regenerate traceability if an FR-ID was added: `npm run traceability:generate`.

Never: skip the request context on a route, import @kernel-zero/persistence or @prisma/client from a route, page, or layout (rules ui-does-not-import-persistence, transport-does-not-import-repositories, raw-database-client-is-contained), or add a network call to the control plane.
