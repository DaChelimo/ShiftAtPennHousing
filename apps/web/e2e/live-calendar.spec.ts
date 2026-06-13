import { expect, test } from '@playwright/test';

import { SEED, login } from './helpers';

// TB-1 — Live house calendar (design screen 03/04) — route /calendar.
//
// Test BACKFILL over an ALREADY-BUILT screen (not TDD-red): the live calendar
// reads published schedule data (lib/data/calendar) and renders the source-of-
// truth week grid. These flows lock the read surface + the §3.4/§11.3 closed-day
// selector contract so a regression in either is caught.
//
// Behavioral source of truth: BEHAVIORAL_SPECIFICATION.md §6.1 (manager calendar,
// SM/HM/BM) + §3.4/§11.3 (closed-house presentation). Authorization mirrors the
// schedule builder (canBuildSchedule).
//
// Seed: the S1 block publishes a Quad week (SEED.overrideWeek = the next NY Monday,
// anchored at seed time so it never ages out) with a Cara-occupied 10:00 seat and
// vacant "Open shift" seats on the Monday column (supabase/seed.sql). The current
// week is empty for Quad, so the populated grid lives on ?week=<overrideWeek>.
//
// Selector contract (data-testid unless noted):
//   calendar-house-name   — the calendar's house heading (h1).
//   calendar-closed-day    — a closed-house day cell (§3.4); ABSENT on an open week.
//   .scard (CSS)           — a shift card button (named by the worker / "Open shift").
//   "Previous week" / "Next week" — the week-nav IconButtons (accessible name).

test.describe('Live house calendar (§6.1)', () => {
  test('renders the published week grid for a manager — occupied + open-shift cards + week nav', async ({
    page,
  }) => {
    await login(page, SEED.smQuad);
    await page.goto(`/calendar?week=${SEED.overrideWeek}`);

    // The calendar resolves to the manager's own house (Quad).
    await expect(page.getByTestId('calendar-house-name')).toContainText('Quad');

    // overrideWeek is exactly one week ahead of the server's "this week"
    // (thisMonday + 7), so relWeekLabel renders the "In 1w" relative label.
    await expect(page.getByText('In 1w')).toBeVisible();

    // The published Quad blocks render as cards, including the reliably-vacant
    // seats shown as "Open shift". Specific occupants are NOT asserted:
    // admin-override.spec.ts reassigns/removes the seeded incumbent on this same
    // (only published) Quad week earlier in the serial, shared-DB run — the grid +
    // open-shift cards are the stable read surface.
    await expect(page.locator('.scard').first()).toBeVisible();
    await expect(page.getByText('Open shift').first()).toBeVisible();

    // Week navigation chevrons are present (URL-driven prev/next).
    await expect(page.getByRole('button', { name: 'Previous week' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next week' })).toBeVisible();
  });

  test('an open house renders no closed-day cell (the §3.4 closed-day selector is dormant)', async ({
    page,
  }) => {
    // The Quad override week is fully open — no house_closure rows are seeded — so
    // the calendar-closed-day cell must NOT appear. (The POPULATED closed path is
    // covered by the mobile Maestro calendar_closed_day selector + pgTAP; seeding a
    // web closure would perturb the override/coverage fixtures, so the web spec
    // pins the negative: the selector exists but stays dormant when the house is open.)
    await login(page, SEED.smQuad);
    await page.goto(`/calendar?week=${SEED.overrideWeek}`);

    await expect(page.getByTestId('calendar-house-name')).toBeVisible();
    await expect(page.getByTestId('calendar-closed-day')).toHaveCount(0);
  });

  test('the live calendar is gated to managers — a worker sees the managers-only notice', async ({
    page,
  }) => {
    await login(page, SEED.alice);
    await page.goto('/calendar');

    await expect(page.getByText('Managers only')).toBeVisible();
    await expect(page.getByTestId('calendar-house-name')).toHaveCount(0);
  });
});
