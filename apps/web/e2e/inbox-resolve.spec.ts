import { expect, test, type Locator, type Page } from '@playwright/test';

import { SEED, login } from './helpers';

// ===========================================================================
// Web-remediation S3 — Allied "resolved" state + unresolved-only inbox (audit #3,
// reframed).
//
// BEHAVIORAL_SPECIFICATION.md §5.4 (escalation — a T-2h float-lookup failure routes
// "Allied coverage is required" to the HM/on-duty HMOD; "once Allied is assigned the
// gap is considered resolved"), §10.1 (HM/BM/HMOD routing — "the HM/BM/HMOD places
// the call to Allied"), §10.3 (the Allied-procurement alert content: house, window,
// reason); docs/design-brief.md §6.4 (the Action inbox — the Allied-procurement
// alert is the signature item; read/unread, urgency, clean empty state). Pinned
// decisions: docs/web-remediation/sessions/S3/TEST_PLAN.md (D8/D9/D11; §4c is the
// contract these flows cover).
//
// THE REFRAME: ticking *Resolved* marks the Allied ALERT handled (the HM/HMOD made
// the out-of-band call) — it is NOT "covered" and does NOT fill the seat. The inbox
// then shows only UNRESOLVED Allied requests, with a "Show resolved" view for the
// ones already handled. The old disabled "Call Allied / Mark covered" button (no
// backing RPC) and the "Read-only in this build" notice are removed.
//
// TDD-first / RED: today ActionInbox renders a DISABLED "Call Allied / Mark covered"
// button + a "Read-only in this build" notice — there are NO inbox-resolve-checkbox /
// inbox-mark-read / inbox-show-resolved / inbox-hide-resolved testids yet, the page
// fetches only the default view (no ?show=resolved), and a resolved Allied alert is
// not filtered out. So every flow below fails at its first missing selector (or on the
// still-present "Call Allied" / "Read-only" text), the same red-first contract the S1
// admin-override + S2 force-trigger specs establish. The pure inbox-filter predicates
// these views render are unit-pinned in packages/core/tests/s3-inbox/inbox.test.ts;
// the resolve RPC + its decoupling-from-coverage invariant are pinned in
// supabase/tests/s3-allied-resolved.sql. The backend gating (HM/BM-of-house or on-duty
// HMOD) is re-checked authoritatively by the RPC, not in the UI.
//
// Selector contract (data-testid — pinned in TEST_PLAN D9):
//   inbox-resolve-checkbox  — a native <input type="checkbox"> (accessible name
//                             "Resolved") on EACH hmod_urgent row. Default view:
//                             unchecked → clicking calls setAlliedResolved(resolved:true).
//                             Resolved view: checked → clicking calls
//                             setAlliedResolved(resolved:false). Replaces the old
//                             "Call Allied / Mark covered" + "Dismiss" pair.
//   inbox-mark-read         — a button on EACH non-urgent row → markRead({id}).
//                             Replaces the disabled "Open" / "Dismiss".
//   inbox-show-resolved     — a Link to /inbox?show=resolved, shown in the DEFAULT
//                             view when resolvedCount > 0 ("Show resolved (N)").
//   inbox-hide-resolved     — a Link back to /inbox, shown in the RESOLVED view.
// The row CONTAINER keeps the existing `.inbox-item` class and unread items keep the
// `.unread-dot` class (DOM contract the implementer preserves) — so a row is targeted
// by its distinct reason/title text, which makes each checkbox UNIQUE even when both
// the unresolved (N1) and a resolved (N2) Allied alert render in the same view.
//
// Route: /inbox (manager surface, gated to SM/HM/BM — workers use the mobile
// "Updates" tab). The native checkbox (not an aria-toggled button) lets Playwright
// resolve the control unambiguously (avoids the S1 aria friction); mutations use
// .click() (not .check()/.uncheck()) so the post-write router.refresh() detaching the
// row is not a race.
//
// ---------------------------------------------------------------------------
// SEED ASSUMPTION (Lead owns supabase/seed.sql — TEST_PLAN D11). Recipient = Hana
// Quad (SEED.hmQuad — the Quad HM, so user_has_house_admin_role(Hana,'quad') is true).
// The inbox e2e hits the REAL new Date(), so D11's rows use now()-relative times (NOT
// the fixed-2026 literals the pgTAP/Vitest suites pass). Hana's inbox holds four rows:
//   N1  hmod_urgent quad, reason float_no_acknowledgment ("…did not acknowledge in
//       time."), scheduled now()-1h, UNRESOLVED, acknowledged/read → default-view target
//   N2  hmod_urgent quad, reason floater_declined ("The assigned floater declined."),
//       scheduled now()-2h, RESOLVED by Hana, acknowledged/read → resolved-view target
//   N3  hm_leave_notice ("Leave / coverage change"), scheduled now()-1h, UNREAD →
//       mark-read target (the ONLY unread row, so exactly one .unread-dot renders)
//   N4  ack_reminder, scheduled now()+2d (future) → proves #18b hidden
// N1 and N2 carry DISTINCT reasons so their rows are individually addressable; both
// are seeded acknowledged so N3 is the sole unread dot. The resolve round-trip below
// fully RESTORES N1 (resolve → unresolve), and no test mutates N2, so the suite is
// order-independent on a fresh `supabase db reset`. Alice (SEED.alice) is a Quad SW
// (the managers-only gate).
//
//   NOTE FOR THE LEAD — if D11 is not yet seeded, the flows are still structurally red
//   at the missing testids; once the seed lands they assert real list membership.
// ===========================================================================

const INBOX = '/inbox';

// N1 (the seeded UNRESOLVED Allied alert) and N2 (the seeded RESOLVED one) rendered
// reason text — distinct, so each row (and thus each resolve checkbox) is unique.
const N1_REASON = /did not acknowledge/i; // float_no_acknowledgment
const N2_REASON = /assigned floater declined/i; // floater_declined
const N3_TITLE = /coverage change/i; // hm_leave_notice → "Leave / coverage change"

// Open /inbox and wait for the authenticated shell.
async function gotoInbox(page: Page): Promise<void> {
  await page.goto(INBOX);
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

// The `.inbox-item` row whose text matches `re` (the implementer keeps `.inbox-item`).
function row(page: Page, re: RegExp): Locator {
  return page.locator('.inbox-item', { hasText: re });
}
function resolveBox(page: Page, re: RegExp): Locator {
  return row(page, re).getByTestId('inbox-resolve-checkbox');
}

test.describe('Inbox — Allied resolved state (§4c) — authorization', () => {
  test('should hide the inbox from a Student Worker (managers only) — no resolve control', async ({
    page,
  }) => {
    // §4c line 1 + the page gate (canBuildSchedule): the inbox is SM/HM/BM only, so
    // an SW sees the managers-only notice and NO resolve control.
    await login(page, SEED.alice);
    await page.goto(INBOX);
    await expect(page.getByTestId('inbox-resolve-checkbox')).toHaveCount(0);
    await expect(page.getByText(/managers only/i)).toBeVisible();
  });
});

test.describe('Inbox — Allied resolved state (§4c) — resolve / unresolve / show-resolved', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, SEED.hmQuad);
  });

  test('should show the unresolved Allied alert with an unchecked Resolved checkbox and no Call-Allied button / read-only notice', async ({
    page,
  }) => {
    // §4c line 2. The default view renders N1 with an UNCHECKED native Resolved
    // checkbox; the old disabled "Call Allied / Mark covered" control and the
    // "Read-only in this build" notice are gone.
    await gotoInbox(page);

    await expect(resolveBox(page, N1_REASON)).toBeVisible();
    await expect(resolveBox(page, N1_REASON)).not.toBeChecked();
    await expect(page.getByText(/call allied/i)).toHaveCount(0);
    await expect(page.getByText(/read-only in this build/i)).toHaveCount(0);
  });

  test('should remove a ticked Allied alert from the active inbox, surface it under Show resolved, and restore it when unticked', async ({
    page,
  }) => {
    // §4c lines 3 + 4, as ONE self-restoring round-trip on N1 (keeps the shared DB at
    // baseline → order-independent; N2 is never touched). Mutations use .click() so the
    // post-write router.refresh() detaching the row is not a race.
    await gotoInbox(page);

    // (line 3) Tick N1 → it leaves the active (default) inbox.
    await expect(resolveBox(page, N1_REASON)).not.toBeChecked();
    await resolveBox(page, N1_REASON).click();
    await expect(row(page, N1_REASON)).toHaveCount(0);

    // (line 4) "Show resolved (N)" reveals N1, now checked.
    await page.getByTestId('inbox-show-resolved').click();
    await expect(resolveBox(page, N1_REASON)).toBeChecked();

    // Untick → N1 un-resolves and leaves the resolved view.
    await resolveBox(page, N1_REASON).click();
    await expect(row(page, N1_REASON)).toHaveCount(0);

    // Hide resolved → back at /inbox the (now-unresolved) alert is in the active list again.
    await page.getByTestId('inbox-hide-resolved').click();
    await expect(page).toHaveURL(/\/inbox(?:\?.*)?$/);
    await expect(resolveBox(page, N1_REASON)).toBeVisible();
    await expect(resolveBox(page, N1_REASON)).not.toBeChecked();
  });

  test('should list the already-resolved Allied alert under Show resolved with a checked box', async ({
    page,
  }) => {
    // §4c line 4 (the seed-resolved exemplar — READ ONLY, no mutation). N2 lives in the
    // resolved view with a CHECKED Resolved checkbox and is never in the default view.
    await gotoInbox(page);
    await expect(row(page, N2_REASON)).toHaveCount(0); // not in the active inbox
    await page.getByTestId('inbox-show-resolved').click();
    await expect(resolveBox(page, N2_REASON)).toBeVisible();
    await expect(resolveBox(page, N2_REASON)).toBeChecked();
  });

  test('should mark a non-urgent notification read', async ({ page }) => {
    // §4c line 5. The non-urgent row (N3, hm_leave_notice) carries an inbox-mark-read
    // button; clicking it calls markRead({id}) and the row's unread indicator clears.
    // N1/N2 are seeded read, so N3 is the sole unread dot.
    await gotoInbox(page);

    const n3 = row(page, N3_TITLE);
    await expect(n3.locator('.unread-dot')).toHaveCount(1);
    await n3.getByTestId('inbox-mark-read').click();
    await expect(n3.locator('.unread-dot')).toHaveCount(0);
  });

  test('should show only unresolved Allied requests in the default inbox — never a resolved one', async ({
    page,
  }) => {
    // §4c line 6. The default view contains the UNRESOLVED Allied alert (N1, unchecked)
    // and NOT the resolved one (N2) — a resolved Allied alert is never mixed into the
    // active inbox. The future N4 row is also hidden (#18b).
    await gotoInbox(page);
    await expect(resolveBox(page, N1_REASON)).toBeVisible();
    await expect(resolveBox(page, N1_REASON)).not.toBeChecked();
    await expect(row(page, N2_REASON)).toHaveCount(0);
  });
});
