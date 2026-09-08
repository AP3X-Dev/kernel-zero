import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("route and responsive UI contract", () => {
  it("ships every named application route", () => {
    const routes = [
      "page.tsx",
      "policies/page.tsx",
      "policies/[pack]/page.tsx",
      "runs/page.tsx",
      "runs/[runId]/page.tsx",
      "exceptions/page.tsx",
      "settings/audit/page.tsx",
    ];
    for (const route of routes) expect(existsSync(resolve(appRoot, "app", route))).toBe(true);
  });

  it("has visible focus, 320px support, narrow row cards, and reduced-motion behavior", () => {
    const css = readFileSync(resolve(appRoot, "globals.css"), "utf8");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("min-width: 320px");
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.row-card[\s\S]*grid-template-columns: 1fr/u);
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).not.toMatch(/height: 100vh;\s+overflow(?:-y)?:/u);
  });
});
