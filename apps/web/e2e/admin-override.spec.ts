import { expect, test, type Page } from '@playwright/test';

import { SEED, login } from './helpers';

// ===========================================================================
// Web-remediation S1 — Live-calendar admin override (audit #1).
//
// BEHAVIORAL_SPECIFICATION.md §4.3 (Phase-3 post-publish override — an HM/SM may
// assign / replace / remove a worker on a PUBLISHED block, "same card UI";
// this-week vs permanent; soft-constraint confirm), §11.1 (live-calendar manager
// surface). Pinned decisions: docs/web-remediation/sessions/S1/TEST_PLAN.md.
//
// Panel redesign (2026-06-14): the detail panel's edit section is now a UNIFIED
// flow — pick a time SUB-RANGE (defaulting to the whole shift), then Remove or
// Replace (occupied) / Assign (open seat), choosing the worker from CARDS that
// show each candidate's weekly hours + cap headroom. "Reassign" is now "Replace",
// and Replace targets the incumbent's seat (admin_assign_worker p_incumbent_user_id,
// migration 20260614000003) so a block with a sibling vacant seat no longer ends up
// with two workers — the original phantom-seat reassign bug. The pure hard-block /
// advisory partition is unit-pinned in
// packages/core/tests/s1-admin-override/admin-override.test.ts; the authoritative
// RPC behavior is in supabase/tests/s1-admin-override.sql.
//
// Panel redesign (2026-07-25): occupied-seat editing now leads with the action
// choice ("Swap with someone else" copy, same override-action-replace testid /
// internal 'replace' action) — nothing past that row (range slider, worker
// cards, scope, Apply) renders until an action is picked. The typed from/to
// selects are gone; the range slider is the only way to size the sub-range.
//
// Selector contract (data-testid):
//   override-section            — the edit section in the shift detail panel
//                                 (visible only to sm/hm/bm of the block's house).
//   override-action-replace / -remove — the Swap/Remove toggle (occupied seats);
//                                 nothing below it renders until one is picked.
//   override-worker-list        — the candidate-card picker (block-house roster).
//   override-worker-card        — one selectable candidate card (data-worker-id).
//   override-scope-week / -permanent — the This-week / Permanent scope toggle.
//   override-submit             — assign / replace the chosen worker.
//   override-remove             — remove the worker from the selected range.
//   override-success            — post-write confirmation.
//
// No advisory confirm popup here (2026-07-31): soft advisories (cannot /
// opted-out / over-soft-cap / over-target) never gate a live-calendar write.
// That confirm card exists only in the schedule builder now (OverrideConfirmModal,
// testids over-target-warning / advisory-confirm) — see ShiftOverrideEditor.tsx.
//
// Route: /calendar?week=<Monday>. House under test: Quad (multi-staff, non-Harnwell).
// The S1 seed publishes a Quad week (SEED.overrideWeek) with a 10:00 block holding
// Cara (overrideIncumbent) on seat 1 + two VACANT sibling seats (the phantom-seat
// setup), and an all-vacant 10:30 block. See e2e/README.md for the S1 contract.
// ===========================================================================

const CAL = `/calendar?week=${SEED.overrideWeek}`;

// Open the shift detail panel for the card whose visible text matches `cardText`
// (a worker's name for an occupied seat, or "Open shift" for a vacant/gap card).
async function openCard(page: Page, cardText: string | RegExp): Promise<void> {
  await page.goto(CAL);
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await page.getByRole('button', { name: cardText }).first().click();
  await expect(page.getByRole('dialog', { name: /shift detail/i })).toBeVisible();
}

// Select the candidate card for `name` in the worker-card picker.
function workerCard(page: Page, name: string) {
  return page.getByTestId('override-worker-card').filter({ hasText: name });
}

test.describe('Live-calendar admin override (§4.3) — authorization', () => {
  test('an HM sees the edit section (worker-card picker, not the read-only notice)', async ({
    page,
  }) => {
    await login(page, SEED.hmQuad);
    await openCard(page, /open shift/i);

    await expect(page.getByTestId('override-section')).toBeVisible();
    await expect(page.getByTestId('override-worker-list')).toBeVisible();
    // The disabled "Read-only in this build" notice is gone.
    await expect(page.getByText(/read-only in this build/i)).toHaveCount(0);
  });

  test('an SM (builder of the house) also sees the edit section', async ({ page }) => {
    await login(page, SEED.smQuad);
    await openCard(page, /open shift/i);
    await expect(page.getByTestId('override-section')).toBeVisible();
    await expect(page.getByTestId('override-worker-list')).toBeVisible();
  });

  test('a Student Worker does not get the override controls (section hidden / unauthorized)', async ({
    page,
  }) => {
    // A worker cannot reach the manager calendar at all (§6.1 — managers only); the
    // override controls are therefore never exposed to an SW.
    await login(page, SEED.alice);
    await page.goto(CAL);
    await expect(page.getByTestId('override-section')).toHaveCount(0);
    await expect(page.getByTestId('override-worker-list')).toHaveCount(0);
  });
});

test.describe('Live-calendar admin override (§4.3) — assign / replace / remove', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, SEED.hmQuad);
  });

  test('assign to an open shift: pick a worker card → submit → the block shows that worker', async ({
    page,
  }) => {
    // The HM's "allocate an open shift to an SW" complaint (audit #1).
    await openCard(page, /open shift/i);
    await expect(page.getByTestId('override-section')).toBeVisible();

    await workerCard(page, SEED.alice.name).click();
    await page.getByTestId('override-submit').click();

    await expect(page.getByTestId('override-success')).toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(SEED.alice.name, 'i') }),
    ).toBeVisible();
  });

  test('replace: on an occupied card, hand the seat to a new worker → the incumbent is gone, not duplicated', async ({
    page,
  }) => {
    // SEED.overrideIncumbent (Cara) staffs seat 1 of a 3-seat block whose other two
    // seats are VACANT. The old reassign filled a sibling vacant seat, leaving Cara
    // AND adding the new worker (the phantom-seat bug). Replace must overwrite Cara's
    // seat: the new worker appears and Cara disappears entirely.
    await openCard(page, new RegExp(SEED.overrideIncumbent.name, 'i'));
    await expect(page.getByTestId('override-section')).toBeVisible();

    // Occupied seats no longer default to an action — pick "Swap with someone
    // else" before the worker cards appear.
    await page.getByTestId('override-action-replace').click();
    await workerCard(page, SEED.ben.name).click();
    await page.getByTestId('override-submit').click();

    await expect(page.getByTestId('override-success')).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(SEED.ben.name, 'i') })).toBeVisible();
    // Regression: the incumbent was overwritten, not left beside a phantom seat.
    await expect(
      page.getByRole('button', { name: new RegExp(SEED.overrideIncumbent.name, 'i') }),
    ).toHaveCount(0);
  });

  test('remove: switch to Remove on an occupied card → the block shows a vacant/gap card', async ({
    page,
  }) => {
    await openCard(page, new RegExp(SEED.overrideIncumbent.name, 'i'));
    await expect(page.getByTestId('override-section')).toBeVisible();

    await page.getByTestId('override-action-remove').click();
    await page.getByTestId('override-remove').click();
    await expect(page.getByTestId('override-success')).toBeVisible();

    // An open-shift / gap card is now present, and the incumbent is gone.
    await expect(page.getByRole('button', { name: /open shift/i }).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(SEED.overrideIncumbent.name, 'i') }),
    ).toHaveCount(0);
  });

  test('the This week / Permanent scope toggle is present and selectable', async ({ page }) => {
    await openCard(page, /open shift/i);
    await expect(page.getByTestId('override-section')).toBeVisible();

    const week = page.getByTestId('override-scope-week');
    const permanent = page.getByTestId('override-scope-permanent');
    await expect(week).toBeVisible();
    await expect(permanent).toBeVisible();

    // Selecting Permanent then This week round-trips (a real, togglable control).
    await permanent.click();
    await expect(permanent).toBeChecked();
    await week.click();
    await expect(week).toBeChecked();
  });
});

test.describe('Live-calendar admin override (§4.3) — soft advisories never confirm', () => {
  test('assigning an over-soft-cap / opted-out / cannot worker writes immediately, no confirm popup (2026-07-31)', async ({
    page,
  }) => {
    await login(page, SEED.hmQuad);
    await openCard(page, /open shift/i);
    await expect(page.getByTestId('override-section')).toBeVisible();

    // SEED.overrideAdvisoryWorker (Fred) opted out for this period. An RSM/SM
    // editing the LIVE schedule is assumed to already know a worker's hours and
    // availability picture, so soft advisories no longer gate the write behind a
    // confirm popup here (unlike the schedule builder, where the roster panel is
    // the only place that context surfaces) — the assignment completes directly.
    await workerCard(page, SEED.overrideAdvisoryWorker.name).click();
    await page.getByTestId('override-submit').click();

    await expect(page.getByTestId('override-advisory-confirm')).toHaveCount(0);
    await expect(page.getByTestId('override-success')).toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(SEED.overrideAdvisoryWorker.name, 'i') }),
    ).toBeVisible();
  });
});
