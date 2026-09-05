import { describe, expect, it } from "vitest";

import { createWorkspaceTrustBundle } from "@kernel-zero/contracts";

import { createTrustBundleGetHandler, type TrustBundleRouteDependencies } from "./route";

const WORKSPACE = "0195f000-0000-7000-8000-000000000002";
const bundle = createWorkspaceTrustBundle({
  keys: [{ crv: "Ed25519", keyId: "authority-1", kty: "OKP", revokedFrom: null, validFrom: "2026-01-01T00:00:00.000Z", validUntil: null, x: "A".repeat(43) }],
  revision: 1,
  workspace: WORKSPACE,
});

function dependencies(overrides: Partial<TrustBundleRouteDependencies> = {}, capabilities: string[] = ["policy.read"]): TrustBundleRouteDependencies {
  return {
    loadBundle: () => Promise.resolve(bundle),
    resolveContext: () => Promise.resolve({
      context: {
        actor: { capabilityDocument: { capabilities }, isOwner: false, userId: "user-1" },
        correlationId: "0195f000-0000-7000-8000-000000000004",
        workspaceId: WORKSPACE,
      },
      kind: "ok",
    }),
    ...overrides,
  };
}

const request = () => new Request("https://example.invalid/api/custody/v1/trust-bundle");

describe("GET /api/custody/v1/trust-bundle", () => {
  it("requires a session and a workspace", async () => {
    const unauthenticated = await createTrustBundleGetHandler(dependencies({ resolveContext: () => Promise.resolve({ kind: "unauthenticated" }) }))(request());
    expect(unauthenticated.status).toBe(401);
    const noWorkspace = await createTrustBundleGetHandler(dependencies({ resolveContext: () => Promise.resolve({ kind: "workspace-required" }) }))(request());
    expect(noWorkspace.status).toBe(403);
  });

  it("requires policy.read and returns 404 when the workspace has no authority keys", async () => {
    const forbidden = await createTrustBundleGetHandler(dependencies({}, ["evidence.read"]))(request());
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({ error: { code: "FORBIDDEN", correlationId: "0195f000-0000-7000-8000-000000000004" } });
    const empty = await createTrustBundleGetHandler(dependencies({ loadBundle: () => Promise.resolve(null) }))(request());
    expect(empty.status).toBe(404);
  });

  it("serves the canonical bundle with its media type, no caching, and the correlation id", async () => {
    const response = await createTrustBundleGetHandler(dependencies())(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.kernel-zero.workspace-trust+json;version=1");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-correlation-id")).toBe("0195f000-0000-7000-8000-000000000004");
    await expect(response.json()).resolves.toEqual(bundle);
  });

  it("hides internal failures behind a safe envelope", async () => {
    const response = await createTrustBundleGetHandler(dependencies({ loadBundle: () => Promise.reject(new Error("database down")) }))(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: "INTERNAL_ERROR", correlationId: "0195f000-0000-7000-8000-000000000004", message: "The request could not be completed." } });
  });
});
