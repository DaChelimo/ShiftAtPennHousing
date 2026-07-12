// Action-inbox pure predicates: `isDue` / `isResolvedAllied` and the Allied
// coverage-window lifecycle (`alliedWindowEndIso` / `alliedLifecycle`).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §5.4 (escalation — T-2h float-lookup failure →
//     HMOD notified that Allied coverage is required; "once Allied is assigned,
//     the gap is considered resolved"), §10.1 (HM/BM/HMOD/RSM routing).
//   docs/design-brief.md §6.4 (the Action inbox — read/unread, urgency, grouping).
//
// THE MODEL: `packages/core/src/inbox/index.ts` is a PURE module (zero Supabase
// imports) the data layer (`apps/web/lib/data/inbox.ts`) uses to derive each Allied
// alert's coverage-window lifecycle:
//
//   - isDue(input, nowIso)            — no schedule, or scheduled at/before now.
//   - isResolvedAllied(input)         — hmod_urgent && resolvedAtIso !== null.
//   - alliedWindowEndIso(input)       — the coverage window's end: stored block_end,
//                                       else block_start + 30m, else null.
//   - alliedLifecycle(input, nowIso)  — 'active' before the window ends, 'archived'
//                                       for 24h after, 'discarded' thereafter.

import { describe, expect, it } from 'vitest';

import {
  alliedLifecycle,
  alliedWindowEndIso,
  isDue,
  isResolvedAllied,
  type InboxFilterInput,
} from '../../src/inbox/index.js';

// 2026-06-07T12:00:00 America/New_York (EDT, -04:00) == 2026-06-07T16:00:00Z.
const NOW_ISO = '2026-06-07T12:00:00-04:00';

function input(over: Partial<InboxFilterInput> = {}): InboxFilterInput {
  return {
    type: over.type ?? 'hmod_urgent',
    scheduledForIso: over.scheduledForIso === undefined ? null : over.scheduledForIso,
    resolvedAtIso: over.resolvedAtIso === undefined ? null : over.resolvedAtIso,
    blockStartIso: over.blockStartIso,
    blockEndIso: over.blockEndIso,
  };
}

// =====================================================================
// isDue — the #18b due gate.
// =====================================================================

describe('isDue — the due gate (#18b)', () => {
  it('should treat a null scheduledFor as due', () => {
    expect(isDue(input({ scheduledForIso: null }), NOW_ISO)).toBe(true);
  });

  it('should treat scheduledFor at or before now as due, and after now as not due', () => {
    // Exactly now (boundary inclusive) — expressed in UTC, the same instant as NOW_ISO.
    expect(isDue(input({ scheduledForIso: '2026-06-07T16:00:00Z' }), NOW_ISO)).toBe(true);
    // Strictly before now (an hour earlier, different offset).
    expect(isDue(input({ scheduledForIso: '2026-06-07T11:00:00-04:00' }), NOW_ISO)).toBe(true);
    // Strictly after now (an hour later, expressed in a +01:00 zone == 13:00 EDT).
    expect(isDue(input({ scheduledForIso: '2026-06-07T18:00:00+01:00' }), NOW_ISO)).toBe(false);
  });
});

// =====================================================================
// isResolvedAllied — the resolved-Allied predicate.
// =====================================================================

describe('isResolvedAllied — a resolved Allied alert', () => {
  it('should mark only hmod_urgent with a resolvedAt as a resolved Allied alert', () => {
    expect(
      isResolvedAllied(input({ type: 'hmod_urgent', resolvedAtIso: '2026-06-07T11:30:00-04:00' })),
    ).toBe(true);
    expect(isResolvedAllied(input({ type: 'hmod_urgent', resolvedAtIso: null }))).toBe(false);
    // A resolvedAt on a NON-urgent type → NOT a resolved Allied alert.
    expect(
      isResolvedAllied(
        input({ type: 'hm_leave_notice', resolvedAtIso: '2026-06-07T11:30:00-04:00' }),
      ),
    ).toBe(false);
  });
});

// =====================================================================
// alliedWindowEndIso — the coverage window's end instant.
// =====================================================================

describe('alliedWindowEndIso — the coverage window end', () => {
  it('should prefer the stored block_end over the start+30 fallback', () => {
    const end = alliedWindowEndIso(
      input({ blockStartIso: '2026-06-07T22:00:00-04:00', blockEndIso: '2026-06-07T23:00:00-04:00' }),
    );
    expect(new Date(end!).getTime()).toBe(new Date('2026-06-07T23:00:00-04:00').getTime());
  });

  it('should fall back to block_start + 30 minutes when block_end is absent (per-block / legacy)', () => {
    const end = alliedWindowEndIso(input({ blockStartIso: '2026-06-07T22:00:00-04:00' }));
    expect(new Date(end!).getTime()).toBe(new Date('2026-06-07T22:30:00-04:00').getTime());
  });

  it('should return null for a non-Allied row, or an Allied row with no window', () => {
    expect(alliedWindowEndIso(input({ type: 'swap_request', blockStartIso: '2026-06-07T22:00:00-04:00' }))).toBeNull();
    expect(alliedWindowEndIso(input({ type: 'hmod_urgent', blockStartIso: null, blockEndIso: null }))).toBeNull();
  });
});

// =====================================================================
// alliedLifecycle — active → archived (24h) → discarded.
// =====================================================================

describe('alliedLifecycle — coverage-window lifecycle', () => {
  it("should be 'active' while the window has not yet ended", () => {
    // Window 12:30–13:00 EDT, now is 12:00 EDT → not yet ended.
    expect(
      alliedLifecycle(input({ blockStartIso: '2026-06-07T12:30:00-04:00' }), NOW_ISO),
    ).toBe('active');
  });

  it("should be 'archived' once the window has ended but within the last 24h — even if unresolved", () => {
    // Window 10:00–11:00 EDT (ended an hour before now), unresolved.
    expect(
      alliedLifecycle(
        input({
          resolvedAtIso: null,
          blockStartIso: '2026-06-07T10:00:00-04:00',
          blockEndIso: '2026-06-07T11:00:00-04:00',
        }),
        NOW_ISO,
      ),
    ).toBe('archived');
  });

  it("should keep the archive window half-open: still 'archived' just under 24h, 'discarded' at exactly 24h", () => {
    // Archive period is [end, end+24h). now is 12:00 EDT 06-07.
    // Window ended 23h59m ago → still inside the day-long archive.
    const justInside = input({ blockEndIso: '2026-06-06T12:01:00-04:00', blockStartIso: '2026-06-06T11:30:00-04:00' });
    expect(alliedLifecycle(justInside, NOW_ISO)).toBe('archived');
    // Window ended exactly 24h ago → at the boundary the archive has expired.
    const atBoundary = input({ blockEndIso: '2026-06-06T12:00:00-04:00', blockStartIso: '2026-06-06T11:30:00-04:00' });
    expect(alliedLifecycle(atBoundary, NOW_ISO)).toBe('discarded');
  });

  it('should archive on the TRUE window end — a multi-block gap is still active 31 min after its start', () => {
    // 22:00–23:00 gap. "now" 22:31 (block_start+31): start+30 would (wrongly) archive,
    // but the stored block_end keeps it active until 23:00.
    const now = '2026-06-07T22:31:00-04:00';
    expect(
      alliedLifecycle(
        input({ blockStartIso: '2026-06-07T22:00:00-04:00', blockEndIso: '2026-06-07T23:00:00-04:00' }),
        now,
      ),
    ).toBe('active');
  });

  it("should treat a non-Allied row as always 'active' (no coverage lifecycle)", () => {
    expect(
      alliedLifecycle(input({ type: 'swap_request', blockStartIso: '2026-06-01T10:00:00-04:00' }), NOW_ISO),
    ).toBe('active');
  });
});
