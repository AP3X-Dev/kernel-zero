---
name: kz-governed-action
description: Add a new governed server capability to KERNEL ZERO end to end: action definition, service, transport ingress, capability, quota, audit, tests. Use when asked to "add an action", "add an endpoint", "add a capability", or "let users do X" in the control plane.
---

# kz-governed-action

Announce: "Using kz-governed-action; grilling first."

1. Invoke `kz-grill`. Do not continue without its ADR.
2. Read these before writing anything:
   - `apps/control/src/server/governed-actions.ts` (`defineGovernedAction`, `GOVERNED_ACTIONS`)
   - `packages/domain/src/authorization.ts` (`CAPABILITIES`, groups, owner-only set)
   - `packages/domain/src/entitlements.ts` (`QuotaKey`, `EntitlementAction`)
   - one existing service pair as the template: `apps/control/src/server/exception/exception-service.ts` and its route under `apps/control/src/app/api/`
3. Order of edits, smallest diff first:
   a. Capability: add to `CAPABILITIES` and to the right group and default role labels. Owner-only if it changes tenancy or keys.
   b. Action: `defineGovernedAction("<area>.<verb>", { audit: { actionCode, description, subjectType }, capability, idempotency, quota, tenantScope: "workspace", transactionTimeoutMs })`. All five metadata fields, no nulls unless the ADR justifies it.
   c. Persistence operation inside `runSerializableTransaction`, using the tenant-scoped repository set. Every selector takes `workspaceId`.
   d. Application service: `requireCapability` first, then the operation. No Prisma import.
   e. Transport route: parse with a strict Zod schema at ingress, call exactly one service, map errors through the existing error helpers. No persistence import.
   f. UI only if the ADR asks for it, and only through the application service.
4. Tests, in this order: service test with a fake repository (see `exception-service.test.ts`), governed-action registry test (`governed-actions.test.ts` already asserts closed metadata), route test if one exists for the template route.
5. Gate:

```text
npm run verify
```
Expected exit 0. Quote the unit-test count and the self-policy result in the report. If `governed-actions-have-closed-metadata` fails, the definition is missing a field; fix the definition, never the rule.
6. Regenerate traceability if an FR-ID was added: `npm run traceability:generate`.

Never: bypass `requireCapability`, import `@kernel-zero/persistence` from a route or page, add a `quota: null` without an ADR line, or add a network call to the control plane.
