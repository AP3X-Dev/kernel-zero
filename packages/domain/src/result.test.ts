import { describe, expect, it } from "vitest";

import { appError, isAppErrorCode } from "./errors";
import { err, flatMap, map, mapError, match, ok } from "./result";

describe("closed result and error contracts", () => {
  it("maps only the active result branch", () => {
    expect(map(ok(2), (value) => value * 3)).toEqual({ ok: true, value: 6 });
    expect(map(err("no"), (value: number) => value * 3)).toEqual({ error: "no", ok: false });
    expect(mapError(err("no"), (error) => error.length)).toEqual({ error: 2, ok: false });
    expect(flatMap(ok(2), (value) => ok(value.toString()))).toEqual({ ok: true, value: "2" });
  });

  it("matches without throwing or widening the error surface", () => {
    const result = err(appError("NOT_FOUND"));
    expect(match(result, { error: (error) => error.code, ok: () => "ok" })).toBe("NOT_FOUND");
    expect(isAppErrorCode("INVALID_EVIDENCE")).toBe(true);
    expect(isAppErrorCode("UNKNOWN")).toBe(false);
  });

  it("freezes safe error values and their detail records", () => {
    const error = appError("RATE_LIMITED", {
      details: { limit: 10, resetEpoch: 1_800_000_000 },
      retryable: true,
    });
    expect(Object.isFrozen(error)).toBe(true);
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(error).toMatchObject({ code: "RATE_LIMITED", retryable: true });
  });
});
