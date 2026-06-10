import { expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Phase-13b E2E shared helpers + SEED CONTRACT.
//
// These flows are TDD-first: the admin web app does not implement the schedule
// builder or HM-leave screens yet, so every flow is RED at its first selector.
// The selector contract (data-testid values) and this seed contract are the
// implementation spec — see e2e/README.md for the full table.
//
// PRECONDITIONS to run green (documented, not automated here — the mobile analogue
// is "Maestro needs a seeded emulator"):
//   1. A seeded local Supabase (`supabase start` + a phase-13b seed) holding the
//      fixtures below.
//   2. The web app served at E2E_BASE_URL (playwright.config.ts starts `pnpm dev`).
// ---------------------------------------------------------------------------

const PASSWORD = 'test-Password-123';

export type SeedUser = { email: string; name: string };

// The Quad override/force-trigger week — NEXT week's Monday in the host's local
// (America/New_York) time, matching the seed's `e2e.quad_monday`
// (date_trunc('week', now NY) + 7). Computed at module load so the fixtures are
// always future-dated and the now()-relative coverage/override gates surface them.
function nextNyMondayISO(): string {
  const now = new Date();
  const daysToNextMonday = (8 - now.getDay()) % 7 || 7; // Sun=0..Sat=6 → 1..7 ahead
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToNextMonday);
  const mm = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return `${monday.getFullYear()}-${mm}-${dd}`;
}

// House under test: Quad (a multi-staff, non-Harnwell house — no training constraint
// confounds the grouping assertions). Regular-school-year period; build week of the
// Monday below.
export const SEED = {
  password: PASSWORD,
  house: 'quad',
  // The build week. 2026-02-02 is a Monday in the regular school year (EST, -05:00).
  date: '2026-02-02',
  // Drag-span cell keys are `block-<YYYY-MM-DD>-<HHMM>` (NY wall-clock) — stable across
  // re-seeds, unlike the uuid block_id. The seed creates Quad blocks for this day.
  blocks: {
    t1000: '2026-02-02-1000',
    t1030: '2026-02-02-1030',
    t1100: '2026-02-02-1100',
    t1130: '2026-02-02-1130',
  },

  // --- Schedule-builder actors (all home_house = quad) ---
  // The Quad SM who builds the schedule (BEH §2.2; permissions scoped to their house).
  smQuad: { email: 'sm.quad@pennhousing.test', name: 'Sam Quad' } as SeedUser,

  // Worker preference fixtures for 10:00/10:30/11:00/11:30 (so both the 2-block and the
  // 4-block drag spans below resolve deterministically):
  //   Alice  → 10:00 PREFERRED, 10:30/11:00/11:30 available  ⇒ PREFERRED group
  //   Ben    → all four AVAILABLE                            ⇒ AVAILABLE group
  //   Cara   → 10:00 CANNOT, rest available                  ⇒ BLOCKED (cannot @10:00)
  //   Dana   → NO preferences submitted at all               ⇒ Phase-2 roster ONLY
  //   Erin   → all four available, target_hours = 1          ⇒ AVAILABLE; the 2h span over-targets
  //   Fred   → opted out ("no hours"), target_hours = 0      ⇒ Phase-2 opted_out advisory
  alice: { email: 'alice.quad@pennhousing.test', name: 'Alice Quad' } as SeedUser,
  ben: { email: 'ben.quad@pennhousing.test', name: 'Ben Quad' } as SeedUser,
  cara: { email: 'cara.quad@pennhousing.test', name: 'Cara Quad' } as SeedUser,
  dana: { email: 'dana.quad@pennhousing.test', name: 'Dana Quad' } as SeedUser,
  erin: { email: 'erin.quad@pennhousing.test', name: 'Erin Quad' } as SeedUser,
  fred: { email: 'fred.quad@pennhousing.test', name: 'Fred Quad' } as SeedUser,

  // --- HM-leave actors ---
  // Quad HM goes on leave; Quad BM is the DEFAULT replacement (BEH §2.6 #1).
  hmQuad: { email: 'hm.quad@pennhousing.test', name: 'Hana Quad' } as SeedUser,
  bmQuad: { email: 'bm.quad@pennhousing.test', name: 'Bea Quad' } as SeedUser,

  // --- S6 HMOD-context actors (web-remediation, audit #8/#9/#18a) ---
  // After `supabase db reset` the S6 seed block inserts an `hmod_rotor` row making
  // Hana Quad the on-duty HMOD for the current Friday duty-week, so she is the
  // cross-house authority (canViewOthers → unlocked switcher, ?house= honored,
  // "All houses" coverage) and her pill reads "On duty". Bea Quad is a BM (so
  // `canBeHmod`, the pill renders) but is NOT in the rotor → "Off duty", and she is
  // the unauthorized cross-house actor (off-duty ⇒ not canViewOthers). These alias
  // the existing Quad HM/BM fixtures (no new seed users). See TEST_PLAN §5.
  hmodOnDuty: { email: 'hm.quad@pennhousing.test', name: 'Hana Quad' } as SeedUser,
  hmodOffDuty: { email: 'bm.quad@pennhousing.test', name: 'Bea Quad' } as SeedUser,

  // --- S1 admin-override actors (web-remediation, audit #1) ---
  // The override flows run on the LIVE calendar, which renders cards only from
  // PUBLISHED Quad blocks that have assignment rows. The S1 seed must publish a
  // Quad week (Monday `overrideWeek`) holding BOTH a vacant seat (an "Open shift"
  // card) and an occupied seat staffed by `overrideIncumbent`, so assign /
  // reassign / remove all have a target. `overrideAdvisoryWorker` is a Quad SW who
  // triggers an advisory when assigned (opted-out / over-soft-cap that week), so
  // the advisory-confirm modal appears. The actors reuse the phase-13b Quad SWs:
  // Cara (incumbent) and Fred (opted-out → advisory). See e2e/README.md (S1).
  overrideWeek: nextNyMondayISO(), // next NY Monday; the seed anchors Quad cards to it (now-relative, never ages out)
  overrideIncumbent: { email: 'cara.quad@pennhousing.test', name: 'Cara Quad' } as SeedUser,
  overrideAdvisoryWorker: { email: 'fred.quad@pennhousing.test', name: 'Fred Quad' } as SeedUser,
  // An HM at another house whose ACTIVE leave delegation currently resolves THROUGH
  // hmQuad (i.e. hmQuad is in this HM's forward chain) → this HM is in hmQuad's
  // *incoming chain* and MUST be excluded from hmQuad's replacement picker (BEH §2.6
  // cycle-prevention-at-selection-time). The seed creates this HM's active hm_leave
  // row naming hmQuad (directly or transitively) as replacement.
  hmIncoming: { email: 'hm.incoming@pennhousing.test', name: 'Ingrid Incoming' } as SeedUser,
  // The project administrator — ALWAYS a valid terminal replacement, never excluded
  // (BEH §2.6: "The project administrator is always a valid terminal selection").
  projectAdmin: { email: 'admin@pennhousing.test', name: 'Project Administrator' } as SeedUser,

  // --- S4 fire-worker actor (web-remediation, audit #4) ---
  // A dedicated ACTIVE Quad SW the HM/BM may fire on /admin/people. Intentionally
  // obligation-free (no shifts/floats/swaps) so the e2e is date-robust: firing a
  // worker with nothing to unwind is a pure deactivate, which always succeeds
  // regardless of clock/period (avoids the now()-relative semester-boundary
  // fragility the S1/S2 week introduced). The thorough seat/float/swap unwinding is
  // the pgTAP surface (supabase/tests/s4-fire-worker.sql). Authorized actor =
  // SEED.hmQuad (existing). The Lead's seed.sql adds the matching row:
  //   uuid a0000000-0000-4000-8000-00000000000c, home_house 'quad', role 'sw',
  //   is_active=true (…000c — …000b is the project administrator). Re-seed
  //   (supabase db reset) between runs. See e2e/README.md (S4).
  fireable: { email: 'gabe.quad@pennhousing.test', name: 'Gabe Quad' } as SeedUser,
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function login(page: Page, user: SeedUser): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(user.email);
  await page.getByTestId('login-password').fill(SEED.password);
  await page.getByTestId('login-submit').click();
  // The authenticated shell renders once the session is established.
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

// ---------------------------------------------------------------------------
// Schedule builder
// ---------------------------------------------------------------------------

export async function gotoScheduleBuilder(page: Page): Promise<void> {
  await page.getByTestId('nav-schedule-builder').click();
  await expect(page.getByTestId('schedule-builder')).toBeVisible();
}

// Press-drag-release across the calendar to select a span of 30-min cells.
// `fromKey`/`toKey` are `<YYYY-MM-DD>-<HHMM>` (see SEED.blocks).
export async function dragSpan(page: Page, fromKey: string, toKey: string): Promise<void> {
  const from = page.getByTestId(`block-${fromKey}`);
  const to = page.getByTestId(`block-${toKey}`);
  await from.scrollIntoViewIfNeeded();
  await from.hover();
  await page.mouse.down();
  await to.hover();
  await page.mouse.up();
}

// A Phase-1 card group (preferred | available | blocked).
export function cardGroup(page: Page, group: 'preferred' | 'available' | 'blocked') {
  return page.getByTestId(`card-group-${group}`);
}
