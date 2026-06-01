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
  // An HM at another house whose ACTIVE leave delegation currently resolves THROUGH
  // hmQuad (i.e. hmQuad is in this HM's forward chain) → this HM is in hmQuad's
  // *incoming chain* and MUST be excluded from hmQuad's replacement picker (BEH §2.6
  // cycle-prevention-at-selection-time). The seed creates this HM's active hm_leave
  // row naming hmQuad (directly or transitively) as replacement.
  hmIncoming: { email: 'hm.incoming@pennhousing.test', name: 'Ingrid Incoming' } as SeedUser,
  // The project administrator — ALWAYS a valid terminal replacement, never excluded
  // (BEH §2.6: "The project administrator is always a valid terminal selection").
  projectAdmin: { email: 'admin@pennhousing.test', name: 'Project Administrator' } as SeedUser,
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
