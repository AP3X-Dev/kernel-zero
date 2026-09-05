import { generateKeyPairSync } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const account = Object.freeze({ email: "browser-owner@example.test", password: "browser-fixture-password-2026" });

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
  expect(blocking).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/access/sign-in");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/access/"));
  // A fresh account is bounced to workspace setup by every workspace route; create one and come back.
  await page.goto("/app/settings/custody");
  if (new URL(page.url()).pathname === "/setup/workspace") {
    await page.getByLabel("Workspace name").fill("Browser Fixture Workspace");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.waitForURL((url) => url.pathname !== "/setup/workspace");
    await page.goto("/app/settings/custody");
  }
}

test("an owner signs in, reviews policy custody, registers and revokes an authority key by keyboard", async ({ page }, testInfo) => {
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Policy custody" })).toBeVisible();
  await expectAccessible(page);

  // Keyboard path: the first control receives focus and Tab moves it forward.
  const firstControl = page.locator("a, button, input, select, textarea").first();
  await firstControl.focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();

  const keyId = `browser-${testInfo.project.name}-${String(Date.now())}`;
  const publicX = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x ?? "";
  await page.getByLabel("Key ID", { exact: true }).fill(keyId);
  await page.getByLabel("Label").fill("Browser journey key");
  await page.getByLabel(/Ed25519 public coordinate/u).fill(publicX);
  await page.getByRole("button", { name: "Register key" }).click();
  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  const row = page.getByRole("listitem").filter({ hasText: keyId });
  await expect(row).toContainText("active");
  await expect(page.getByLabel("Trust bundle JSON")).toContainText(publicX);
  await expectAccessible(page);

  await page.getByLabel("Key ID to revoke").fill(keyId);
  await page.getByLabel("Confirm key ID").fill(keyId);
  await page.getByRole("button", { name: "Revoke key" }).click();
  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  await expect(page.getByRole("listitem").filter({ hasText: keyId })).toContainText("revoked from");

  // The trust bundle is also served to CI as JSON; the revoked key carries its revocation instant.
  const response = await page.request.get("/api/custody/v1/trust-bundle");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/vnd.kernel-zero.workspace-trust+json");
  const bundle = await response.json() as { keys: { keyId: string; revokedFrom: string | null }[] };
  expect(bundle.keys.find((key) => key.keyId === keyId)?.revokedFrom).not.toBeNull();
});
