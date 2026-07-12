import { expect, test } from '@playwright/test';

import { SEED, login } from './helpers';

// Operating Seasons admin surface (BSpec §2.7; docs/operating-seasons/PLAN.md P7).
// The admin role reaches /admin/operations; a plain SM does not. Requires the seed
// admin-role grant on admin@upenn.edu (supabase/seed.sql).

test.describe('Operating seasons admin surface', () => {
  test('the administrator can open the operations page and sees the seasons panel', async ({
    page,
  }) => {
    await login(page, SEED.projectAdmin);
    await page.goto('/admin/operations');
    await expect(page.getByRole('heading', { name: 'Operating seasons' })).toBeVisible();
    // The create-season form is present.
    await expect(page.getByText('New season')).toBeVisible();
  });

  test('a non-admin is blocked from the operations page', async ({ page }) => {
    await login(page, SEED.smQuad);
    await page.goto('/admin/operations');
    await expect(page.getByTestId('operations-unauthorized')).toBeVisible();
  });
});
