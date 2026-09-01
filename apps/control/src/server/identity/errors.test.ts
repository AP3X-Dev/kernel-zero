import { describe, expect, it } from "vitest";

import { mapIdentityFailure } from "./errors";

describe("mapIdentityFailure", () => {
  it.each([
    [{ statusCode: 401, token: "must-not-escape" }, "UNAUTHENTICATED"],
    [{ code: "SIGNUP_DISABLED", password: "must-not-escape" }, "FORBIDDEN"],
    [{ code: "INVALID_TOKEN", authorization: "must-not-escape" }, "UNAUTHENTICATED"],
    [{ status: 409, cookie: "must-not-escape" }, "CONFLICT"],
    [{ status: 429 }, "RATE_LIMITED"],
    [new Error("link-with-token"), "PROVIDER_UNAVAILABLE"],
  ])("maps provider failures to stable application errors", (failure, code) => {
    const mapped = mapIdentityFailure("account", failure);
    expect(mapped.code).toBe(code);
    expect(JSON.stringify(mapped)).not.toContain("must-not-escape");
    expect(JSON.stringify(mapped)).not.toContain("link-with-token");
  });
});
