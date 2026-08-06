import { expect, test, type Locator, type Page } from '@playwright/test';

import { SEED, login } from './helpers';

// ===========================================================================
// Action inbox — coverage lifecycle + resolve.
//
// The redesigned inbox (2026-06-24) leads with the Allied-coverage requests a HM /
// RSM is working: a compact card grid of HOUSE · DATE · WINDOW, soonest window first.
// An Allied alert moves through a coverage-window lifecycle (pure @shift/core
// `alliedLifecycle`, unit-pinned in packages/core/tests/s3-inbox/inbox.test.ts):
//   active   → window not yet ended → the "Coverage" tab (resolve checkbox);
//   archived → window ended < 24h ago → the "Archive" tab (read-only history);
//   discarded→ older → hidden (the DB row is retained).
// Resolving an Allied alert marks it HANDLED — it does NOT fill the seat and does NOT
// move it to Archive (archive is window-based).
//
// 2026-08-05: the inbox's "Notifications" tab (non-Allied types: swaps, leave notices,
// shift-opened/reminder alerts, etc.) was retired — those are personal to the
// recipient as a shift-holder, not to their manager role, and reach them via mobile
// push instead. The Action Inbox is Coverage + Archive only now.
//
// Selector contract (data-testid):
//   inbox-coverage-card     — an Allied card (class .cov-card) in either grid.
//   inbox-active-grid       — the Coverage tab's card grid.
//   inbox-archive-grid      — the Archive tab's card grid.
//   inbox-resolve-checkbox  — the native Resolved checkbox on an ACTIVE card.
// Tabs are role="tab" buttons labelled Coverage / Archive.
//
// Route: /inbox (manager surface, gated to SM/HM/BM — workers use the mobile
// "Updates" tab). Mutations use .click() so the post-write router.refresh() is not a
// race. The resolve RPC + its decoupling-from-coverage invariant are pinned in
// supabase/tests/s3-allied-resolved.sql.
//
// SEED (supabase/seed.sql). Recipient = Hana Quad (SEED.hmQuad). Four rows, with
// now()-relative coverage windows so lifecycle placement is deterministic:
//   N1 hmod_urgent quad, reason float_no_acknowledgment ("…did not acknowledge in
//      time."), window straddles now → ACTIVE, UNRESOLVED → Coverage tab.
//   N2 hmod_urgent quad, reason floater_declined ("The assigned floater declined."),
//      window ended ~1h ago → ARCHIVED, RESOLVED by Hana → Archive tab.
//   N3 hm_leave_notice ("Leave / coverage change"), UNREAD → no longer fetched by the
//      inbox at all (non-Allied type, retired 2026-08-05); the row is left in the seed
//      as inert data.
//   N4 ack_reminder, scheduled now()+2d (future) → non-Allied type, likewise not
//      fetched; also would have been hidden by the due gate either way.
// Alice (SEED.alice) is a Quad SW (the managers-only gate). The inbox e2e hits the
// REAL new Date(), so the seed times are now()-relative.
// ===========================================================================

const INBOX = '/inbox';

const N1_REASON = /did not acknowledge/i; // float_no_acknowledgment (active)
const N2_REASON = /assigned floater declined/i; // floater_declined (archived/resolved)

async function gotoInbox(page: Page): Promise<void> {
  await page.goto(INBOX);
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

function covCard(page: Page, re: RegExp): Locator {
  return page.locator('.cov-card', { hasText: re });
}
function resolveBox(page: Page, re: RegExp): Locator {
  return covCard(page, re).getByTestId('inbox-resolve-checkbox');
}
function tab(page: Page, name: RegExp): Locator {
  return page.getByRole('tab', { name });
}

test.describe('Action inbox — authorization', () => {
  test('should hide the inbox from a Student Worker (managers only) — no resolve control', async ({
    page,
  }) => {
    await login(page, SEED.alice);
    await page.goto(INBOX);
    await expect(page.getByTestId('inbox-resolve-checkbox')).toHaveCount(0);
    await expect(page.getByText(/managers only/i)).toBeVisible();
  });
});

test.describe('Action inbox — coverage lifecycle / resolve', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, SEED.hmQuad);
  });

  test('should show the ACTIVE Allied alert on the Coverage tab with an unchecked Resolved checkbox and no legacy controls', async ({
    page,
  }) => {
    await gotoInbox(page);
    // Coverage is the default tab: N1 renders as a card with an unchecked checkbox.
    await expect(resolveBox(page, N1_REASON)).toBeVisible();
    await expect(resolveBox(page, N1_REASON)).not.toBeChecked();
    // The old disabled "Call Allied / Mark covered" + "Read-only" notice are gone.
    await expect(page.getByText(/call allied/i)).toHaveCount(0);
    await expect(page.getByText(/read-only in this build/i)).toHaveCount(0);
  });

  test('should mark an active Allied alert resolved and back, in place on the Coverage tab', async ({
    page,
  }) => {
    // Resolving keeps the alert on Coverage (its window is still active) but flips it
    // from "Action required" to "Resolved". A self-restoring round-trip on N1 keeps the
    // shared DB at baseline.
    await gotoInbox(page);

    await expect(resolveBox(page, N1_REASON)).not.toBeChecked();
    await resolveBox(page, N1_REASON).click();
    // Still on Coverage, now checked + green Resolved badge.
    await expect(resolveBox(page, N1_REASON)).toBeChecked();
    await expect(covCard(page, N1_REASON).getByText(/^resolved$/i)).toBeVisible();

    // Untick → back to action-required.
    await resolveBox(page, N1_REASON).click();
    await expect(resolveBox(page, N1_REASON)).not.toBeChecked();
    await expect(covCard(page, N1_REASON).getByText(/action required/i)).toBeVisible();
  });

  test('should list the ARCHIVED resolved alert on the Archive tab (read-only) and never on Coverage', async ({
    page,
  }) => {
    await gotoInbox(page);
    // N2 is not in the active Coverage grid.
    await expect(covCard(page, N2_REASON)).toHaveCount(0);

    await tab(page, /archive/i).click();
    const archived = covCard(page, N2_REASON);
    await expect(archived).toBeVisible();
    await expect(archived.getByText(/^resolved$/i)).toBeVisible();
    // Archived cards are read-only history — no resolve checkbox.
    await expect(archived.getByTestId('inbox-resolve-checkbox')).toHaveCount(0);
  });

  test('should keep the Coverage tab to ACTIVE unresolved alerts only', async ({ page }) => {
    // Coverage shows the active N1 (unchecked) and NOT the archived N2; the future N4 is
    // hidden everywhere (#18b due gate).
    await gotoInbox(page);
    await expect(resolveBox(page, N1_REASON)).toBeVisible();
    await expect(resolveBox(page, N1_REASON)).not.toBeChecked();
    await expect(covCard(page, N2_REASON)).toHaveCount(0);
  });
});
