import { describe, expect, it } from "vitest";

import { evaluateArchitecture } from "../../scripts/check-architecture.mjs";

describe("package dependency boundaries", () => {
  it("rejects every dependency-direction and server-only violation", () => {
    expect(evaluateArchitecture()).toEqual([]);
  });
});
