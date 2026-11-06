import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the real app container (FastAPI + built React),
 * talking to the real public data sources. BASE_URL defaults to the CI setup:
 *   docker run -p 8000:8000 -e ADMIN_AUTH_DISABLED=1 -e PREWARM_CITIES= weekender-app
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8000",
    locale: "en-GB",
    timezoneId: "Europe/London",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" }, grep: /@mobile/ },
  ],
});
