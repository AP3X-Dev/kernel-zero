import { describe, expect, it } from "vitest";

import { WORKSPACE_NAVIGATION } from "./navigation";

describe("workspace UI contracts", () => {
  it("maps every navigation item to a unique application route", () => {
    expect(new Set(WORKSPACE_NAVIGATION.map((item) => item.href))).toHaveProperty("size", WORKSPACE_NAVIGATION.length);
    for (const item of WORKSPACE_NAVIGATION) {
      expect(item.href.startsWith("/app")).toBe(true);
      expect(item.label.length).toBeGreaterThan(0);
    }
  });
});
