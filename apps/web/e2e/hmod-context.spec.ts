import { expect, test, type Page } from '@playwright/test';

import { SEED, login } from './helpers';

// ===========================================================================
// Web-remediation S6 — HMOD context (audit #8, #9-open-half, #18a).
//
// BEHAVIORAL_SPECIFICATION.md §2.5 (the HMOD rotor — weekly, one HMOD per week,
// **Friday-08:00 handoffs**; App. A), §7.1 / §10 (the on-duty HMOD's campus-wide
// duty-week power), §10.1 (the action inbox / notification routing); docs/
// design-brief.md §5 (the house-context switcher), §6.3 ("All houses" coverage,
// the floater "pending ack · 2h reminder sent" indicator). Pinned decisions +
// the testid contract: docs/web-remediation/sessions/S6/TEST_PLAN.md (§2 D1/D3/
// D4/D11, §3 groups A/B/C/D, §4 testid table).
//
// THREE COUPLED PIECES (TEST_PLAN §0):
//   #18a  Rotor Friday-anchor — lib/data/rotor.ts must snap weeks (displayed AND
//         the saved week_start_date) to the most-recent FRIDAY. Today it snaps to
//         Monday, which also VIOLATES the hmod_rotor isodow=5 CHECK → the rotor
//         save is broken today (a Monday key 400s). A7/A8 prove the Friday key.
//   HMOD-now  resolve the on-duty HMOD from hmod_rotor + clock → flip the
//         hardcoded "Off duty" pill (B1/B2) and wire the bell to a real unread
//         count (C1).
//   Multi-house  unlock the switcher to all 13 for the on-duty HMOD/admin; honor
//         ?house= on /calendar + /coverage (gated — only the on-duty HMOD/admin
//         may leave home house); coverage in HMOD mode aggregates all houses
//         (D11a–e).
//
// TDD-first / RED: today the AppShell pill is HARDCODED "Off duty" with NO
// `hmod-pill` data-testid (it's a className today); the bell has NO `nav-bell` /
// `bell-count` testid and no count; HouseSwitcher is HARD-LOCKED to the home house
// with NO `house-switcher` / `house-option-*` testids; the calendar/coverage pages
// IGNORE ?house= (they read adminHouseId(user)) and emit NO `calendar-house-name`
// / `coverage-house-name`; and the rotor weeks are Monday-anchored (the save 400s).
// So every flow below fails at its first missing selector or hardcoded value — the
// same red-first contract the S1/S2/S3 specs establish. The pure resolvers
// (fridayAnchor / canViewOtherHouses / resolveCalendarHouse / resolveCoverageScope
// / summarizeAckReminders) are unit-pinned in
// packages/core/tests/s6-hmod-context/hmod-context.test.ts; the cross-house
// authorization is re-checked authoritatively server-side (the gate is the pure
// resolver + the page, not the UI). Per D10 the coverage ack-reminder LABEL has
// NO e2e case (Vitest-only on summarizeAckReminders).
//
// Selector contract (data-testid — pinned in TEST_PLAN §4):
//   hmod-pill           — the HMOD on-duty pill; contains the state word
//                         "On duty" / "Off duty".
//   nav-bell            — the notification bell button; links to /inbox.
//   bell-count          — the unread badge; rendered ONLY when the count > 0.
//   house-switcher      — the house-context switcher button (always renders;
//                         clicking reveals options only when UNLOCKED).
//   house-option-<id>   — a switcher menu item per house (e.g. house-option-harnwell)
//                         — only present when unlocked.
//   house-option-all    — the "All houses" item (coverage; first) — only when unlocked.
//   calendar-house-name — the house name on the calendar page header.
//   coverage-house-name — the house name on the coverage header ("All houses" in
//                         the aggregate).
// Existing testids reused: app-shell, nav-admin-rotor, rotor-grid,
//   rotor-select-<weekStartDate>, rotor-save, rotor-saved. Auth via login().
//
// ---------------------------------------------------------------------------
// SEED ASSUMPTION (Lead owns supabase/seed.sql — TEST_PLAN §5). After
// `supabase db reset`:
//   - an hmod_rotor row makes Hana Quad (SEED.hmodOnDuty = hm.quad, the Quad HM)
//     the on-duty HMOD for the CURRENT Friday duty-week (week_start_date computed
//     with resolve_hmod_on_duty's own NY-anchored expression → guaranteed to match
//     AND satisfy the isodow=5 CHECK). ⇒ B1 (On duty), D11a/c/d (cross-house).
//   - Bea Quad (SEED.hmodOffDuty = bm.quad, a BM ⇒ canBeHmod, NOT in the rotor) ⇒
//     B2 (Off duty) and the D11b/D11e unauthorized actor.
//   - Hana already has S3's due, unacknowledged non-urgent notification ⇒ C1 (bell).
//   - the 13 houses exist; only Quad has rich blocks (other houses may render
//     empty — fine; D11c just proves the header SWITCHES house).
// The spec hits the REAL new Date(), so the rotor row is now()-relative — re-seed
// (`supabase db reset`) before running. No pending-float / ack-reminder fixture
// (D10). Flows are read-only except A7 (rotor save), which re-selects an existing
// week so it is order-independent on a fresh reset.
// ===========================================================================

const HANA = SEED.hmodOnDuty; // on-duty HMOD (Quad HM)
const BEA = SEED.hmodOffDuty; // off-duty BM (Quad) — also the unauthorized actor

const FRIDAY_KEY = /^\d{4}-\d{2}-\d{2}$/; // a rotor week key (YYYY-MM-DD)

// True iff a YYYY-MM-DD key is a Friday (UTC date-only, isodow 5). Used to prove
// the rotor weeks are Friday-anchored (#18a) without re-deriving the production math.
function isFriday(dateKey: string): boolean {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 5; // Sun=0…Fri=5…Sat=6
}

// Open the authenticated shell at `path`.
async function goto(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

// =====================================================================
// A. Friday-anchor (#18a) — the rotor round-trip (A7/A8).
// =====================================================================

test.describe('S6 — HMOD rotor Friday-anchor (#18a)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, HANA); // Quad HM ⇒ isHouseAdmin ⇒ sees the rotor grid
  });

  test('should render rotor week rows whose keys/labels are Friday-dated', async ({ page }) => {
    // A8: the grid's week rows are Friday-dated — the week label (and its
    // rotor-select-<weekStartDate> key) is a Friday. (Today they are Mondays.)
    await goto(page, '/admin/rotor');

    const grid = page.getByTestId('rotor-grid');
    await expect(grid).toBeVisible();

    // Every rotor-select testid suffix is the week's week_start_date; assert ≥1 row
    // and that the first row's key is a Friday.
    const selects = page.locator('[data-testid^="rotor-select-"]');
    await expect(selects.first()).toBeVisible();
    const firstKey = (await selects.first().getAttribute('data-testid'))!.replace(
      'rotor-select-',
      '',
    );
    expect(firstKey).toMatch(FRIDAY_KEY);
    expect(isFriday(firstKey)).toBe(true);
  });

  test('should persist a Friday week_start_date when the rotor is saved and survive a reload', async ({
    page,
  }) => {
    // A7: pick a candidate in the first week's select, save, expect rotor-saved —
    // which proves the upsert cleared the isodow=5 CHECK (a Monday key would 400).
    // Reload and assert the selection persisted.
    await goto(page, '/admin/rotor');

    const firstSelect = page.locator('[data-testid^="rotor-select-"]').first();
    await expect(firstSelect).toBeVisible();
    const weekKey = (await firstSelect.getAttribute('data-testid'))!.replace('rotor-select-', '');
    expect(isFriday(weekKey)).toBe(true); // the saved key must be a Friday

    // Choose the first real candidate (option index 1; index 0 is "— Unassigned —").
    const optionValues = await firstSelect
      .locator('option')
      .evaluateAll((opts) => (opts as HTMLOptionElement[]).map((o) => o.value));
    const candidateValue = optionValues.find((v) => v !== '');
    expect(
      candidateValue,
      'the rotor candidate pool must be non-empty (seeded HMs/BMs)',
    ).toBeTruthy();
    await firstSelect.selectOption(candidateValue!);

    await page.getByTestId('rotor-save').click();
    await expect(page.getByTestId('rotor-saved')).toBeVisible();

    // Reload: the saved assignment is read back into the same select.
    await goto(page, '/admin/rotor');
    await expect(page.getByTestId(`rotor-select-${weekKey}`)).toHaveValue(candidateValue!);
  });
});

// =====================================================================
// B. HMOD pill — On duty / Off duty (B1/B2).
// =====================================================================

test.describe('S6 — HMOD on-duty pill', () => {
  test('should read "On duty" for the on-duty HMOD', async ({ page }) => {
    // B1: resolve_hmod_on_duty(now) == Hana ⇒ her pill flips to "On duty".
    await login(page, HANA);
    await expect(page.getByTestId('hmod-pill')).toContainText(/on duty/i);
  });

  test('should read "Off duty" for an HM/BM who is not on duty', async ({ page }) => {
    // B2: Bea is a BM (canBeHmod ⇒ the pill renders) but is NOT in the rotor ⇒ "Off duty".
    await login(page, BEA);
    await expect(page.getByTestId('hmod-pill')).toContainText(/off duty/i);
  });
});

// =====================================================================
// C. Notification bell — the unread badge (C1).
// =====================================================================

test.describe('S6 — notification bell', () => {
  test('should show a positive unread badge linking to /inbox', async ({ page }) => {
    // C1: Hana has ≥1 due, unacknowledged notification (S3's seeded row) ⇒ a visible
    // bell-count badge with a positive integer; the bell links to /inbox.
    await login(page, HANA);

    const badge = page.getByTestId('bell-count');
    await expect(badge).toBeVisible();
    const text = ((await badge.textContent()) ?? '').trim();
    expect(text).toMatch(/^\d+$/);
    expect(Number(text)).toBeGreaterThan(0);

    const bell = page.getByTestId('nav-bell');
    await bell.click();
    await expect(page).toHaveURL(/\/inbox(?:\?.*)?$/);
  });
});

// =====================================================================
// D. Cross-house auth + ?house= — the switcher + gating (D11a–e).
// =====================================================================

test.describe('S6 — house-context switcher + cross-house gating', () => {
  test('should unlock the switcher (multiple house options) for the on-duty HMOD', async ({
    page,
  }) => {
    // D11a: the on-duty HMOD's switcher is UNLOCKED — clicking it lists multiple houses.
    await login(page, HANA);
    await page.getByTestId('house-switcher').click();
    const options = page.locator('[data-testid^="house-option-"]');
    await expect(options.first()).toBeVisible();
    expect(await options.count()).toBeGreaterThan(1);
  });

  test('should keep the switcher locked (no options) for an off-duty manager', async ({ page }) => {
    // D11b: an off-duty manager's switcher is LOCKED — clicking reveals no options.
    await login(page, BEA);
    await page.getByTestId('house-switcher').click();
    await expect(page.locator('[data-testid^="house-option-"]')).toHaveCount(0);
  });

  test('should let the on-duty HMOD open another house calendar via ?house=', async ({ page }) => {
    // D11c: the on-duty HMOD viewing /calendar?house=harnwell sees Harnwell (NOT her
    // home Quad) in the calendar house-name element. (Harnwell may render empty —
    // this only proves the header switched house.)
    await login(page, HANA);
    await goto(page, '/calendar?house=harnwell');
    const name = page.getByTestId('calendar-house-name');
    await expect(name).toBeVisible();
    await expect(name).toContainText(/harnwell/i);
    await expect(name).not.toContainText(/quad/i);
  });

  // (Removed 2026-06-24: the on-duty-HMOD "All houses" coverage aggregate lived on the
  // /coverage page, which was deleted with the Coverage Monitor. Cross-house calendar
  // context is still covered by the calendar cases above/below.)

  test('should ignore ?house= for an off-duty manager (renders their own house)', async ({
    page,
  }) => {
    // D11e: an off-duty manager hitting /calendar?house=harnwell is silently pinned
    // to her own house (Quad) — the param is ignored (gated, no error page).
    await login(page, BEA);
    await goto(page, '/calendar?house=harnwell');
    const name = page.getByTestId('calendar-house-name');
    await expect(name).toBeVisible();
    await expect(name).toContainText(/quad/i);
    await expect(name).not.toContainText(/harnwell/i);
  });
});
