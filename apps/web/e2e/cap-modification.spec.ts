import { expect, test } from '@playwright/test';

import { SEED, login } from './helpers';

// Phase 14 — Admin Extras: system-wide hours-cap modification (§9.3).
//
// TDD-first / RED: the cap-modifier admin screen does not exist yet. Each flow
// fails at its first missing selector, the same red-first contract the phase-13b
// specs establish. See e2e/README.md (the Phase-14 section) for the selector
// contract; pinned decisions in tests/PHASE_14/TEST_PLAN.md.
//
// Behavioral source of truth: BEHAVIORAL_SPECIFICATION.md §9.3 (HM/BM of any
// house may set a week to 20-soft or 40-hard; the change is global across all 13
// houses, instant, no approval; SMs/SWs cannot). ARCHITECTURE.md §3.10 (the
// audit trail: modified_by + modified_at + notes).
//
// Selector contract (data-testid):
//   cap-modifier              — the cap-modifier page container (HM/BM only).
//   cap-unauthorized          — shown to non-HM/BM (SM, SW) instead of the form.
//   cap-week                  — the target-week input (<input type="date">, the
//                               week's Monday, YYYY-MM-DD).
//   cap-value-20 / cap-value-40 — the cap selector (20-soft / 40-hard).
//   cap-notes                 — the audit notes field (ARCH §3.10 notes column).
//   cap-submit                — apply the modification.
//   cap-global-notice         — the "applies to all 13 houses" indicator (§9.3).
//   cap-success               — post-submit confirmation.
//   cap-audit-modified-by / cap-audit-modified-at / cap-audit-notes
//                             — the audit-trail readback of the saved row.
//
// Route: /admin/hours-cap. Target week: SEED.date (2026-02-02, a Monday in the
// regular school year → default 20-soft; the HM/BM flows raise it to 40-hard).

const CAP_ROUTE = '/admin/hours-cap';

test.describe('System-wide hours-cap modification (§9.3)', () => {
  test('an SM cannot modify the cap — the authority is HM/BM only', async ({ page }) => {
    await login(page, SEED.smQuad);
    await page.goto(CAP_ROUTE);
    await expect(page.getByTestId('cap-unauthorized')).toBeVisible();
    await expect(page.getByTestId('cap-modifier')).toBeHidden();
  });

  test('a worker (SW) cannot modify the cap', async ({ page }) => {
    await login(page, SEED.alice);
    await page.goto(CAP_ROUTE);
    await expect(page.getByTestId('cap-unauthorized')).toBeVisible();
    await expect(page.getByTestId('cap-modifier')).toBeHidden();
  });

  test('an HM can set a week to 40 (hard, not overridable), applied globally', async ({ page }) => {
    await login(page, SEED.hmQuad);
    await page.goto(CAP_ROUTE);

    // The HM sees the modifier, not the unauthorized notice.
    await expect(page.getByTestId('cap-modifier')).toBeVisible();
    await expect(page.getByTestId('cap-unauthorized')).toBeHidden();

    // The modification is global — the UI states it applies to all 13 houses.
    await expect(page.getByTestId('cap-global-notice')).toContainText('13');

    await page.getByTestId('cap-week').fill(SEED.date);
    await page.getByTestId('cap-value-40').click();
    await page.getByTestId('cap-notes').fill('Spring break week — hard ceiling.');
    await page.getByTestId('cap-submit').click();

    await expect(page.getByTestId('cap-success')).toBeVisible();

    // Audit trail (ARCH §3.10): modified_by + modified_at + notes are recorded
    // and read back. modified_by is the acting HM.
    await expect(page.getByTestId('cap-audit-modified-by')).toContainText(SEED.hmQuad.name);
    await expect(page.getByTestId('cap-audit-modified-at')).not.toBeEmpty();
    await expect(page.getByTestId('cap-audit-notes')).toContainText('Spring break week');
  });

  test('a BM can set a week to 20 (soft, overridable)', async ({ page }) => {
    await login(page, SEED.bmQuad);
    await page.goto(CAP_ROUTE);

    await expect(page.getByTestId('cap-modifier')).toBeVisible();

    await page.getByTestId('cap-week').fill(SEED.date);
    await page.getByTestId('cap-value-20').click();
    await page.getByTestId('cap-notes').fill('Relax to soft cap for this week.');
    await page.getByTestId('cap-submit').click();

    await expect(page.getByTestId('cap-success')).toBeVisible();
    await expect(page.getByTestId('cap-audit-modified-by')).toContainText(SEED.bmQuad.name);
  });
});
