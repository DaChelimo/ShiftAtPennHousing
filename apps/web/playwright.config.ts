import { defineConfig, devices } from '@playwright/test';

// Phase-13b E2E (TDD-first). These specs drive the SM/HM admin web app that does
// not exist yet (apps/web is still the Next.js scaffold) — they are RED until the
// schedule-builder + HM-leave UIs land, the same red-first contract the Maestro
// flows establish for the mobile app (apps/mobile/maestro). See e2e/README.md for
// the selector + seed contract and how to run.
//
// The schedule builder is DESKTOP-ONLY (BEHAVIORAL_SPECIFICATION.md §4.3), so the
// suite runs a single desktop Chromium project at a desktop viewport.

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  // The drag-picker + publish flows mutate shared schedule state; keep them serial.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  // Starts `next dev` if nothing is already serving BASE_URL. NOTE: the dev server
  // alone is not sufficient — a seeded local Supabase (see e2e/README.md) must also
  // be running for these flows to reach green.
  webServer: {
    command: 'pnpm dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
