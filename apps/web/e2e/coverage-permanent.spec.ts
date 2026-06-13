import { expect, test } from '@playwright/test';

import { SEED, login } from './helpers';

// TB-3 — Coverage monitor, permanent-openings feed (design screen 06) — route
// /coverage.
//
// Test BACKFILL over an ALREADY-BUILT board: the coverage monitor reads existing
// schedule data (lib/data/coverage) and shows a weekly escalation feed plus a
// PERMANENT-openings feed (permPerDay → PermCard, §8.4.1 owner-dropped recurring
// slots). Managerial read surface — gated to SM/HM/BM.
//
// The permanent feed is data-dependent: with no owner-dropped recurring slot
// seeded it shows the honest empty state ("No permanent openings"); the spec
// accepts EITHER a PermCard or that empty state so it stays green regardless of
// the now()-relative coverage fixtures (project memory web-e2e-run-gotchas).
//
// Selector contract:
//   coverage-house-name — the board's house name (in the eyebrow).
//   role=tab "Weekly feed" / "Permanent openings" — the two feed tabs.
//   .gap-card.is-perm (CSS) — a PermCard; "No permanent openings" — the empty state.

test.describe('Coverage monitor — permanent openings (§8.4.1)', () => {
  test('a manager sees the coverage board with both feed tabs', async ({ page }) => {
    await login(page, SEED.smQuad);
    await page.goto('/coverage');

    await expect(page.getByTestId('coverage-house-name')).toContainText('Quad');

    // The summary strip + the two feed tabs render.
    await expect(page.getByText('Permanent openings').first()).toBeVisible();
    await expect(page.getByRole('tab', { name: /Weekly feed/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Permanent openings/ })).toBeVisible();
  });

  test('the Permanent openings tab shows the perm feed or an honest empty state', async ({
    page,
  }) => {
    await login(page, SEED.smQuad);
    await page.goto('/coverage');

    await page.getByRole('tab', { name: /Permanent openings/ }).click();

    // Either at least one PermCard renders, or the honest "no permanent openings"
    // empty state — never a blank panel.
    const permCard = page.locator('.gap-card.is-perm');
    const permEmpty = page.getByText('No permanent openings');
    await expect(permCard.or(permEmpty).first()).toBeVisible();
  });

  test('the coverage monitor is gated to managers — a worker is blocked', async ({ page }) => {
    await login(page, SEED.alice);
    await page.goto('/coverage');

    await expect(page.getByText('Managers only')).toBeVisible();
    await expect(page.getByTestId('coverage-house-name')).toHaveCount(0);
  });
});
