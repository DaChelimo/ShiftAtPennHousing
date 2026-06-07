import { expect, test, type Page } from '@playwright/test';

import { SEED, login } from './helpers';

// ===========================================================================
// Web-remediation S2 — Coverage force-trigger float (audit #2).
//
// BEHAVIORAL_SPECIFICATION.md §6.6 (force-triggered float — from a coverage gap,
// an SM/HM invokes the float lookup early → pending floater(s) assigned, or
// routed to HMOD-for-Allied when no candidate, or a §6.5 non-floating-profile
// "winter break" note), §5.4 (escalation), §6.1 (float direction — backend-
// enforced). Pinned decisions: docs/web-remediation/sessions/S2/TEST_PLAN.md
// (D1–D5; §4c is the contract these flows cover).
//
// TDD-first / RED: today the CoverageMonitor renders a DISABLED "Force-trigger
// float" button (title="Force-trigger flow — not wired here") and a "Read-only
// monitor in this build" notice — there are NO `force-trigger-*` testids yet. So
// every flow below fails at its first missing selector, the same red-first
// contract the S1 admin-override + phase-14 cap-modifier specs establish. The
// pure response→outcome mapping these flows render is unit-pinned in
// packages/core/tests/s2-force-trigger/summary.test.ts; the force-trigger RPC +
// Edge Function are already built/tested (phase-08; Deno EF — not pgTAP/Playwright
// here). The backend-enforced invariants (Harnwell training, float direction,
// no-takeback) are NOT re-tested in the UI.
//
// Selector contract (data-testid — pinned in TEST_PLAN §3):
//   force-trigger-btn            — the per-gap "Force-trigger float" button. Live
//                                  (enabled) ONLY on a broadcast-stage (vacant,
//                                  pre-float) gap; NOT rendered on a float/allied
//                                  gap (D1). Replaces the disabled stub.
//   force-trigger-confirm        — the confirm dialog opened by the button.
//   force-trigger-confirm-accept — accept → invokes the lookup (calls the EF).
//   force-trigger-result         — the success outcome (pending floater(s)
//                                  assigned / routed-to-HMOD-for-Allied / mixed).
//   force-trigger-gated          — the §6.5 non-floating-profile "winter break"
//                                  gated note (float_disabled rejection).
//   force-trigger-error          — a readable error (other rejection / 500).
//
// Route: /coverage (manager surface, gated to SM/HM/BM). House under test: Quad.
//
// ---------------------------------------------------------------------------
// SEED ASSUMPTION (Lead, please confirm — this is what S2's e2e needs beyond the
// S1 seed):
//   * The S1 seed already PUBLISHES vacant Quad blocks for Mon 2026-06-08
//     (SEED.overrideWeek) — within the coverage 30-day horizon from "now" =
//     2026-06-07. Those vacant seats render as BROADCAST-stage gap cards on
//     /coverage (no block_step_status float/allied row → esc='broadcast'), so
//     each exposes an ENABLED force-trigger-btn (D1).
//   * The Lead must ADD June `operating_calendar` rows (regular_school_year,
//     float_enabled = true) covering 2026-06-08 so the EF passes its
//     float_not_enabled / float-profile gate and actually RUNS the lookup. With
//     NO eligible floater SOURCE seeded for that Quad window, findFloaters yields
//     zero floaters and the EF routes every block to HMOD-for-Allied. That makes
//     the routed-to-Allied result the RELIABLE assertion (no flaky floater pick).
//   * NOTE FOR THE LEAD — the "button absent on a float/allied-stage gap" case
//     (§4c line 2) needs a Quad gap that is ALREADY at the float or allied stage
//     (a pending_float_in assignment, or a block_step_status hmod/allied row) for
//     2026-06-08..07-07. The S1 seed does not obviously provide one. That test is
//     written but `test.skip`-guarded with a TODO; un-skip it once the seed adds
//     a float/allied-stage Quad gap (or move the assertion to a dedicated fixture
//     house). All other flows rely only on the broadcast (vacant) gaps + the
//     added float_enabled calendar rows.
// ===========================================================================

const COVERAGE = '/coverage';

// Open /coverage for a manager and wait for the gap board to render.
async function gotoCoverage(page: Page): Promise<void> {
  await page.goto(COVERAGE);
  await expect(page.getByTestId('app-shell')).toBeVisible();
  // The coverage monitor heading is stable across the reskin.
  await expect(page.getByRole('heading', { name: /coverage monitor/i })).toBeVisible();
}

// The first live force-trigger button (D1: only broadcast-stage gaps render one).
function firstForceTriggerButton(page: Page) {
  return page.getByTestId('force-trigger-btn').first();
}

test.describe('Coverage force-trigger float (§6.6) — authorization & availability', () => {
  test('a Student Worker cannot reach the coverage monitor (managers only) — no force-trigger control', async ({
    page,
  }) => {
    // §6.1 / page gate: the coverage monitor is SM/HM/BM only, so an SW never
    // sees a force-trigger button at all.
    await login(page, SEED.alice);
    await page.goto(COVERAGE);
    await expect(page.getByTestId('force-trigger-btn')).toHaveCount(0);
  });

  test('an HM sees an ENABLED force-trigger button on a broadcast-stage (vacant) gap', async ({
    page,
  }) => {
    // §4c line 1 + D1. The S1 seed's vacant Quad 2026-06-08 blocks are broadcast-
    // stage gaps → the live button is present and enabled (the disabled
    // "not wired" stub is gone).
    await login(page, SEED.hmQuad);
    await gotoCoverage(page);

    const btn = firstForceTriggerButton(page);
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    // The old disabled stub title no longer describes the control.
    await expect(page.getByTitle(/not wired here/i)).toHaveCount(0);
  });

  test('an SM (builder of the house) also sees the force-trigger button on a vacant gap', async ({
    page,
  }) => {
    await login(page, SEED.smQuad);
    await gotoCoverage(page);
    await expect(firstForceTriggerButton(page)).toBeEnabled();
  });

  // §4c line 2 — the button is ABSENT on a gap already at the float/allied stage.
  // Guarded: the S1 seed does not obviously provide a float/allied-stage Quad gap
  // (see the SEED ASSUMPTION note in the header). Un-skip once the seed adds one.
  test.skip('the force-trigger button is ABSENT on a gap already at the float/allied stage (D1)', async ({
    page,
  }) => {
    await login(page, SEED.hmQuad);
    await gotoCoverage(page);
    // A float/allied gap card (the "Awaiting Allied" / pending-floater card) must
    // NOT carry a force-trigger button — only its "View on calendar" link.
    const alliedCard = page.locator('.gap-card.is-allied').first();
    await expect(alliedCard).toBeVisible();
    await expect(alliedCard.getByTestId('force-trigger-btn')).toHaveCount(0);
  });
});

test.describe('Coverage force-trigger float (§6.6) — confirm + result', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, SEED.hmQuad);
  });

  test('clicking force-trigger opens a confirm dialog', async ({ page }) => {
    // §4c line 3 (first half).
    await gotoCoverage(page);
    await firstForceTriggerButton(page).click();
    await expect(page.getByTestId('force-trigger-confirm')).toBeVisible();
  });

  // Live force-trigger EF round-trip. Requires the edge runtime to serve the function, which
  // needs packages/core BUILT (the EFs import `packages/core/dist/*.js`; `dist` is gitignored,
  // so run `pnpm --filter @shift/core build` before serving/deploying). With the float_enabled
  // June calendar rows and NO eligible floater source for the vacant Quad window, the EF routes
  // to HMOD-for-Allied — the outcome the result surfaces.
  test('accepting the confirm invokes the lookup and shows a result (routed to HMOD for Allied — no eligible floater seeded)', async ({
    page,
  }) => {
    // §4c lines 3 (accept) + 4: with the added float_enabled June calendar rows
    // and NO eligible floater source for the vacant Quad window, the EF routes to
    // HMOD-for-Allied. That is the reliable outcome the result must surface.
    await gotoCoverage(page);
    await firstForceTriggerButton(page).click();

    const confirm = page.getByTestId('force-trigger-confirm');
    await expect(confirm).toBeVisible();
    await page.getByTestId('force-trigger-confirm-accept').click();

    const result = page.getByTestId('force-trigger-result');
    // Generous timeout: the edge runtime's `oneshot` policy cold-spawns a fresh Deno worker
    // per request (boots + dynamically imports the bundled core), so the first round-trip can
    // take several seconds.
    await expect(result).toBeVisible({ timeout: 20000 });
    // The routed-to-Allied outcome (alliedNotifications > 0). Copy mentions Allied.
    await expect(result).toContainText(/allied/i);
    // No-takeback (D4 / invariant #3): there is no "cancel / revoke float" control.
    await expect(page.getByRole('button', { name: /revoke|cancel float|take ?back/i })).toHaveCount(
      0,
    );
  });
});
