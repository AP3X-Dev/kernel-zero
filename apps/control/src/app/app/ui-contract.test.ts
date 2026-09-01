import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("route and responsive UI contract", () => {
  it("ships every named application route", () => {
    const routes = [
      "../access/sign-in/page.tsx",
      "../access/register/page.tsx",
      "../access/recover/page.tsx",
      "../access/reset/page.tsx",
      "../join/[token]/page.tsx",
      "../setup/workspace/page.tsx",
      "page.tsx",
      "policies/page.tsx",
      "policies/[pack]/page.tsx",
      "runs/page.tsx",
      "runs/[runId]/page.tsx",
      "exceptions/page.tsx",
      "people/page.tsx",
      "settings/workspace/page.tsx",
      "settings/subscription/page.tsx",
      "settings/audit/page.tsx",
      "../ops/page.tsx",
      "../ops/payment-events/page.tsx",
    ];
    for (const route of routes) expect(existsSync(resolve(appRoot, "app", route))).toBe(true);
  });

  it("server-gates every tenant and operator page instead of relying on navigation visibility", () => {
    const workspacePages = [
      "page.tsx", "policies/page.tsx", "policies/[pack]/page.tsx", "runs/page.tsx", "runs/[runId]/page.tsx",
      "exceptions/page.tsx", "people/page.tsx", "settings/workspace/page.tsx", "settings/subscription/page.tsx", "settings/audit/page.tsx",
    ];
    for (const page of workspacePages) {
      expect(readFileSync(resolve(appRoot, "app", page), "utf8")).toContain("requireWorkspaceRoute(");
    }
    for (const page of ["../ops/page.tsx", "../ops/payment-events/page.tsx"]) {
      expect(readFileSync(resolve(appRoot, "app", page), "utf8")).toContain("requireOperatorRoute(");
    }
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
