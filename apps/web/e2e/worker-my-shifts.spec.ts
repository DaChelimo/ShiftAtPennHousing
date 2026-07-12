import { expect, test } from '@playwright/test';

import { SEED, workerLogin } from './helpers';

// Worker portal — My Shifts (BSpec §5.6 Tab 1). Structural contract: the three subsection
// containers always render (with an empty-state placeholder when empty), and week
// navigation re-scopes the agenda. A Quad SW (SEED.alice) is the actor.
//
// SEED CONTRACT (worker portal): SEED.alice is an active `sw` with a published Quad week
// holding at least one own scheduled shift, so section_scheduled is non-empty and the
// Manage sheet + drop path are exercisable. Structure assertions here hold even with no
// shifts (the placeholders render).

test.describe('Worker My Shifts', () => {
  test('renders the three subsections and the week navigator', async ({ page }) => {
    await workerLogin(page, SEED.alice);
    await page.getByTestId('wnav-shifts').click();

    await expect(page.getByTestId('my-shifts')).toBeVisible();
    await expect(page.getByTestId('section_scheduled')).toBeVisible();
    await expect(page.getByTestId('section_picked_up')).toBeVisible();
    await expect(page.getByTestId('section_dropped')).toBeVisible();
    await expect(page.getByTestId('myshifts-week-hours')).toBeVisible();
  });

  test('the week navigator changes the shown week', async ({ page }) => {
    await workerLogin(page, SEED.alice);
    await page.getByTestId('wnav-shifts').click();

    const label = page.getByTestId('myshifts-week-label');
    const before = await label.textContent();
    await page.getByTestId('myshifts-next-week').click();
    await expect(label).not.toHaveText(before ?? '');
  });
});
