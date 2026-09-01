import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { safeLocalCallback } from "./callback";

describe("safeLocalCallback", () => {
  it.each([
    [undefined, "/app"],
    [null, "/app"],
    ["", "/app"],
    ["https://example.test/app", "/app"],
    ["//example.test", "/app"],
    ["/\\example.test", "/app"],
    ["/app next", "/app"],
    [" /workspace/policies?tab=active ", "/workspace/policies?tab=active"],
  ])("maps %s to %s", (input, expected) => {
    expect(safeLocalCallback(input)).toBe(expected);
  });

  it("never returns an unsafe generated value", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = safeLocalCallback(input);
        expect(result.startsWith("/")).toBe(true);
        expect(result.startsWith("//")).toBe(false);
        expect(result.startsWith("/\\")).toBe(false);
        for (const character of result) {
          const code = character.charCodeAt(0);
          expect(code > 32 && code !== 127).toBe(true);
        }
      }),
    );
  });
});
