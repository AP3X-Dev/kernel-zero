/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/restrict-template-expressions */
import { describe, expect, it, vi } from "vitest";

import { createAuditRepository, validateAuditRecord } from "./audit";

const base = {
  actionCode: "policy.activated",
  correlationId: "0195f000-0000-7000-8000-000000000001",
  description: "Policy activated.",
  metadata: { revision: 4 },
  subjectId: "policy-a",
  subjectType: "policy",
  workspaceOpaqueId: "0195f000-0000-7000-8000-000000000002",
} as const;

describe("immutable audit persistence", () => {
  it("accepts the operator actor and bounded system actors", () => {
    expect(validateAuditRecord({ ...base, actor: { kind: "operator" } }).ok).toBe(true);
    expect(validateAuditRecord({ ...base, actor: { kind: "system", reference: "billing-provider" } }).ok).toBe(true);
    expect(validateAuditRecord({ ...base, actor: { kind: "system", reference: " " } }).ok).toBe(false);
  });

  it("rejects deep, excessive, and oversized metadata before persistence", () => {
    expect(validateAuditRecord({ ...base, actor: { kind: "system", reference: "maintenance" }, metadata: { deep: { value: true } } as never }).ok).toBe(false);
    expect(validateAuditRecord({ ...base, actor: { kind: "system", reference: "maintenance" }, metadata: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`key${index}`, index])) }).ok).toBe(false);
    expect(validateAuditRecord({ ...base, actor: { kind: "system", reference: "maintenance" }, metadata: { value: "x".repeat(17_000) } }).ok).toBe(false);
  });

  it("writes validated records and exposes only an explicit safe projection", async () => {
    const tx = {
      auditRecord: {
        create: vi.fn().mockResolvedValue({ id: "audit" }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const audit = createAuditRepository(tx as never);
    await audit.append({ ...base, actor: { kind: "operator" } });
    await audit.listSafe({ limit: 25, workspaceOpaqueId: base.workspaceOpaqueId });
    expect(tx.auditRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      actorKind: "operator",
      systemActorRef: null,
    }) }));
    const select = tx.auditRecord.findMany.mock.calls[0]?.[0].select;
    expect(select).not.toHaveProperty("clientAddressHint");
    expect(select).not.toHaveProperty("userAgentHint");
    expect(select).toMatchObject({ actionCode: true, correlationId: true, metadata: true });
  });
});
