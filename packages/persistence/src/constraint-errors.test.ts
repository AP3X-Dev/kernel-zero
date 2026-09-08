import { describe, expect, it } from "vitest";

import { mapKnownPersistenceError } from "./constraint-errors";

describe("named database constraint mapping", () => {
  it("maps known audit constraints to stable application codes", () => {
    expect(mapKnownPersistenceError({ meta: { constraint: "audit_record_immutable_update" } })).toMatchObject({ code: "CONFLICT" });
    expect(mapKnownPersistenceError({ meta: { constraint: "audit_actor_shape_check" } })).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("preserves unknown errors", () => {
    const error = new Error("database unavailable");
    expect(mapKnownPersistenceError(error)).toBe(error);
  });
});
