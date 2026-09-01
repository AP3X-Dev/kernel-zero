import { describe, expect, it, vi } from "vitest";

import { BillingSignatureError } from "../../../../server/billing";
import { createBillingEventPostHandler } from "./route";

const CORRELATION = "0195f000-0000-7000-8000-000000000001";
const parsed = {
  event: {
    eventId: "evt_1",
    eventType: "charge.refunded",
    providerCreatedAt: new Date("2026-08-31T12:00:00.000Z"),
  },
  payloadDigest: `sha256:${"1".repeat(64)}`,
  resolvePlan: () => null,
};

describe("billing event route", () => {
  it("returns 503 when billing is absent without attempting to parse", async () => {
    const parseSignedEvent = vi.fn();
    const handler = createBillingEventPostHandler({ configured: () => false, parseSignedEvent, persist: vi.fn() });
    const response = await handler(new Request("http://localhost/api/billing/events", { method: "POST" }));
    expect(response.status).toBe(503);
    expect(parseSignedEvent).not.toHaveBeenCalled();
  });

  it("passes the raw body to signature verification and acknowledges handled states", async () => {
    const parseSignedEvent = vi.fn().mockResolvedValue(parsed);
    const persist = vi.fn().mockResolvedValue({ kind: "quarantined", reason: "workspace_mapping_missing", receiptId: "receipt-1" });
    const handler = createBillingEventPostHandler({ configured: () => true, parseSignedEvent, persist });
    const response = await handler(new Request("http://localhost/api/billing/events", {
      body: "raw-provider-body",
      headers: { "stripe-signature": "signed", "x-correlation-id": CORRELATION },
      method: "POST",
    }));
    expect(response.status).toBe(200);
    expect(parseSignedEvent).toHaveBeenCalledWith(new TextEncoder().encode("raw-provider-body"), "signed");
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ correlationId: CORRELATION, payloadDigest: parsed.payloadDigest }));
  });

  it("returns 400 for invalid signatures and 500 for retryable persistence failures", async () => {
    const invalid = createBillingEventPostHandler({
      configured: () => true,
      parseSignedEvent: vi.fn().mockRejectedValue(new BillingSignatureError()),
      persist: vi.fn(),
    });
    const request = () => new Request("http://localhost/api/billing/events", {
      body: "raw", headers: { "stripe-signature": "bad" }, method: "POST",
    });
    expect((await invalid(request())).status).toBe(400);

    const retryable = createBillingEventPostHandler({
      configured: () => true,
      parseSignedEvent: vi.fn().mockResolvedValue(parsed),
      persist: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    expect((await retryable(request())).status).toBe(500);
  });
});
