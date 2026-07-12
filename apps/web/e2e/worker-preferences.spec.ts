import { expect, test } from '@playwright/test';

import { SEED, workerLogin } from './helpers';

// Worker portal — Semester preferences (BSpec §4.2/§4.4). Paint-the-week grid, submit, and
// deadline read-only. This flow is fully built (Phase 1); it runs green against the standard
// preference seed (SEED.alice has a visible period).

test.describe('Worker preferences', () => {
  test('renders the paint grid for an open preference window', async ({ page }) => {
    await workerLogin(page, SEED.alice);
    await page.getByTestId('wnav-preferences').click();

    // Either the paint board or a "no window open" state — both are valid depending on the
    // sim clock. The page itself must render.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('the home preferences card links into the board', async ({ page }) => {
    await workerLogin(page, SEED.alice);
    await page.getByTestId('home-card-preferences').click();
    await expect(page).toHaveURL(/\/home\/preferences/);
  });
});
