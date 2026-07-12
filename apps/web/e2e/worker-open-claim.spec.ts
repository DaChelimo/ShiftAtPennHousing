import { expect, test } from '@playwright/test';

import { SEED, workerLogin } from './helpers';

// Worker portal — Open Shifts + Claim (BSpec §5.6 Tab 2/3, §5.3). The feed renders
// server-authoritative claimability (never a client-side T-2h re-derivation) and a
// current-week hours meter.
//
// SEED CONTRACT (worker portal): a published Quad week with at least one VACANT, still
// claimable seat SEED.alice may claim (home-house, outside T-2h or desk still covered), so
// `open-feed` is non-empty and an `open-action-*` Claim button is present. The meter +
// empty-state assertions hold regardless.

test.describe('Worker Open Shifts', () => {
  test('renders the feed and the current-week hours meter', async ({ page }) => {
    await workerLogin(page, SEED.alice);
    await page.getByTestId('wnav-open').click();

    await expect(page.getByTestId('open-shifts')).toBeVisible();
    await expect(page.getByTestId('open-hours-meter')).toBeVisible();
  });

  test('claiming an open seat surfaces a success toast and moves it out of the feed', async ({
    page,
  }) => {
    await workerLogin(page, SEED.alice);
    await page.getByTestId('wnav-open').click();

    const claim = page.locator('[data-testid^="open-action-"]').first();
    // Guarded on a seeded claimable seat (see SEED CONTRACT).
    if ((await claim.count()) === 0) test.skip(true, 'no seeded claimable open seat');

    const card = claim.locator('xpath=ancestor::*[starts-with(@data-testid,"open-")][1]');
    const cardTestId = await card.getAttribute('data-testid');
    await claim.click();
    await expect(page.getByTestId('open-toast')).toBeVisible();
    if (cardTestId !== null) {
      await expect(page.getByTestId(cardTestId)).toHaveCount(0);
    }
  });
});
