import { describe, expect, it } from "vitest";

import { canonicalJson } from "./canonical";
import { resolveCorrelationId } from "./correlation";
import { canonicalSha256, digestBytes, isSha256Digest, sha256 } from "./digest";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, parsePagination } from "./pagination";
import { normalizeRelativePath } from "./path";
import { generateUuidV7, isUuidV7, parseUuidV7 } from "./uuid";

describe("canonical JSON and SHA-256", () => {
  it("sorts object keys recursively and uses ECMAScript number serialization", () => {
    const value = {
      z: [Number("333333333.33333329"), 1e30, 4.5, 0.002, 1e-27],
      a: { b: true, a: null },
    };
    expect(canonicalJson(value)).toBe(
      '{"a":{"a":null,"b":true},"z":[333333333.3333333,1e+30,4.5,0.002,1e-27]}',
    );
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("rejects values outside the JSON data model", () => {
    expect(() => canonicalJson([Number.NaN])).toThrow(TypeError);
    expect(() => canonicalJson({ value: undefined } as never)).toThrow(TypeError);
    expect(() => canonicalJson("\ud800")).toThrow(TypeError);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic as never)).toThrow(TypeError);
  });

  it("produces tagged lower-case SHA-256 values and raw digest bytes", () => {
    const digest = sha256("abc");
    expect(digest).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(isSha256Digest(digest)).toBe(true);
    expect(digestBytes(digest)).toHaveLength(32);
    expect(canonicalSha256({ b: 1, a: 2 })).toBe(canonicalSha256({ a: 2, b: 1 }));
  });
});

describe("UUIDv7 and correlation IDs", () => {
  const fixedUuid = generateUuidV7(
    1_735_689_600_000,
    () => Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
  );

  it("generates a canonical UUIDv7 with the RFC variant", () => {
    expect(fixedUuid).toMatch(/^[0-9a-f-]{36}$/u);
    expect(isUuidV7(fixedUuid)).toBe(true);
    expect(parseUuidV7(fixedUuid).ok).toBe(true);
    expect(parseUuidV7(fixedUuid.toUpperCase()).ok).toBe(false);
    expect(parseUuidV7("00000000-0000-4000-8000-000000000000").ok).toBe(false);
  });

  it("accepts only valid incoming correlation IDs", () => {
    expect(resolveCorrelationId(fixedUuid, () => fixedUuid)).toEqual({
      acceptedIncoming: true,
      id: fixedUuid,
    });
    expect(resolveCorrelationId("unsafe", () => fixedUuid)).toEqual({
      acceptedIncoming: false,
      id: fixedUuid,
    });
  });
});

describe("pagination and path primitives", () => {
  it("defaults and caps page sizes", () => {
    expect(parsePagination()).toEqual({ ok: true, value: { limit: DEFAULT_PAGE_SIZE } });
    expect(parsePagination({ limit: MAX_PAGE_SIZE }).ok).toBe(true);
    expect(parsePagination({ limit: 0 }).ok).toBe(false);
    expect(parsePagination({ limit: MAX_PAGE_SIZE + 1 }).ok).toBe(false);
    expect(parsePagination({ limit: 2.5 }).ok).toBe(false);
  });

  it("normalizes local separators while rejecting escapes and absolute paths", () => {
    expect(normalizeRelativePath("apps\\control\\src\\page.tsx")).toEqual({
      ok: true,
      value: "apps/control/src/page.tsx",
    });
    for (const unsafe of ["../secret", "a/../../secret", "/etc/passwd", "C:\\secret", "\\\\host\\share"]) {
      expect(normalizeRelativePath(unsafe).ok).toBe(false);
    }
  });
});
