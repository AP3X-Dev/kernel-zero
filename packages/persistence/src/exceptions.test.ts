/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { describe, expect, it, vi } from "vitest";

import { decideException, isExceptionApplicable, requestException, revokeException } from "./exceptions";

const WORKSPACE = "0195f000-0000-7000-8000-000000000002";
const CORRELATION = "0195f000-0000-7000-8000-000000000001";
const DIGEST = `sha256:${"1".repeat(64)}`;
const FINGERPRINT = `sha256:${"2".repeat(64)}`;
function client(tx: object) { return { $transaction: vi.fn(async (operation) => operation(tx)) } as never; }

describe("exception lifecycle", () => {
  it("binds a request to an exact approved policy and caps expiry at 90 days", async () => {
    const tx = { auditRecord: { create: vi.fn() }, exceptionRequest: { create: vi.fn().mockResolvedValue({ id: "exception" }) }, policyRevision: { findFirst: vi.fn().mockResolvedValue({ id: "revision" }) } };
    const base = { correlationId: CORRELATION, findingFingerprint: FINGERPRINT, policyDigest: DIGEST, rationale: "Temporary migration.", ruleId: "rule-one", workspaceId: WORKSPACE };
    await expect(requestException(client(tx), { ...base, validUntil: new Date("2026-12-01T00:00:00Z") }, new Date("2026-08-31T00:00:00Z"))).rejects.toThrow("validUntil");
    await expect(requestException(client(tx), { ...base, validUntil: new Date("2026-09-30T00:00:00Z") }, new Date("2026-08-31T00:00:00Z"))).resolves.toMatchObject({ id: "exception" });
  });

  it("decides only a pending request in the write predicate under races", async () => {
    const updateMany = vi.fn<(input: { where: { decisionState: string } }) => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });
    const tx = { auditRecord: { create: vi.fn() }, exceptionRequest: { findFirst: vi.fn().mockResolvedValue({ id: "exception" }), updateMany } };
    const base = { correlationId: CORRELATION, decision: "approved" as const, decisionNote: "Reviewed and bounded.", exceptionId: "exception", workspaceId: WORKSPACE };
    await decideException(client(tx), base);
    expect(updateMany.mock.calls[0]?.[0].where).toMatchObject({ decisionState: "pending", workspaceId: WORKSPACE });
  });

  it("revokes only an active approval with a reason and exact matching controls applicability", async () => {
    const updateMany = vi.fn<(input: { where: { decisionState: string; revokedAt: null } }) => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });
    const tx = { auditRecord: { create: vi.fn() }, exceptionRequest: { updateMany } };
    await revokeException(client(tx), { correlationId: CORRELATION, exceptionId: "exception", reason: "Risk changed.", workspaceId: WORKSPACE });
    expect(updateMany.mock.calls[0]?.[0].where).toMatchObject({ decisionState: "approved", revokedAt: null });
    const grant = { decisionState: "approved", findingFingerprint: FINGERPRINT, policyDigest: DIGEST, revokedAt: null, ruleId: "rule-one", validUntil: new Date("2026-10-01T00:00:00Z"), workspaceId: WORKSPACE };
    expect(isExceptionApplicable(grant, { findingFingerprint: FINGERPRINT, policyDigest: DIGEST, ruleId: "rule-one", workspaceId: WORKSPACE }, new Date("2026-09-01T00:00:00Z"))).toBe(true);
    expect(isExceptionApplicable(grant, { findingFingerprint: FINGERPRINT, policyDigest: `sha256:${"9".repeat(64)}`, ruleId: "rule-one", workspaceId: WORKSPACE }, new Date("2026-09-01T00:00:00Z"))).toBe(false);
  });
});
