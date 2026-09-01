import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { isUuidV7 } from "@kernel-zero/domain";

import { proxy } from "./proxy";

describe("request correlation proxy", () => {
  it("preserves one valid correlation ID on the downstream request and response", () => {
    const id = "0195f000-0000-7000-8000-000000000001";
    const response = proxy(new NextRequest("https://example.test/app", { headers: { "x-correlation-id": id } }));
    expect(response.headers.get("x-correlation-id")).toBe(id);
    expect(response.headers.get("x-middleware-request-x-correlation-id")).toBe(id);
  });

  it("replaces invalid input with a generated UUIDv7 without echoing it", () => {
    const response = proxy(new NextRequest("https://example.test/app", { headers: { "x-correlation-id": "unsafe" } }));
    const id = response.headers.get("x-correlation-id");
    expect(isUuidV7(id)).toBe(true);
    expect(id).not.toBe("unsafe");
    expect(response.headers.get("x-middleware-request-x-correlation-id")).toBe(id);
  });
});
