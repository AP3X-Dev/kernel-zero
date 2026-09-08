import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = Object.freeze({
  "/": "KERNEL ZERO",
  "/app": "Overview",
  "/app/exceptions": "Exceptions",
  "/app/policies": "Policies",
  "/app/runs": "Verification runs",
  "/app/settings/audit": "Audit history",
} as const);

for (const [path, heading] of Object.entries(routes)) {
  test(`${path} is keyboard-readable and has no serious accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    const firstControl = page.locator("a, button, input, select, textarea").first();
    await firstControl.focus();
    await expect(firstControl).toBeFocused();
    await page.keyboard.press("Tab");
    const nextControl = page.locator(":focus");
    await expect(nextControl).toBeVisible();
    expect(await firstControl.evaluate((element) => document.activeElement === element)).toBe(false);
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
    expect(blocking).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
