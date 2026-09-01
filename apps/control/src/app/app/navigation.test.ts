import { describe, expect, it } from "vitest";

import { CAPABILITIES } from "@kernel-zero/domain";

import { MUTATION_STATES, MUTATION_STATE_MESSAGES, WORKSPACE_NAVIGATION } from "./navigation";

describe("workspace UI contracts", () => {
  it("maps every workspace navigation item to a closed capability and unique route", () => {
    expect(new Set(WORKSPACE_NAVIGATION.map((item) => item.href))).toHaveProperty("size", WORKSPACE_NAVIGATION.length);
    for (const item of WORKSPACE_NAVIGATION) {
      expect(CAPABILITIES).toContain(item.capability);
      expect(item.href.startsWith("/app")).toBe(true);
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  it("provides explicit nonempty copy for every required mutation state", () => {
    expect(MUTATION_STATES).toEqual([
      "pending", "success", "empty", "validation", "authorization", "quota", "provider-unavailable", "retryable-error",
    ]);
    for (const state of MUTATION_STATES) expect(MUTATION_STATE_MESSAGES[state].length).toBeGreaterThan(12);
  });
});
