import { expect, test } from '@playwright/test';

import { SEED, login } from './helpers';

// ===========================================================================
// Phase 13b E2E — HM/BM leave (BEHAVIORAL_SPECIFICATION.md §2.6)
//
// TDD-first / RED until the web HM-leave screen lands. The pre-filled mailto is
// produced server-side by `craft_hm_leave_mailto` (phase-12 migration
// 20260601000001) via the `generate-leave-mailto` Edge Function; this flow pins
// that the web surfaces it as a clickable mailto link (§2.6 #3). The replacement
// picker's cycle-prevention exclusion (§2.6) is exercised here at selection time;
// the submission-time re-check is a server transaction concern (see TEST_PLAN.md).
//
// Leave admin route: /admin/leave (see e2e/README.md selector contract).
// ===========================================================================

const LEAVE_ROUTE = '/admin/leave';

test.describe('HM/BM leave (§2.6)', () => {
  test('an SM cannot submit HM leave — only HMs/BMs can', async ({ page }) => {
    // §2.6 opens "An HM or BM may indicate one or more days of leave"; §2.2 grants the
    // SM schedule + override powers but NOT leave. The SM is denied the leave admin.
    await login(page, SEED.smQuad);
    await page.goto(LEAVE_ROUTE);
    await expect(page.getByTestId('leave-unauthorized')).toBeVisible();
    await expect(page.getByTestId('hm-leave-form')).toBeHidden();
  });

  test('the replacement picker excludes the incoming chain (cycle prevention) and offers the default + admin', async ({
    page,
  }) => {
    await login(page, SEED.hmQuad);
    await page.goto(LEAVE_ROUTE);
    await expect(page.getByTestId('hm-leave-form')).toBeVisible();

    await page.getByTestId('leave-start-date').fill('2026-03-10');
    await page.getByTestId('leave-end-date').fill('2026-03-12');

    // Open the replacement picker.
    await page.getByTestId('replacement-select').click();
    const options = page.getByTestId('replacement-options');
    await expect(options).toBeVisible();

    // Ingrid's active leave resolves THROUGH Hana (hmQuad), so Hana is in Ingrid's
    // forward chain ⇒ Ingrid is in Hana's incoming chain ⇒ excluded from the picker
    // (§2.6: "These HMs are excluded from the replacement picker: selecting any of
    // them would create a cycle").
    await expect(options.getByRole('option', { name: SEED.hmIncoming.name })).toHaveCount(0);

    // The same-house BM is the default replacement and IS offered (§2.6 #1).
    await expect(options.getByRole('option', { name: SEED.bmQuad.name })).toBeVisible();
    // The project administrator is ALWAYS a valid terminal selection (§2.6).
    await expect(options.getByRole('option', { name: SEED.projectAdmin.name })).toBeVisible();
  });

  test('HM creates leave with a valid replacement and the system generates a pre-filled mailto', async ({
    page,
  }) => {
    await login(page, SEED.hmQuad);
    await page.goto(LEAVE_ROUTE);
    await expect(page.getByTestId('hm-leave-form')).toBeVisible();

    await page.getByTestId('leave-start-date').fill('2026-03-10');
    await page.getByTestId('leave-end-date').fill('2026-03-12');

    // Select the same-house BM (Bea) as replacement.
    await page.getByTestId('replacement-select').click();
    await page
      .getByTestId('replacement-options')
      .getByRole('option', { name: SEED.bmQuad.name })
      .click();
    await expect(page.getByTestId('replacement-select')).toContainText(SEED.bmQuad.name);

    await page.getByTestId('leave-submit').click();

    // §2.6 #3: the system "opens the user's mail application (via a mailto link on web)
    // with the message pre-filled." The web surfaces it as a clickable mailto anchor.
    // The href must match `craft_hm_leave_mailto` (phase-12):
    //   mailto:<quad SW emails>?subject=Housing%20Manager%20leave%20notice
    //     &body=<HM> is on leave from <start> through <end>. For emergency
    //            assistance, contact <replacement> (<role>).
    const mailto = page.getByTestId('leave-mailto');
    await expect(mailto).toBeVisible();
    const href = (await mailto.getAttribute('href')) ?? '';

    expect(href).toMatch(/^mailto:/);
    expect(href).toContain('subject=Housing%20Manager%20leave%20notice');
    expect(href).toContain('is%20on%20leave%20from');
    expect(href).toContain('For%20emergency%20assistance');
    // Replacement name + role label appear in the (space-encoded) body.
    expect(href).toContain('Bea%20Quad');
    expect(href).toContain('(Building%20Manager)');
    // The affected house's student workers are the recipients.
    expect(href).toContain(SEED.alice.email);
  });
});
