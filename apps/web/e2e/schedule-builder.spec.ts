import { expect, test } from '@playwright/test';

import { SEED, cardGroup, dragSpan, gotoScheduleBuilder, login } from './helpers';

// ===========================================================================
// Phase 13b E2E — SM schedule builder (BEHAVIORAL_SPECIFICATION.md §4.3)
//
// TDD-first / RED: the admin web app does not implement the builder yet. Each test
// fails at its first missing selector. See e2e/README.md for the selector + seed
// contract and the manual run/verification checklist. The pure grouping/over-target
// logic these flows render is unit-pinned in
// packages/core/tests/phase-13b/phase1-card-algorithm.test.ts.
// ===========================================================================

test.describe('Schedule builder — Phase 1: Preference-Assisted (§4.3)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, SEED.smQuad);
    await gotoScheduleBuilder(page);
  });

  test('dragging a span groups workers preferred / available / blocked with a reason', async ({
    page,
  }) => {
    // Drag the 1-hour span 10:00–10:30 (§4.3: a span of 2–12 consecutive 30-min blocks).
    await dragSpan(page, SEED.blocks.t1000, SEED.blocks.t1030);
    await expect(page.getByTestId('phase1-card')).toBeVisible();

    // Alice (preferred @10:00, available @10:30) → PREFERRED group.
    await expect(cardGroup(page, 'preferred')).toContainText(SEED.alice.name);
    // Ben (available for both) → AVAILABLE group.
    await expect(cardGroup(page, 'available')).toContainText(SEED.ben.name);
    // Cara (cannot @10:00) → BLOCKED group, and the card names the triggering block.
    await expect(cardGroup(page, 'blocked')).toContainText(SEED.cara.name);
    await expect(cardGroup(page, 'blocked')).toContainText(/cannot/i);
    await expect(cardGroup(page, 'blocked')).toContainText('10:00');

    // The hours-remaining figure (target − assigned, §4.3) is rendered on an entry.
    await expect(cardGroup(page, 'preferred').getByTestId('worker-hours-remaining')).toBeVisible();

    // Dana submitted nothing → she is NOT in the Phase-1 card at all (§4.2 / §4.3:
    // fully-unsubmitted workers appear only in the Phase-2 roster).
    await expect(page.getByTestId('phase1-card')).not.toContainText(SEED.dana.name);
  });

  test('a blocked worker is non-selectable (visually disabled)', async ({ page }) => {
    await dragSpan(page, SEED.blocks.t1000, SEED.blocks.t1030);

    // Cara is blocked → her assign control is disabled (§4.3: "rendered as
    // non-selectable in Phase 1: the SM cannot click them to assign").
    await expect(
      cardGroup(page, 'blocked').getByRole('button', { name: SEED.cara.name }),
    ).toBeDisabled();
    // Selectable workers' controls are enabled.
    await expect(
      cardGroup(page, 'preferred').getByRole('button', { name: SEED.alice.name }),
    ).toBeEnabled();
    await expect(
      cardGroup(page, 'available').getByRole('button', { name: SEED.ben.name }),
    ).toBeEnabled();
  });

  test('assigning a preferred worker updates the draft', async ({ page }) => {
    await dragSpan(page, SEED.blocks.t1000, SEED.blocks.t1030);
    await cardGroup(page, 'preferred').getByRole('button', { name: SEED.alice.name }).click();

    // Both blocks of the span now show Alice (the draft was updated).
    await expect(page.getByTestId(`block-${SEED.blocks.t1000}`)).toContainText(SEED.alice.name);
    await expect(page.getByTestId(`block-${SEED.blocks.t1030}`)).toContainText(SEED.alice.name);
  });

  test('assigning a worker over their target hours shows a warning popup that can be dismissed to continue', async ({
    page,
  }) => {
    // Drag the 2-hour span 10:00–11:30 (4 blocks). Erin's target is 1h, so assigning
    // 2h pushes her over target (§4.3: "If assigning a worker would push them over
    // their target hours, the system displays a warning popup … may dismiss … continue").
    await dragSpan(page, SEED.blocks.t1000, SEED.blocks.t1130);
    await cardGroup(page, 'available').getByRole('button', { name: SEED.erin.name }).click();

    const warning = page.getByTestId('over-target-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/target/i);

    // Dismiss the warning and continue → the assignment proceeds.
    await page.getByTestId('over-target-confirm').click();
    await expect(warning).toBeHidden();
    await expect(page.getByTestId(`block-${SEED.blocks.t1000}`)).toContainText(SEED.erin.name);
    await expect(page.getByTestId(`block-${SEED.blocks.t1130}`)).toContainText(SEED.erin.name);
  });
});

test.describe('Schedule builder — Phase 2: Manual Override (§4.3)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, SEED.smQuad);
    await gotoScheduleBuilder(page);
    await page.getByTestId('builder-phase-2').click();
    await expect(page.getByTestId('phase2-roster')).toBeHidden(); // roster appears after a drag
    await dragSpan(page, SEED.blocks.t1000, SEED.blocks.t1030);
    await expect(page.getByTestId('phase2-roster')).toBeVisible();
  });

  test('the full roster is shown, including a worker who never submitted preferences', async ({
    page,
  }) => {
    const roster = page.getByTestId('phase2-roster');
    // Dana (no preferences) is hidden in Phase 1 but PRESENT in Phase 2 and selectable.
    await expect(roster).toContainText(SEED.dana.name);
    await expect(roster.getByRole('button', { name: SEED.dana.name })).toBeEnabled();
    // The previously-blocked Cara is also present (not removed).
    await expect(roster).toContainText(SEED.cara.name);
  });

  test('cannot and opted-out are downgraded to ADVISORY warnings, not hard blocks', async ({
    page,
  }) => {
    const roster = page.getByTestId('phase2-roster');

    // Cara's "cannot" is now an advisory label on her row, and she is SELECTABLE.
    const caraRow = roster.getByRole('listitem').filter({ hasText: SEED.cara.name });
    await expect(caraRow).toContainText(/cannot/i);
    await expect(caraRow.getByRole('button', { name: SEED.cara.name })).toBeEnabled();

    // Fred's "no hours" opt-out is an advisory label on his row.
    const fredRow = roster.getByRole('listitem').filter({ hasText: SEED.fred.name });
    await expect(fredRow).toContainText(/opted out|no hours/i);

    // Assigning an advisory worker requires an explicit confirm (§4.3 Phase 2).
    await roster.getByRole('button', { name: SEED.cara.name }).click();
    await expect(page.getByTestId('advisory-confirm')).toBeVisible();
    await page.getByTestId('advisory-confirm-accept').click();
    await expect(page.getByTestId(`block-${SEED.blocks.t1000}`)).toContainText(SEED.cara.name);
  });
});

test.describe('Schedule builder — Publish → worker visibility (§4.3 Phase 3)', () => {
  test('after the SM publishes, the assigned worker sees their shift', async ({ page }) => {
    // SM builds and publishes.
    await login(page, SEED.smQuad);
    await gotoScheduleBuilder(page);
    await dragSpan(page, SEED.blocks.t1000, SEED.blocks.t1030);
    await cardGroup(page, 'preferred').getByRole('button', { name: SEED.alice.name }).click();
    await expect(page.getByTestId(`block-${SEED.blocks.t1000}`)).toContainText(SEED.alice.name);

    await page.getByTestId('publish-button').click();
    await page.getByTestId('publish-confirm').click();
    await expect(page.getByTestId('schedule-published-badge')).toBeVisible();

    // The assigned worker logs in and sees the published shift (§4.3 Phase 3:
    // "When the SM publishes … Workers can see their assignments").
    await login(page, SEED.alice);
    await expect(page.getByTestId('my-shifts')).toContainText('10:00');
  });
});

test.describe('Schedule builder — full-screen side drawer (§4.3)', () => {
  // Full screen means the whole week: the side panel collapses into a drawer
  // behind a tab button on the right edge, and Esc walks back out one layer at
  // a time. See components/builder/BuilderSideDock.tsx.
  test.beforeEach(async ({ page }) => {
    await login(page, SEED.smQuad);
    await gotoScheduleBuilder(page);
  });

  const dock = (page: import('@playwright/test').Page) => page.locator('.builder-side-dock');

  test('full screen opens with the side panel collapsed, and the tab toggles it', async ({
    page,
  }) => {
    // Outside full screen the panel is a plain column, always on screen.
    await expect(page.locator('.builder-side')).toBeVisible();
    await expect(page.getByTestId('builder-side-toggle')).toHaveCount(0);

    await page.getByTestId('builder-expand-button').click();
    await expect(dock(page)).not.toHaveClass(/is-open/);
    await expect(page.locator('.builder-side')).toBeHidden();

    const tab = page.getByTestId('builder-side-toggle');
    await tab.click();
    await expect(dock(page)).toHaveClass(/is-open/);
    await expect(page.locator('.builder-side')).toBeVisible();

    await tab.click();
    await expect(dock(page)).not.toHaveClass(/is-open/);
    await expect(page.locator('.builder-side')).toBeHidden();
  });

  test('Esc leaves an untouched full screen straight away', async ({ page }) => {
    await page.getByTestId('builder-expand-button').click();
    await expect(page.getByTestId('builder-collapse-button')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('builder-collapse-button')).toHaveCount(0);
  });

  test('once the drawer has been used, Esc brings it back before leaving full screen', async ({
    page,
  }) => {
    await page.getByTestId('builder-expand-button').click();
    const tab = page.getByTestId('builder-side-toggle');
    await tab.click();
    await tab.click();
    await expect(dock(page)).not.toHaveClass(/is-open/);

    // First press restores the drawer rather than dropping out of full screen.
    await page.keyboard.press('Escape');
    await expect(dock(page)).toHaveClass(/is-open/);
    await expect(page.getByTestId('builder-collapse-button')).toBeVisible();

    // Second press leaves, and the next full screen starts collapsed again.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('builder-collapse-button')).toHaveCount(0);

    await page.getByTestId('builder-expand-button').click();
    await expect(dock(page)).not.toHaveClass(/is-open/);
  });
});

test.describe('Schedule builder — desktop only (§4.3)', () => {
  // §4.3: "The SM uses a desktop-only drag-picker interface."
  test.use({ viewport: { width: 390, height: 844 } });

  test('on a mobile viewport the builder shows a desktop-only notice instead of the drag grid', async ({
    page,
  }) => {
    await login(page, SEED.smQuad);
    await page.getByTestId('nav-schedule-builder').click();
    await expect(page.getByTestId('builder-desktop-only-notice')).toBeVisible();
    await expect(page.getByTestId('schedule-builder-grid')).toBeHidden();
  });
});
