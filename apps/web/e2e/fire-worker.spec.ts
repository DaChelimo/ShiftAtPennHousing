import { expect, test, type Page } from '@playwright/test';

import { SEED, login } from './helpers';

// ===========================================================================
// Web-remediation S4 — Fire a worker (audit #4 — "Fire (thorough tests)").
//
// BEHAVIORAL_SPECIFICATION.md §4.5 (firing — one transactional action that unwinds
// every obligation of a fired worker: in-progress vacate→escalate; recurring →
// permanent drop; non-recurring → vacate; floats voided + re-lookup excluding the
// worker; deactivate. "Mechanically equivalent to a permanent drop applied across
// every shift the worker owns, plus deactivation"). People-admin is HM/BM-only
// (§2.3/§2.6). Pinned decisions + the full contract:
// docs/web-remediation/sessions/S4/TEST_PLAN.md (PIN 4 — the confirm-modal testids).
//
// TDD-first / RED: today the PeopleRoster renders a DISABLED Fire button
// (title="Fire a worker — no backing RPC in this build (flagged)") under a
// "Read-only roster in this build" notice — there are NO `people-fire-*` /
// `fire-confirm*` testids yet. So each flow fails at its first missing selector,
// the same red-first contract the S1 admin-override + S2 force-trigger + phase-14
// cap-modifier specs establish. The pure planner is unit-pinned in
// packages/core/tests/firing/fire-planner.test.ts; the authoritative RPC behavior
// (and ALL the seat/float/swap unwinding) is in supabase/tests/s4-fire-worker.sql.
//
// The harness can't run the float-lookup algorithm and the People page shows no
// seat detail, so this e2e asserts the MODAL + Active→Inactive transition only —
// the thorough unwinding lives in pgTAP (like S2, where findFloaters math is
// core-tested, not e2e'd). The seed actor is intentionally obligation-free so the
// fire is a pure deactivate (date-robust). Hire stays disabled — that is S5;
// these flows do NOT touch the Hire button.
//
// Selector contract (data-testid — pinned in TEST_PLAN PIN 4):
//   people-fire-<userId>  — the per-row Fire button. Rendered ENABLED only for
//                           is_active rows; absent/disabled on already-inactive rows.
//   fire-confirm          — the destructive confirm modal (role=dialog). Body copy:
//                           "vacates all shifts, voids floats, deactivates account;
//                           mid-shift gaps escalate immediately."
//   fire-confirm-accept   — execute the firing.
//   fire-confirm-cancel   — dismiss without firing (nothing changes).
//   fire-success          — post-fire confirmation toast/notice.
//
// Route: /admin/people (HM/BM only; the page already gates isHouseAdmin →
// people-unauthorized). House under test: Quad. Authorized actor: SEED.hmQuad.
// The fired worker: SEED.fireable (Gabe Quad, an active Quad SW). See e2e/README.md
// (S4) for the selector + seed contract.
// ===========================================================================

const PEOPLE = '/admin/people';

// The fired worker's pinned uuid (the Lead's seed.sql row; helpers.ts §S4).
// (…000c — …000b is the existing project administrator, so Gabe took the next id.)
const FIREABLE_ID = 'a0000000-0000-4000-8000-00000000000c';

// The DataTable row whose visible text includes the person's name.
function rowFor(page: Page, name: string) {
  return page.getByRole('row').filter({ hasText: name });
}

test.describe('Fire a worker (§4.5) — the confirm modal', () => {
  test('an HM sees an enabled Fire button on an active worker row', async ({ page }) => {
    await login(page, SEED.hmQuad);
    await page.goto(PEOPLE);
    await expect(page.getByTestId('app-shell')).toBeVisible();

    const fire = page.getByTestId(`people-fire-${FIREABLE_ID}`);
    await expect(fire).toBeVisible();
    await expect(fire).toBeEnabled();
    // The disabled "Read-only roster in this build" notice is gone.
    await expect(page.getByText(/read-only roster in this build/i)).toHaveCount(0);
  });

  test('clicking Fire opens the destructive confirm modal describing the consequences', async ({
    page,
  }) => {
    await login(page, SEED.hmQuad);
    await page.goto(PEOPLE);

    await page.getByTestId(`people-fire-${FIREABLE_ID}`).click();

    const modal = page.getByTestId('fire-confirm');
    await expect(modal).toBeVisible();
    // Body copy names the consequences: vacate shifts / void floats / deactivate /
    // mid-shift escalate (PIN 4).
    await expect(modal).toContainText(/vacat/i); // "vacates all shifts"
    await expect(modal).toContainText(/float/i); // "voids floats"
    await expect(modal).toContainText(/deactivat/i); // "deactivates account"
    await expect(modal).toContainText(/mid-shift|escalat/i); // "mid-shift gaps escalate immediately"
  });

  test('cancelling the modal does NOT fire (the worker stays Active)', async ({ page }) => {
    await login(page, SEED.hmQuad);
    await page.goto(PEOPLE);

    await page.getByTestId(`people-fire-${FIREABLE_ID}`).click();
    await expect(page.getByTestId('fire-confirm')).toBeVisible();
    await page.getByTestId('fire-confirm-cancel').click();

    // No success notice; the modal is gone; the Fire button is still there (enabled);
    // the row still shows Active.
    await expect(page.getByTestId('fire-success')).toHaveCount(0);
    await expect(page.getByTestId('fire-confirm')).toHaveCount(0);
    await expect(page.getByTestId(`people-fire-${FIREABLE_ID}`)).toBeEnabled();
    await expect(rowFor(page, SEED.fireable.name)).toContainText(/active/i);
  });

  test('confirming the fire flips the worker to Inactive and removes the Fire button', async ({
    page,
  }) => {
    await login(page, SEED.hmQuad);
    await page.goto(PEOPLE);

    await page.getByTestId(`people-fire-${FIREABLE_ID}`).click();
    await expect(page.getByTestId('fire-confirm')).toBeVisible();
    await page.getByTestId('fire-confirm-accept').click();

    // Success notice appears.
    await expect(page.getByTestId('fire-success')).toBeVisible();
    // The row's Status flips to the existing Inactive tag…
    await expect(rowFor(page, SEED.fireable.name)).toContainText(/inactive/i);
    // …and the Fire button is gone (no re-fire on an inactive row).
    await expect(page.getByTestId(`people-fire-${FIREABLE_ID}`)).toHaveCount(0);
  });

  test('an already-inactive row has no enabled Fire button', async ({ page }) => {
    // After the fire above (or any prior fire), the fired worker's row exposes no
    // enabled Fire control. We re-fire-then-assert within one test so the assertion
    // holds regardless of seed re-run ordering: fire, then confirm the button is
    // absent/disabled on the now-inactive row.
    await login(page, SEED.hmQuad);
    await page.goto(PEOPLE);

    const fire = page.getByTestId(`people-fire-${FIREABLE_ID}`);
    if ((await fire.count()) > 0 && (await fire.isEnabled())) {
      await fire.click();
      await page.getByTestId('fire-confirm-accept').click();
      await expect(page.getByTestId('fire-success')).toBeVisible();
    }

    // Now-inactive: the Fire button is either absent or disabled (never enabled).
    const reFire = page.getByTestId(`people-fire-${FIREABLE_ID}`);
    if ((await reFire.count()) > 0) {
      await expect(reFire).toBeDisabled();
    } else {
      await expect(reFire).toHaveCount(0);
    }
    await expect(rowFor(page, SEED.fireable.name)).toContainText(/inactive/i);
  });
});

test.describe('Fire a worker (§4.5) — authorization', () => {
  test('a non-HM/BM (an SM) cannot reach a Fire control (unauthorized roster notice)', async ({
    page,
  }) => {
    // People-admin is HM/BM-only (§2.3/§2.6): an SM gets the existing
    // `people-unauthorized` notice instead of the roster, so no Fire control exists.
    await login(page, SEED.smQuad);
    await page.goto(PEOPLE);

    await expect(page.getByTestId('people-unauthorized')).toBeVisible();
    await expect(page.getByTestId(`people-fire-${FIREABLE_ID}`)).toHaveCount(0);
  });

  test('a Student Worker cannot reach a Fire control', async ({ page }) => {
    // An SW likewise gets the unauthorized notice (or is bounced) — never a Fire button.
    await login(page, SEED.alice);
    await page.goto(PEOPLE);

    await expect(page.getByTestId(`people-fire-${FIREABLE_ID}`)).toHaveCount(0);
  });
});
