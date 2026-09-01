import { describe, expect, it } from "vitest";

import { redactForLog } from "./redaction";

describe("production-safe structured log projection", () => {
  it("redacts secrets, action links, request bodies, cookies, and authorization", () => {
    expect(
      redactForLog({
        authorization: "Bearer secret",
        cookie: "session=secret",
        nested: { actionLink: "https://example.test/reset?token=secret", outcome: "denied" },
        password: "secret",
        rawBody: "provider-payload",
      }),
    ).toEqual({
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      nested: { actionLink: "[REDACTED]", outcome: "denied" },
      password: "[REDACTED]",
      rawBody: "[REDACTED]",
    });
  });
});
