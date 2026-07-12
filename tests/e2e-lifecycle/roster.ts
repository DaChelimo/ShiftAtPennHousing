// Pure, deterministic fixtures for the e2e-lifecycle realistic environment (PLAN §3 S2).
// No DB, no clock, no RNG — everything derives from fixed constants and array indices,
// so seed.ts and seed-check.ts (and later chunks) agree byte-for-byte on every value.
//
// Namespace discipline (PLAN §1 locked decisions): every row this program creates uses an
// `e…`-prefixed UUID and an `e.*@pennhousing.test` email. We never touch the a/b/c/d…
// phase-13b fixtures or supabase/seed.sql.

export const PERIOD_ID = 'c0000000-0000-4000-8000-000000000001'; // reuse Spring-2026 (overlap-locked)
export const PROJECT_ADMIN_ID = 'a0000000-0000-4000-8000-00000000000b'; // seeded admin@ (do not mutate)

// Build week: Mon 2026-03-02 … Sun 2026-03-08. Inside Spring-2026, clear of the 2026-02-02
// phase-13b blocks, and it contains the 2026-03-08 DST spring-forward (for S5's DST check).
export const BUILD_WEEK_START = '2026-03-02'; // Monday
export const BUILD_WEEK_END = '2026-03-08'; // Sunday
export const BUILD_WEEK_DATES = [
  '2026-03-02', // 0 Mon
  '2026-03-03', // 1 Tue
  '2026-03-04', // 2 Wed
  '2026-03-05', // 3 Thu
  '2026-03-06', // 4 Fri
  '2026-03-07', // 5 Sat
  '2026-03-08', // 6 Sun
] as const;

export const PASSWORD = 'test-Password-123'; // matches the phase-13b convention (asUser in S3)

// The operating window is 08:00–24:00 = 32 contiguous 30-min blocks (block i starts at
// 08:00 + i·30min). blockIndex/dayIndex are always derived from the DB's NY-local time so
// we never do JS DST arithmetic.
export const BLOCKS_PER_DAY = 32;
export const FIRST_BLOCK_MINUTE = 480; // 08:00

export const HOUSES = [
  'harnwell',
  'quad',
  'lower-quad',
  'gregory',
  'harrison',
  'hill',
  'kings-court',
  'lauder',
  'mayer',
  'du-bois',
  'gutmann',
  'radian',
  'rodin',
] as const;
export type HouseId = (typeof HOUSES)[number];

// regular_school_year headcounts (BSpec §3.3 / seed.sql): Harnwell 2, Quad 3, single-staff 1.
export const HEADCOUNT: Record<string, number> = Object.fromEntries(
  HOUSES.map((h) => [h, h === 'harnwell' ? 2 : h === 'quad' ? 3 : 1]),
);

// Worker headcount we create per house (PLAN S2 recommendation): Harnwell 5, Quad 8, each
// single-staff house 3 → 46 SWs.
const WORKERS_PER_HOUSE: Record<string, number> = Object.fromEntries(
  HOUSES.map((h) => [h, h === 'harnwell' ? 5 : h === 'quad' ? 8 : 3]),
);

export type Archetype = 0 | 1 | 2 | 3 | 4;
export type PrefStatus = 'preferred' | 'available' | 'cannot';

export interface Worker {
  userId: string;
  name: string;
  email: string;
  homeHouse: string;
  archetype: Archetype;
  rosterIndex: number; // 1-based global order — the deterministic tiebreaker
}

export interface AdminRole {
  role: 'hm' | 'bm' | 'sm';
  scope: string;
}

export interface Admin {
  userId: string;
  name: string;
  email: string;
  homeHouse: string;
  roles: AdminRole[];
}

// e… UUID: e0000000-0000-4000-8000-<hi:4hex><lo:8hex>. Distinct (hi, lo) ⇒ distinct id.
function eid(lo: number, hi = 0): string {
  const tail = (BigInt(hi) * 0x1_0000_0000n + BigInt(lo)).toString(16).padStart(12, '0');
  return `e0000000-0000-4000-8000-${tail}`;
}

function buildWorkers(): Worker[] {
  const out: Worker[] = [];
  let idx = 0;
  for (const house of HOUSES) {
    const n = WORKERS_PER_HOUSE[house];
    for (let i = 0; i < n; i += 1) {
      idx += 1;
      out.push({
        userId: eid(idx),
        name: `E2E ${house} SW${i + 1}`,
        email: `e.${house}.${i + 1}@pennhousing.test`,
        homeHouse: house,
        archetype: (idx % 5) as Archetype, // deterministic archetype spread
        rosterIndex: idx,
      });
    }
  }
  return out;
}

export const WORKERS: Worker[] = buildWorkers();

// A single Building Manager authorized to build EVERY house — used as both the draft
// `created_by` and the publish `p_published_by`. user_can_build_schedule(bm, house) needs a
// (bm, scope=house) role row, and user_roles' PK is (user_id, role, scope_house_id), so one
// BM can legitimately hold 13 scope rows.
export const BUILDER: Admin = {
  userId: eid(1, 0xaaaa),
  name: 'E2E Building Manager',
  email: 'e.builder@pennhousing.test',
  homeHouse: 'quad',
  roles: HOUSES.map((h) => ({ role: 'bm', scope: h })),
};

// Minimal house-scoped HMs (PLAN S2: an HM for quad, harnwell, lower-quad) for later chunks
// (HMOD/leave/escalation). The project administrator is the already-seeded admin@ (PROJECT_ADMIN_ID).
export const HMS: Admin[] = [
  {
    userId: eid(2, 0xaaaa),
    name: 'E2E HM Harnwell',
    email: 'e.hm.harnwell@pennhousing.test',
    homeHouse: 'harnwell',
    roles: [{ role: 'hm', scope: 'harnwell' }],
  },
  {
    userId: eid(3, 0xaaaa),
    name: 'E2E HM Quad',
    email: 'e.hm.quad@pennhousing.test',
    homeHouse: 'quad',
    roles: [{ role: 'hm', scope: 'quad' }],
  },
  {
    userId: eid(4, 0xaaaa),
    name: 'E2E HM House-03',
    email: 'e.hm.house03@pennhousing.test',
    homeHouse: 'lower-quad',
    roles: [{ role: 'hm', scope: 'lower-quad' }],
  },
];

// A single Site Manager scoped to EVERY house (mirrors BUILDER's all-house pattern; user_roles'
// PK is (user_id, role, scope_house_id), so one SM may hold 13 scope rows). SMs are the
// recipients of `sm_permanent_drop_alert` (scenario 4) and, in S4, see inbound floats + the live
// house schedule for their house (PLAN §2.6 #7). Added by S3 — S2's roster was HM/BM only. The
// seeded a… `sm.quad` fixture is left untouched; SM-notification scenarios use a non-quad house so
// this e… SM is the sole recipient there.
export const SM: Admin = {
  userId: eid(5, 0xaaaa),
  name: 'E2E Site Manager',
  email: 'e.sm@pennhousing.test',
  homeHouse: 'quad',
  roles: HOUSES.map((h) => ({ role: 'sm' as const, scope: h })),
};

export const ADMINS: Admin[] = [BUILDER, ...HMS, SM];

const inRange = (value: number, lo: number, hi: number): boolean => value >= lo && value <= hi;

// Deterministic preference model (PLAN S2). dayIndex: 0=Mon … 6=Sun. blockIndex: 0..31.
// We persist only the non-'available' rows; 'available' is the neutral default. The allocator
// calls THIS SAME function, so a scheduled assignment can never land on a 'cannot'.
export function prefStatus(archetype: Archetype, dayIndex: number, blockIndex: number): PrefStatus {
  const mwf = dayIndex === 0 || dayIndex === 2 || dayIndex === 4;
  const tr = dayIndex === 1 || dayIndex === 3;
  const weekend = dayIndex === 5 || dayIndex === 6;

  switch (archetype) {
    case 0: // MWF-morning classes: MWF 09:00–12:00 cannot; MWF afternoons/eves preferred
      if (mwf) {
        if (inRange(blockIndex, 2, 7)) return 'cannot';
        if (inRange(blockIndex, 16, 31)) return 'preferred';
      }
      return 'available';
    case 1: // TR-heavy: TR 09:30–15:00 cannot; TR evenings preferred
      if (tr) {
        if (inRange(blockIndex, 3, 13)) return 'cannot';
        if (inRange(blockIndex, 20, 31)) return 'preferred';
      }
      return 'available';
    case 2: // evening person: 18:00–24:00 preferred (no hard constraints)
      return inRange(blockIndex, 20, 31) ? 'preferred' : 'available';
    case 3: // night-owl: mornings 08:00–12:00 cannot; 21:00–24:00 preferred
      if (inRange(blockIndex, 0, 7)) return 'cannot';
      if (inRange(blockIndex, 26, 31)) return 'preferred';
      return 'available';
    case 4: // weekend person: Sat/Sun preferred (no hard constraints)
      return weekend ? 'preferred' : 'available';
    default:
      return 'available';
  }
}
