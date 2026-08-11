import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * The jsdom suite covers behaviour; this exists to answer a question jsdom structurally
 * cannot — does the application actually render and work in a real browser? Hydration
 * errors, CSS that collapses a layout, and client-only failures all pass a jsdom test and
 * break in front of a user.
 *
 * Assumes the API and web servers are already running (`pnpm dev`). Starting them here
 * would make the suite own process lifecycle, which is a common source of flake.
 */
export default defineConfig({
  testDir: './e2e',
  // A browser test that hangs should fail rather than stall the run.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // Fail the run rather than silently pass if someone commits a focused test.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
