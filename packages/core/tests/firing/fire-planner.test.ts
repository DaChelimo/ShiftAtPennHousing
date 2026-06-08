// S4 — Fire a worker: the pure planner `planFiring` (web-remediation session S4,
// audit #4 — "Fire (thorough tests)").
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md
//     §4.5 (firing — the multi-step contract: in-progress vacate→escalate;
//       recurring→permanent drop; non-recurring→vacate; floats voided + re-lookup
//       excluding the worker; deactivate; "no separate fired-worker vacancy state"),
//     §5.4/§5.5 (escalation), §6.1–§6.4/§6.6 (float eligibility + no-takeback +
//       force-trigger), §8.1/§8.4 (swaps + permanent drop);
//   AGENTS.md hard invariants (#3 no-takeback — WAIVED for firing; #5 30-min
//     blocks; #6 NY timestamptz).
//   docs/web-remediation/sessions/S4/TEST_PLAN.md (PIN 2 — the planner input/output
//     + the "Vitest — the planner" `should` lines this file encodes).
//
// THE MODEL (TEST_PLAN PIN 2): `planFiring` is a PURE decision oracle — zero
// Supabase imports, deterministic for a given snapshot, the clock injected as
// `snapshot.now` (an ISO string; the planner NEVER reads a wall clock). It is NOT
// called by the RPC; the RPC re-derives equivalently in SQL (parallel impls, like
// S1's evaluateAdminAssignment vs admin_assign_worker — the planner is the Vitest
// surface, the RPC the pgTAP surface in supabase/tests/s4-fire-worker.sql).
//
// Scope note (PIN 2): `assignments` carries ONLY scheduled/claimed seats. The
// worker's FLOAT seats are represented by `floats` (the snapshot is pre-filtered to
// pending|acknowledged), NOT in `assignments` — their seat-level reconciliation is
// the RPC's SQL job, out of the planner's scope. So the planner is a clean
// classifier: in-progress detection, recurring grouping, non-recurring listing, and
// float/swap pass-through.
//
// TDD-RED: `../../src/firing/index.js` does not exist yet; importing `planFiring`
// (and the contract types) is unresolved until the implementer writes the module —
// that is the intended RED, the same discipline the s1-admin-override /
// phase-06..10 fixtures use. Conform the implementation to these tests if a field
// is ambiguous at integration (PIN 2 is the contract).

import { describe, expect, it } from 'vitest';

import type {
  FiringAssignment,
  FiringFloat,
  FiringPlan,
  FiringSeatStatus,
  FiringSnapshot,
  FiringSlot,
  FiringSwap,
} from '../../src/firing/index.js';
import { planFiring } from '../../src/index.js';

// ---------------------------------------------------------------------
// Time anchors. Timestamps are ISO-8601 timestamptz strings in America/New_York
// (invariant #6). NOW is the injected clock; a block "in progress" spans exactly
// 30 minutes (block atomicity), so the in-progress seat starts at NOW. We anchor
// on a DST-stable Thursday (EDT) so day-of-week / local derivations are stable.
// ---------------------------------------------------------------------

const NOW = '2027-07-01T19:00:00-04:00'; // Thursday 19:00 EDT
const THU = 4; // Postgres DOW: 0=Sun … 6=Sat → Thursday
const FRI = 5;

const MIN_30_MS = 30 * 60 * 1000;

function iso(base: string, offsetMs: number): string {
  return new Date(new Date(base).getTime() + offsetMs).toISOString();
}
const HOURS = (n: number) => n * 60 * 60 * 1000;
const DAYS = (n: number) => n * 24 * HOURS(1);

// ---------------------------------------------------------------------
// Builders. Defaults describe an ACTIVE worker (home house-05) with no
// obligations; each test layers on exactly the facet it exercises.
// ---------------------------------------------------------------------

const WORKER = 'user-victim';
const HOUSE_A = 'house-05';
const HOUSE_B = 'house-07';

function makeAssignment(opts: Partial<FiringAssignment> = {}): FiringAssignment {
  const blockStartAt = opts.blockStartAt ?? iso(NOW, DAYS(7)); // a future Thursday by default
  return {
    assignmentId: opts.assignmentId ?? 'a-1',
    blockId: opts.blockId ?? 'b-1',
    houseId: opts.houseId ?? HOUSE_A,
    blockStartAt,
    dayOfWeek: opts.dayOfWeek ?? THU,
    blockStartLocal: opts.blockStartLocal ?? '19:00',
    status: opts.status ?? ('scheduled' as FiringSeatStatus),
    requiredHeadcount: opts.requiredHeadcount ?? 1,
    othersPresentCount: opts.othersPresentCount ?? 0,
  };
}

function makeSnapshot(opts: Partial<FiringSnapshot> = {}): FiringSnapshot {
  return {
    now: opts.now ?? NOW,
    worker: opts.worker ?? { userId: WORKER, homeHouseId: HOUSE_A, isActive: true },
    assignments: opts.assignments ?? [],
    floats: opts.floats ?? [],
    swaps: opts.swaps ?? [],
  };
}

// ---------------------------------------------------------------------
// Idempotent oracle (PIN 2).
// ---------------------------------------------------------------------

describe('planFiring — idempotency (PIN 2)', () => {
  it('should return alreadyInactive with an empty plan for an already-inactive worker', () => {
    // Even with seats / floats / swaps present, an inactive worker is a no-op.
    const plan = planFiring(
      makeSnapshot({
        worker: { userId: WORKER, homeHouseId: HOUSE_A, isActive: false },
        assignments: [
          makeAssignment({ status: 'scheduled' }),
          makeAssignment({ status: 'claimed' }),
        ],
        floats: [{ floatId: 'f-1', status: 'pending' }],
        swaps: [{ swapId: 's-1' }],
      }),
    );
    expect(plan).toEqual<FiringPlan>({
      alreadyInactive: true,
      inProgress: null,
      recurringSlotsToDrop: [],
      nonRecurringToVacate: [],
      floatsToVoid: [],
      swapsToVoid: [],
      deactivate: false,
    });
  });
});

// ---------------------------------------------------------------------
// In-progress detection (PIN 2): blockStartAt <= now < blockStartAt + 30min;
// needsEscalation = othersPresentCount < requiredHeadcount.
// ---------------------------------------------------------------------

describe('planFiring — in-progress detection (PIN 2 / PIN 3)', () => {
  it('should detect the in-progress block and flag needsEscalation when others < required', () => {
    const inProg = makeAssignment({
      assignmentId: 'a-now',
      blockId: 'b-now',
      blockStartAt: NOW, // starts exactly at now ⇒ in progress
      status: 'scheduled',
      requiredHeadcount: 2,
      othersPresentCount: 0, // vacating drops below 2
    });
    const plan = planFiring(makeSnapshot({ assignments: [inProg] }));
    expect(plan.inProgress).toEqual({
      assignmentId: 'a-now',
      blockId: 'b-now',
      needsEscalation: true,
    });
  });

  it('should detect the in-progress block and NOT flag escalation when others >= required', () => {
    const inProg = makeAssignment({
      assignmentId: 'a-now',
      blockId: 'b-now',
      blockStartAt: NOW,
      status: 'scheduled',
      requiredHeadcount: 1,
      othersPresentCount: 1, // a coworker remains ⇒ at/above headcount
    });
    const plan = planFiring(makeSnapshot({ assignments: [inProg] }));
    expect(plan.inProgress).toEqual({
      assignmentId: 'a-now',
      blockId: 'b-now',
      needsEscalation: false,
    });
  });

  it('should return null inProgress when no block straddles now', () => {
    // A seat that ENDS exactly at now (started 30 min ago) is NOT in progress
    // (the window is half-open: blockStartAt <= now < blockStartAt + 30min).
    const justEnded = makeAssignment({
      assignmentId: 'a-past',
      blockStartAt: iso(NOW, -MIN_30_MS),
      status: 'scheduled',
    });
    const future = makeAssignment({ assignmentId: 'a-future', blockStartAt: iso(NOW, HOURS(2)) });
    const plan = planFiring(makeSnapshot({ assignments: [justEnded, future] }));
    expect(plan.inProgress).toBeNull();
  });
});

// ---------------------------------------------------------------------
// Recurring → permanent drop (PIN 2): scheduled && blockStartAt > now, grouped by
// (houseId, dayOfWeek) into FiringSlots with sorted, distinct blockStartLocals.
// ---------------------------------------------------------------------

describe('planFiring — recurring slots (PIN 2)', () => {
  it('should group future scheduled seats into recurring slots by (houseId, dayOfWeek) with sorted distinct locals', () => {
    // Two Thursday occurrences of a (house-05, Thu, 17:00) slot + a second (house-05,
    // Thu, 19:00) local on the same day-of-week ⇒ one slot, two sorted locals.
    const seats = [
      makeAssignment({
        assignmentId: 'a1',
        blockId: 'b1',
        blockStartAt: iso(NOW, DAYS(7)),
        dayOfWeek: THU,
        blockStartLocal: '19:00',
      }),
      makeAssignment({
        assignmentId: 'a2',
        blockId: 'b2',
        blockStartAt: iso(NOW, DAYS(14)),
        dayOfWeek: THU,
        blockStartLocal: '19:00',
      }),
      makeAssignment({
        assignmentId: 'a3',
        blockId: 'b3',
        blockStartAt: iso(NOW, DAYS(7) - HOURS(2)),
        dayOfWeek: THU,
        blockStartLocal: '17:00',
      }),
    ];
    const plan = planFiring(makeSnapshot({ assignments: seats }));
    expect(plan.recurringSlotsToDrop).toEqual<FiringSlot[]>([
      { houseId: HOUSE_A, dayOfWeek: THU, blockStartLocals: ['17:00', '19:00'] },
    ]);
  });

  it('should exclude the in-progress (started) occurrence from recurringSlotsToDrop', () => {
    // The (house-05, Thu, 19:00) slot has a started occurrence at now and a future
    // one at +7d: only the future one feeds the slot drop (§8.4.1 skip-current).
    const seats = [
      makeAssignment({
        assignmentId: 'a-now',
        blockId: 'b-now',
        blockStartAt: NOW,
        dayOfWeek: THU,
        blockStartLocal: '19:00',
        requiredHeadcount: 1,
        othersPresentCount: 1,
      }),
      makeAssignment({
        assignmentId: 'a-future',
        blockId: 'b-future',
        blockStartAt: iso(NOW, DAYS(7)),
        dayOfWeek: THU,
        blockStartLocal: '19:00',
      }),
    ];
    const plan = planFiring(makeSnapshot({ assignments: seats }));
    expect(plan.recurringSlotsToDrop).toEqual<FiringSlot[]>([
      { houseId: HOUSE_A, dayOfWeek: THU, blockStartLocals: ['19:00'] },
    ]);
    // And the started occurrence is the inProgress seat, not a recurring drop.
    expect(plan.inProgress?.assignmentId).toBe('a-now');
  });

  it('should NOT treat a future claimed seat as recurring (it goes to nonRecurringToVacate)', () => {
    const claimed = makeAssignment({
      assignmentId: 'a-claim',
      status: 'claimed',
      blockStartAt: iso(NOW, DAYS(7)),
    });
    const plan = planFiring(makeSnapshot({ assignments: [claimed] }));
    expect(plan.recurringSlotsToDrop).toEqual([]);
    expect(plan.nonRecurringToVacate).toEqual(['a-claim']);
  });
});

// ---------------------------------------------------------------------
// Non-recurring → vacate (PIN 2): claimed && blockStartAt > now → assignmentIds.
// ---------------------------------------------------------------------

describe('planFiring — non-recurring claims (PIN 2)', () => {
  it('should list every future claimed seat assignmentId in nonRecurringToVacate', () => {
    const seats = [
      makeAssignment({ assignmentId: 'c2', status: 'claimed', blockStartAt: iso(NOW, DAYS(14)) }),
      makeAssignment({ assignmentId: 'c1', status: 'claimed', blockStartAt: iso(NOW, DAYS(7)) }),
      // a scheduled seat must NOT appear here
      makeAssignment({ assignmentId: 's1', status: 'scheduled', blockStartAt: iso(NOW, DAYS(7)) }),
    ];
    const plan = planFiring(makeSnapshot({ assignments: seats }));
    expect(plan.nonRecurringToVacate).toEqual(['c1', 'c2']); // sorted ascending
  });
});

// ---------------------------------------------------------------------
// Past seats ignored (PIN 2): a seat with blockStartAt < now and not in-progress
// is neither dropped nor vacated nor in-progress.
// ---------------------------------------------------------------------

describe('planFiring — past seats (PIN 2)', () => {
  it('should ignore PAST seats (blockStartAt < now, not in-progress) entirely', () => {
    const seats = [
      makeAssignment({
        assignmentId: 'p-sched',
        status: 'scheduled',
        blockStartAt: iso(NOW, -DAYS(7)),
      }),
      makeAssignment({
        assignmentId: 'p-claim',
        status: 'claimed',
        blockStartAt: iso(NOW, -DAYS(1)),
      }),
    ];
    const plan = planFiring(makeSnapshot({ assignments: seats }));
    expect(plan.inProgress).toBeNull();
    expect(plan.recurringSlotsToDrop).toEqual([]);
    expect(plan.nonRecurringToVacate).toEqual([]);
    // The worker is active and has nothing future ⇒ still deactivate.
    expect(plan.deactivate).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Floats + swaps pass-through (PIN 2): the snapshot is pre-filtered to
// pending|acknowledged floats / pending swaps; the planner lists them all.
// ---------------------------------------------------------------------

describe('planFiring — floats & swaps pass-through (PIN 2)', () => {
  it('should list every snapshot float in floatsToVoid and every snapshot swap in swapsToVoid', () => {
    const floats: FiringFloat[] = [
      { floatId: 'f-2', status: 'acknowledged' },
      { floatId: 'f-1', status: 'pending' },
    ];
    const swaps: FiringSwap[] = [{ swapId: 's-2' }, { swapId: 's-1' }];
    const plan = planFiring(makeSnapshot({ floats, swaps }));
    expect(plan.floatsToVoid).toEqual(['f-1', 'f-2']); // sorted ascending
    expect(plan.swapsToVoid).toEqual(['s-1', 's-2']); // sorted ascending
  });
});

// ---------------------------------------------------------------------
// Deactivate (PIN 2): true for an active worker.
// ---------------------------------------------------------------------

describe('planFiring — deactivate (PIN 2)', () => {
  it('should set deactivate=true for an active worker', () => {
    const plan = planFiring(makeSnapshot());
    expect(plan.deactivate).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Determinism (PIN 2): stable ordering — slots by (houseId, dayOfWeek), locals
// ascending, id lists ascending — regardless of input order.
// ---------------------------------------------------------------------

describe('planFiring — determinism (PIN 2)', () => {
  it('should produce deterministic (sorted) output (stable slot/id ordering)', () => {
    // Two houses × two days, supplied in scrambled order; locals scrambled too.
    const seats = [
      makeAssignment({
        assignmentId: 'z',
        blockId: 'bz',
        houseId: HOUSE_B,
        dayOfWeek: FRI,
        blockStartLocal: '16:00',
        blockStartAt: iso(NOW, DAYS(8)),
      }),
      makeAssignment({
        assignmentId: 'm',
        blockId: 'bm',
        houseId: HOUSE_A,
        dayOfWeek: THU,
        blockStartLocal: '19:00',
        blockStartAt: iso(NOW, DAYS(7)),
      }),
      makeAssignment({
        assignmentId: 'a',
        blockId: 'ba',
        houseId: HOUSE_A,
        dayOfWeek: THU,
        blockStartLocal: '17:00',
        blockStartAt: iso(NOW, DAYS(7) - HOURS(2)),
      }),
      makeAssignment({
        assignmentId: 'q',
        blockId: 'bq',
        houseId: HOUSE_A,
        dayOfWeek: FRI,
        blockStartLocal: '16:00',
        blockStartAt: iso(NOW, DAYS(1)),
      }),
    ];
    const planScrambled = planFiring(makeSnapshot({ assignments: seats }));
    const planReversed = planFiring(makeSnapshot({ assignments: [...seats].reverse() }));

    expect(planScrambled.recurringSlotsToDrop).toEqual<FiringSlot[]>([
      { houseId: HOUSE_A, dayOfWeek: THU, blockStartLocals: ['17:00', '19:00'] },
      { houseId: HOUSE_A, dayOfWeek: FRI, blockStartLocals: ['16:00'] },
      { houseId: HOUSE_B, dayOfWeek: FRI, blockStartLocals: ['16:00'] },
    ]);
    // Input order must not change the output.
    expect(planReversed).toEqual(planScrambled);
  });
});

// ---------------------------------------------------------------------
// Integration-shaped snapshot (PIN 2): the planner analogue of pgTAP section L,
// sans the SQL-only float-seat reconciliation (floats are pass-through ids only).
// ---------------------------------------------------------------------

describe('planFiring — integration-shaped snapshot (PIN 2 / §4.5)', () => {
  it('should produce a fully-populated plan for the integration-shaped snapshot', () => {
    const snapshot = makeSnapshot({
      assignments: [
        // in-progress below-headcount block (house-05, Thu, 19:00, started at now)
        makeAssignment({
          assignmentId: 'a-now',
          blockId: 'b-now',
          houseId: HOUSE_A,
          dayOfWeek: THU,
          blockStartLocal: '19:00',
          blockStartAt: NOW,
          status: 'scheduled',
          requiredHeadcount: 2,
          othersPresentCount: 0,
        }),
        // recurring slot A: (house-05, Thu, 17:00) future occurrences +7d / +14d
        makeAssignment({
          assignmentId: 'a-A1',
          blockId: 'b-A1',
          houseId: HOUSE_A,
          dayOfWeek: THU,
          blockStartLocal: '17:00',
          blockStartAt: iso(NOW, DAYS(7) - HOURS(2)),
          status: 'scheduled',
        }),
        makeAssignment({
          assignmentId: 'a-A2',
          blockId: 'b-A2',
          houseId: HOUSE_A,
          dayOfWeek: THU,
          blockStartLocal: '17:00',
          blockStartAt: iso(NOW, DAYS(14) - HOURS(2)),
          status: 'scheduled',
        }),
        // recurring slot B: (house-05, Fri, 16:00) future occurrences +1d / +8d
        makeAssignment({
          assignmentId: 'a-B1',
          blockId: 'b-B1',
          houseId: HOUSE_A,
          dayOfWeek: FRI,
          blockStartLocal: '16:00',
          blockStartAt: iso(NOW, DAYS(1) - HOURS(3)),
          status: 'scheduled',
        }),
        makeAssignment({
          assignmentId: 'a-B2',
          blockId: 'b-B2',
          houseId: HOUSE_A,
          dayOfWeek: FRI,
          blockStartLocal: '16:00',
          blockStartAt: iso(NOW, DAYS(8) - HOURS(3)),
          status: 'scheduled',
        }),
        // a future non-recurring claim (house-05, +7d 15:00)
        makeAssignment({
          assignmentId: 'a-claim',
          blockId: 'b-claim',
          houseId: HOUSE_A,
          dayOfWeek: THU,
          blockStartLocal: '15:00',
          blockStartAt: iso(NOW, DAYS(7) - HOURS(4)),
          status: 'claimed',
        }),
        // a PAST seat (must be ignored)
        makeAssignment({
          assignmentId: 'a-past',
          blockId: 'b-past',
          houseId: HOUSE_A,
          dayOfWeek: THU,
          blockStartLocal: '17:00',
          blockStartAt: iso(NOW, -DAYS(7)),
          status: 'scheduled',
        }),
      ],
      floats: [
        { floatId: 'f-out', status: 'pending' },
        { floatId: 'f-in', status: 'acknowledged' },
      ],
      swaps: [{ swapId: 's-open' }],
    });

    const plan = planFiring(snapshot);

    expect(plan).toEqual<FiringPlan>({
      alreadyInactive: false,
      inProgress: { assignmentId: 'a-now', blockId: 'b-now', needsEscalation: true },
      recurringSlotsToDrop: [
        { houseId: HOUSE_A, dayOfWeek: THU, blockStartLocals: ['17:00'] },
        { houseId: HOUSE_A, dayOfWeek: FRI, blockStartLocals: ['16:00'] },
      ],
      nonRecurringToVacate: ['a-claim'],
      floatsToVoid: ['f-in', 'f-out'],
      swapsToVoid: ['s-open'],
      deactivate: true,
    });
  });
});

// ---------------------------------------------------------------------
// Purity — same input + injected now → same output; no input mutation.
// ---------------------------------------------------------------------

describe('planFiring — purity (PIN 2 — deterministic, injected clock)', () => {
  it('the planner does not mutate its input and is deterministic for a given snapshot', () => {
    const snapshot = makeSnapshot({
      assignments: [makeAssignment({ assignmentId: 'a1', status: 'claimed' })],
      floats: [{ floatId: 'f-1', status: 'pending' }],
      swaps: [{ swapId: 's-1' }],
    });
    const snap = JSON.parse(JSON.stringify(snapshot));
    const first = planFiring(snapshot);
    const second = planFiring(snapshot);
    expect(first).toEqual(second);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snap);
  });
});
