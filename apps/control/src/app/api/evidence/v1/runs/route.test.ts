import { describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const mediaType = "application/vnd.kernel-zero.evidence+json;version=1";
const evidenceToken = "test-evidence-token-with-at-least-32-characters";
const workspaceId = "0195f000-0000-7000-8000-000000000002";
const correlationId = "0195f000-0000-7000-8000-000000000004";
const runId = "0195f000-0000-7000-8000-000000000001";

const { submit } = vi.hoisted(() => ({ submit: vi.fn() }));

vi.mock("../../../../../server/runtime", () => ({
  getRuntime: () => ({
    config: { databaseUrl: "postgresql://unused", environment: "test", evidenceToken, workspaceId },
    prisma: {},
  }),
}));

vi.mock("../../../../../server/evidence/evidence-service", () => ({
  EvidenceService: class {
    submit = submit;
  },
}));

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://example.invalid/api/evidence/v1/runs", {
    body: "{}",
    headers: { authorization: `Bearer ${evidenceToken}`, "content-type": mediaType, "x-correlation-id": correlationId, ...headers },
    method: "POST",
  });
}

describe("POST /api/evidence/v1/runs", () => {
  it("requires the evidence bearer token", async () => {
    const response = await POST(new Request("https://example.invalid/api/evidence/v1/runs", { body: "{}", headers: { "content-type": mediaType }, method: "POST" }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "UNAUTHENTICATED", correlationId: "unavailable" } });
    expect(submit).not.toHaveBeenCalled();
  });

  it("maps created and idempotent duplicate submissions", async () => {
    submit.mockResolvedValueOnce({ attestationState: "recorded", kind: "created", runId });
    const created = await POST(request());
    expect(created.status).toBe(201);
    expect(submit).toHaveBeenCalledWith({ correlationId, document: {}, workspaceId });

    submit.mockResolvedValueOnce({ attestationState: "recorded", kind: "duplicate", runId });
    const duplicate = await POST(request());
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ kind: "duplicate" });
  });

  it("preserves 415 transport semantics and safe error envelopes", async () => {
    const response = await POST(request({ "content-encoding": "br" }));
    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_EVIDENCE", correlationId, message: "The evidence document is invalid." },
    });
  });
});
