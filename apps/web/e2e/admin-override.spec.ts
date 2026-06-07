import { expect, test, type Page } from '@playwright/test';

import { SEED, login } from './helpers';

// ===========================================================================
// Web-remediation S1 — Live-calendar admin override (audit #1).
//
// BEHAVIORAL_SPECIFICATION.md §4.3 (Phase-3 post-publish override — an HM/SM may
// assign / reassign / remove a worker on a PUBLISHED block, "same card UI";
// this-week vs permanent; soft-constraint confirm), §11.1 (live-calendar manager
// surface). Pinned decisions: docs/web-remediation/sessions/S1/TEST_PLAN.md.
//
// TDD-first / RED: today the ShiftDetailPanel renders the DISABLED "Read-only in
// this build" section instead of a live worker-picker, so every flow fails at its
// first missing `override-*` selector — the same red-first contract the phase-13b
// (schedule-builder) + phase-14 (cap-modifier) specs establish. The pure
// hard-block / advisory partition these flows render is unit-pinned in
// packages/core/tests/s1-admin-override/admin-override.test.ts; the authoritative
// RPC behavior is in supabase/tests/s1-admin-override.sql. The seed here is
// Quad-only (Harnwell + cross-house rejections are pgTAP-only). See e2e/README.md
// for the S1 selector + seed contract.
//
// Selector contract (data-testid — pinned in TEST_PLAN §3):
//   override-section            — the override section in the shift detail panel
//                                 (replaces the "Read-only in this build" notice;
//                                 visible only to sm/hm/bm of the block's house).
//   override-worker-select      — the worker-picker (block-house roster).
//   override-scope-week / -permanent — the This-week / Permanent scope toggle.
//   override-submit             — assign / reassign the chosen worker.
//   override-remove             — remove the worker from an occupied seat.
//   override-advisory-confirm   — the advisory-confirm modal (cannot / opted-out /
//                                 over-soft-cap / over-target).
//   override-advisory-accept    — accept the advisory and complete the write.
//   override-success            — post-write confirmation.
//
// Route: /calendar?week=<Monday>. House under test: Quad (multi-staff, non-Harnwell).
// The S1 seed must publish Quad blocks for SEED.overrideWeek holding both a VACANT
// seat and an OCCUPIED (incumbent) seat so the calendar renders cards (the current
// phase-13b seed leaves Quad blocks unassigned + unpublished). See e2e/README.md.
// ===========================================================================

// The override week's calendar URL. SEED.overrideWeek is the Monday of a published
// Quad week the S1 seed populates with assignable cards.
const CAL = `/calendar?week=${SEED.overrideWeek}`;

// Open the shift detail panel for the card whose visible text matches `cardText`
// (a worker's name for an occupied seat, or "Open shift" for a vacant/gap card).
async function openCard(page: Page, cardText: string | RegExp): Promise<void> {
  await page.goto(CAL);
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await page.getByRole('button', { name: cardText }).first().click();
  await expect(page.getByRole('dialog', { name: /shift detail/i })).toBeVisible();
}

test.describe('Live-calendar admin override (§4.3) — authorization', () => {
  test('an HM sees the override section (worker-picker, not the read-only notice)', async ({
    page,
  }) => {
    await login(page, SEED.hmQuad);
    await openCard(page, /open shift/i);

    await expect(page.getByTestId('override-section')).toBeVisible();
    await expect(page.getByTestId('override-worker-select')).toBeVisible();
    // The disabled "Read-only in this build" notice is gone.
    await expect(page.getByText(/read-only in this build/i)).toHaveCount(0);
  });

  test('an SM (builder of the house) also sees the override section', async ({ page }) => {
    await login(page, SEED.smQuad);
    await openCard(page, /open shift/i);
    await expect(page.getByTestId('override-section')).toBeVisible();
    await expect(page.getByTestId('override-worker-select')).toBeVisible();
  });

  test('a Student Worker does not get the override controls (section hidden / unauthorized)', async ({
    page,
  }) => {
    // A worker cannot reach the manager calendar at all (§6.1 — managers only); the
    // override controls are therefore never exposed to an SW.
    await login(page, SEED.alice);
    await page.goto(CAL);
    await expect(page.getByTestId('override-section')).toHaveCount(0);
    await expect(page.getByTestId('override-worker-select')).toHaveCount(0);
  });
});

test.describe('Live-calendar admin override (§4.3) — assign / reassign / remove', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, SEED.hmQuad);
  });

  test('assign to an open shift: pick a worker → submit → the block shows that worker', async ({
    page,
  }) => {
    // The HM's "allocate an open shift to an SW" complaint (audit #1).
    await openCard(page, /open shift/i);
    await expect(page.getByTestId('override-section')).toBeVisible();

    await page.getByTestId('override-worker-select').selectOption({ label: SEED.alice.name });
    await page.getByTestId('override-submit').click();

    await expect(page.getByTestId('override-success')).toBeVisible();
    // The calendar now shows Alice on a card.
    await expect(
      page.getByRole('button', { name: new RegExp(SEED.alice.name, 'i') }),
    ).toBeVisible();
  });

  test('reassign: on an occupied card, change the worker → the block shows the new worker', async ({
    page,
  }) => {
    // SEED.overrideIncumbent already staffs an occupied Quad seat for this week.
    await openCard(page, new RegExp(SEED.overrideIncumbent.name, 'i'));
    await expect(page.getByTestId('override-section')).toBeVisible();

    await page.getByTestId('override-worker-select').selectOption({ label: SEED.ben.name });
    await page.getByTestId('override-submit').click();

    await expect(page.getByTestId('override-success')).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(SEED.ben.name, 'i') })).toBeVisible();
  });

  test('remove: on an occupied card, remove → the block shows a vacant/gap card', async ({
    page,
  }) => {
    await openCard(page, new RegExp(SEED.overrideIncumbent.name, 'i'));
    await expect(page.getByTestId('override-section')).toBeVisible();

    await page.getByTestId('override-remove').click();
    await expect(page.getByTestId('override-success')).toBeVisible();

    // An open-shift / gap card is now present.
    await expect(page.getByRole('button', { name: /open shift/i }).first()).toBeVisible();
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

test.describe('Live-calendar admin override (§4.3) — advisory confirm', () => {
  test('assigning an over-soft-cap / opted-out / cannot worker shows the advisory confirm modal; accepting completes it', async ({
    page,
  }) => {
    await login(page, SEED.hmQuad);
    await openCard(page, /open shift/i);
    await expect(page.getByTestId('override-section')).toBeVisible();

    // SEED.overrideAdvisoryWorker triggers an advisory (e.g. opted-out / over-soft-cap
    // for this Quad week) — assigning surfaces the confirm modal rather than writing.
    await page
      .getByTestId('override-worker-select')
      .selectOption({ label: SEED.overrideAdvisoryWorker.name });
    await page.getByTestId('override-submit').click();

    const modal = page.getByTestId('override-advisory-confirm');
    await expect(modal).toBeVisible();

    // Accepting the advisory completes the assignment.
    await page.getByTestId('override-advisory-accept').click();
    await expect(page.getByTestId('override-success')).toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(SEED.overrideAdvisoryWorker.name, 'i') }),
    ).toBeVisible();
  });
});
