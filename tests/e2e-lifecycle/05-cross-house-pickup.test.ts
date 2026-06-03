// Scenario 5 (PLAN §4) — Cross-house (permanent) pickup. BSpec §5.3 + invariant 5a (pickup path).
//
// Set up permanent-drop vacancies, then `permanent_pickup_slot(picker, assigned[], skipped[])`:
// assigned seats become claimed and (for a worker whose home ≠ the seat's house) flagged
// is_cross_house_pickup with source_house_id = the picker's home; skipped seats drop off the
// permanent feed to temporary_drop. Invariant 5a: a non-Harnwell-home worker cannot pick up a
// Harnwell seat (harnwell_training_required); a Harnwell-home worker can.

import { describe, expect, it } from 'vitest';

import { inTx } from './client';
import {
  anchors,
  assignmentsForBlocks,
  expectAll,
  expectRpcErrorTx,
  getAssignments,
  permanentDropSeats,
  workerWithRun,
} from './helpers';
import { WORKERS } from './roster';

const PERM_DROP = `SELECT permanent_drop_slot($1::uuid, $2::text, $3::int, $4::text[],
  $5::timestamptz, NULL::uuid) AS r`;
const PICKUP = `SELECT permanent_pickup_slot($1::uuid, $2::uuid[], $3::uuid[]) AS r`;

const homeWorker = (house: string, exclude: string[] = []): string =>
  WORKERS.find((w) => w.homeHouse === house && !exclude.includes(w.userId))!.userId;

describe('05 cross-house pickup', () => {
  it('cross-house pickup claims + flags assigned seats; skipped seats → temporary_drop', async () => {
    await inTx(async (db) => {
      // Set up permanent-drop vacancies in house-05.
      const run = await workerWithRun(db, 'house-05', '2026-03-04');
      const t = await anchors(db, run.firstStartAt);
      await db.query(PERM_DROP, [run.userId, 'house-05', run.dow, run.hhmms, t.dayBefore]);

      const picker = homeWorker('house-04'); // home ≠ house-05 → cross-house
      const half = Math.floor(run.blockIds.length / 2);
      const assigned = run.blockIds.slice(0, half);
      const skipped = run.blockIds.slice(half);

      const { rows } = await db.query(PICKUP, [picker, assigned, skipped]);
      const result = rows[0].r as { assigned_count: number; skipped_count: number };
      expect(result.assigned_count).toBe(assigned.length);
      expect(result.skipped_count).toBe(skipped.length);

      const assignedRows = await assignmentsForBlocks(db, assigned);
      expect(assignedRows).toHaveLength(assigned.length);
      for (const a of assignedRows) {
        expect(a.status).toBe('claimed');
        expect(a.user_id).toBe(picker);
        expect(a.is_cross_house_pickup).toBe(true);
        expect(a.source_house_id).toBe('house-04');
      }

      const skippedRows = await assignmentsForBlocks(db, skipped);
      expectAll(skippedRows, 'vacant', 'temporary_drop');
    });
  });

  it('5a: a non-Harnwell-home worker cannot permanently pick up a Harnwell seat', async () => {
    await inTx(async (db) => {
      const run = await workerWithRun(db, 'harnwell', '2026-03-04');
      const t = await anchors(db, run.firstStartAt);
      await db.query(PERM_DROP, [run.userId, 'harnwell', run.dow, run.hhmms, t.dayBefore]);
      const dropped = await permanentDropSeats(db, run.blockIds); // dropper's seats (Harnwell = 2/block)

      const intruder = homeWorker('house-04');
      await expectRpcErrorTx(
        db,
        PICKUP,
        [intruder, run.blockIds, []],
        /harnwell_training_required/,
      );

      // Untouched — the dropped seats are still vacant/permanent_drop, never claimed by the intruder.
      const after = await getAssignments(db, dropped);
      expect(after).toHaveLength(run.blockIds.length);
      expectAll(after, 'vacant', 'permanent_drop');
    });
  });

  it('5a control: a Harnwell-home worker CAN pick up a Harnwell seat', async () => {
    await inTx(async (db) => {
      const run = await workerWithRun(db, 'harnwell', '2026-03-04');
      const t = await anchors(db, run.firstStartAt);
      await db.query(PERM_DROP, [run.userId, 'harnwell', run.dow, run.hhmms, t.dayBefore]);
      const dropped = await permanentDropSeats(db, run.blockIds); // dropper's seats (Harnwell = 2/block)

      const picker = homeWorker('harnwell', [run.userId]); // Harnwell-home, not the dropper
      const { rows } = await db.query(PICKUP, [picker, run.blockIds, []]);
      expect((rows[0].r as { assigned_count: number }).assigned_count).toBe(run.blockIds.length);

      const after = await getAssignments(db, dropped);
      for (const a of after) {
        expect(a.status).toBe('claimed');
        expect(a.user_id).toBe(picker);
        expect(a.is_cross_house_pickup).toBe(false); // same house — no cross-house flag
        expect(a.source_house_id).toBeNull();
      }
    });
  });
});
