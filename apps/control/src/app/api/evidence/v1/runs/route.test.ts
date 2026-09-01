import { describe, expect, it } from "vitest";

import { createEvidencePostHandler, type EvidenceRouteDependencies } from "./route";

const mediaType = "application/vnd.kernel-zero.evidence+json;version=1";
const context = {
  actor: { capabilityDocument: { capabilities: ["evidence.submit"] }, isOwner: false as const, userId: "user-1" },
  correlationId: "0195f000-0000-7000-8000-000000000004",
  workspaceId: "0195f000-0000-7000-8000-000000000002",
};

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://example.invalid/api/evidence/v1/runs", {
    body: "{}",
    headers: { "content-type": mediaType, ...headers },
    method: "POST",
  });
}

function dependencies(kind: "created" | "duplicate" = "created"): EvidenceRouteDependencies {
  return {
    resolveSubmission: () => Promise.resolve(context),
    service: { submit: () => Promise.resolve({ attestationState: "recorded", kind, runId: "0195f000-0000-7000-8000-000000000001" }) },
  };
}

describe("POST /api/evidence/v1/runs", () => {
  it("requires an authenticated workspace submission context", async () => {
    const response = await createEvidencePostHandler({ ...dependencies(), resolveSubmission: () => Promise.resolve(null) })(request());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("maps created and idempotent duplicate submissions", async () => {
    const created = await createEvidencePostHandler(dependencies("created"))(request());
    expect(created.status).toBe(201);
    const duplicate = await createEvidencePostHandler(dependencies("duplicate"))(request());
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ kind: "duplicate" });
  });

  it("preserves 415 transport semantics and safe error envelopes", async () => {
    const response = await createEvidencePostHandler(dependencies())(request({ "content-encoding": "br" }));
    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_EVIDENCE", correlationId: context.correlationId, message: "The evidence document is invalid." },
    });
  });
});
