import { expect, test } from '@playwright/test';

import { SEED, workerLogin } from './helpers';

// Worker portal — Swaps (BSpec §8). Review incoming/outgoing requests and hand off a shift.
//
// SEED CONTRACT (worker portal): the hand-off compose needs SEED.alice to hold at least one
// upcoming own shift and the directory to hold another active worker. To exercise accept,
// seed a PENDING swap/hand-off where SEED.alice is the counterparty (incoming).

test.describe('Worker Swaps', () => {
  test('renders the Incoming/Outgoing tabs and the hand-off compose entry', async ({ page }) => {
    await workerLogin(page, SEED.alice);
    await page.getByTestId('wnav-swaps').click();

    await expect(page.getByTestId('swaps')).toBeVisible();
    await expect(page.getByRole('tab', { name: /Incoming/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Outgoing/ })).toBeVisible();
    await expect(page.getByTestId('swaps-compose')).toBeVisible();
  });

  test('the hand-off sheet opens with a shift and a counterparty picker', async ({ page }) => {
    await workerLogin(page, SEED.alice);
    await page.getByTestId('wnav-swaps').click();
    await page.getByTestId('swaps-compose').click();

    await expect(page.getByTestId('handoff-sheet')).toBeVisible();
    await expect(page.getByTestId('handoff-counterparty')).toBeVisible();
  });

  test('an incoming request can be accepted', async ({ page }) => {
    await workerLogin(page, SEED.alice);
    await page.getByTestId('wnav-swaps').click();

    const accept = page.locator('[data-testid^="swap-accept-"]').first();
    if ((await accept.count()) === 0) test.skip(true, 'no seeded incoming swap');

    await accept.click();
    await expect(page.getByTestId('swaps-toast')).toBeVisible();
  });
});
