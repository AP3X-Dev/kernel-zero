import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "narrow-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 800 } } },
  ],
  webServer: {
    command: "node scripts/start-browser-server.mjs",
    url: "http://localhost:3100/access/sign-in",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
