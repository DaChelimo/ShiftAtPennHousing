import { expect, test } from '@playwright/test';

import { SEED, login } from './helpers';

// TB-2 — Hours report (design §6.10) — route /admin/hours.
//
// Test BACKFILL over an ALREADY-BUILT read screen: per-worker weekly hours,
// decomposed into at-home / floated-out / cross-house-pickup against the week's
// cap (lib/data/hours). Managerial read surface — gated to SM/HM/BM, the same as
// coverage/calendar.
//
// Seed: the report pins to the week of the house's most recent block. For Quad
// that is SEED.overrideWeek (the next NY Monday), where Cara holds one scheduled
// 10:00 seat ⇒ 0.5h at home; every other home-housed Quad worker shows 0h but
// still LISTS (the roster is all home-housed shift-workers — sw/sm/hm, not bm).
//
// Selector contract:
//   hours-unauthorized — shown to a non-manager (an SW) instead of the report.
//   heading "Hours report" (h1) + one .hcard per worker, each with a Total /
//   At <houseName> stat, and a full-width "Floated out" / "Cross-house pickup"
//   section (hidden when that category is 0) whose shifts render as a wrapping
//   tile grid with day, house, time and duration.

test.describe('Hours report (§6.10)', () => {
  test('a manager sees the decomposed per-worker hours cards', async ({ page }) => {
    await login(page, SEED.smQuad);
    await page.goto('/admin/hours');

    await expect(page.getByRole('heading', { name: 'Hours report' })).toBeVisible();

    // The summary strip renders.
    await expect(page.getByText('Total hours')).toBeVisible();

    // The decomposition — the report's reason for existing — renders as legend +
    // per-card stats (a table header no longer exists; this is a card list). The
    // legend still says "At home"; the per-worker stat names the actual house.
    await expect(page.getByText('At home').first()).toBeVisible();
    await expect(page.getByText('At Upper Quad').first()).toBeVisible();
    await expect(page.getByText('Floated out').first()).toBeVisible();
    await expect(page.getByText('Cross-house pickup').first()).toBeVisible();

    // Every home-housed Quad worker lists, regardless of hours (the roster is all
    // home-housed shift-workers). Names are stable; specific hours are NOT asserted
    // — admin-override.spec.ts mutates the latest Quad week earlier in the serial run.
    await expect(page.getByText('Alice Quad').first()).toBeVisible();
    await expect(page.getByText('Ben Quad').first()).toBeVisible();
  });

  test('the hours report is gated to managers — a worker is blocked', async ({ page }) => {
    await login(page, SEED.alice);
    await page.goto('/admin/hours');

    await expect(page.getByTestId('hours-unauthorized')).toBeVisible();
    // The unauthorized branch keeps the page header but renders no report body —
    // the summary strip ("Total hours") only exists in the authorized HoursReport.
    await expect(page.getByText('Total hours')).toHaveCount(0);
  });
});
