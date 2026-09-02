import { describe, expect, it } from "vitest";

import config, { contentSecurityPolicy } from "./next.config";

describe("control-plane response headers", () => {
  it("applies a restrictive baseline to every route without advertising the framework", async () => {
    expect(config.poweredByHeader).toBe(false);
    if (config.headers === undefined) throw new Error("Expected security headers.");
    const entries = await config.headers();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.source).toBe("/:path*");
    const headers = new Map(entries[0]?.headers.map((header) => [header.key, header.value]));
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("Content-Security-Policy")).toContain("object-src 'none'");
    expect(headers.get("Permissions-Policy")).toBe("camera=(), geolocation=(), microphone=()");
    expect(headers.get("Referrer-Policy")).toBe("same-origin");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("allows eval only for the development runtime", () => {
    expect(contentSecurityPolicy("development")).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(contentSecurityPolicy("production")).toContain("script-src 'self' 'unsafe-inline';");
    expect(contentSecurityPolicy("production")).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy(undefined)).not.toContain("unsafe-eval");
  });
});
