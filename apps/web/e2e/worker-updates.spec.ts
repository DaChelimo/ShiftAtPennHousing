import { expect, test } from '@playwright/test';

import { SEED, workerLogin } from './helpers';

// Worker portal — Updates / inbound floats (BSpec §7.1). The shell bell routes here; the
// page renders either the pending-float carousel (accept/decline) or an empty state.
//
// SEED CONTRACT (worker portal): to exercise accept/decline, seed a PENDING float assigned
// to SEED.alice whose start is more than 10 minutes out (respondable), so a
// `float-accept-*` button renders. The empty-state + bell-route assertions hold otherwise.

test.describe('Worker Updates', () => {
  test('the shell bell routes to the Updates page', async ({ page }) => {
    await workerLogin(page, SEED.alice);
    await page.getByTestId('worker-bell').click();
    await expect(page.getByTestId('updates')).toBeVisible();
  });

  test('a respondable float can be accepted', async ({ page }) => {
    await workerLogin(page, SEED.alice);
    await page.goto('/home/updates');

    const accept = page.locator('[data-testid^="float-accept-"]').first();
    if ((await accept.count()) === 0) test.skip(true, 'no seeded pending float');

    await accept.click();
    await expect(page.getByTestId('updates-toast')).toBeVisible();
  });
});
