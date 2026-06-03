// Scenario 2 (PLAN §4) — Claim an open shift (BSpec §5.4) + invariant 5a (claim path, §1.2).
//
// `claim_open_shift(assignment_id, user_id, as_of)` flips a vacant seat to claimed. The regular
// school year cap is SOFT, so claims that push a worker past 20h still succeed (a hard cap would
// raise) — that is the "soft-warn, don't block" behaviour. Invariant 5a: a non-Harnwell-home
// worker is rejected from a Harnwell seat; a Harnwell-home worker is not.

import { describe, expect, it } from 'vitest';

import { inTx } from './client';
import {
  anchors,
  anyVacant,
  effectiveCap,
  expectRpcErrorTx,
  freeHomeWorker,
  getAssignment,
  vacantAt,
} from './helpers';
import { BUILD_WEEK_END, BUILD_WEEK_START, WORKERS } from './roster';

const CLAIM = `SELECT claim_open_shift($1::uuid, $2::uuid, $3::timestamptz) AS id`;

describe('02 claim', () => {
  it('claims a vacant same-house shift: vacant → claimed, owner set', async () => {
    await inTx(async (db) => {
      const seat = await vacantAt(db, 'house-06', '2026-03-04', '20:00');
      const worker = await freeHomeWorker(db, 'house-06', seat.blockStartAt);
      const t = await anchors(db, seat.blockStartAt);

      const { rows } = await db.query(CLAIM, [seat.assignmentId, worker, t.dayBefore]);
      expect(rows[0].id).toBe(seat.assignmentId);

      const after = await getAssignment(db, seat.assignmentId);
      expect(after.status).toBe('claimed');
      expect(after.user_id).toBe(worker);
      expect(after.vacancy_origin).toBe('none');
      expect(after.is_cross_house_pickup).toBe(false);
      expect(after.source_house_id).toBeNull();
    });
  });

  it('soft cap: claims past 20h still succeed (regular school year is soft)', async () => {
    await inTx(async (db) => {
      const seat = await vacantAt(db, 'house-06', '2026-03-04', '20:00');
      const cap = await effectiveCap(db, seat.blockStartAt);
      expect(cap.hours_cap).toBe(20);
      expect(cap.cap_enforcement).toBe('soft');

      const worker = WORKERS.find((w) => w.homeHouse === 'house-06')!.userId;
      const t = await anchors(db, seat.blockStartAt);

      // Distinct-time vacant house-06 seats this worker doesn't already occupy.
      const supply = await db.query(
        `SELECT a.assignment_id, b.block_start_at
           FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
          WHERE a.status = 'vacant' AND b.house_id = 'house-06'
            AND (b.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN $1 AND $2
            AND b.block_start_at > $3::timestamptz + interval '2 hours'
            AND b.block_start_at NOT IN (
              SELECT b2.block_start_at FROM shift_block_assignments x
                JOIN shift_blocks b2 ON b2.block_id = x.block_id
               WHERE x.user_id = $4 AND x.status <> 'vacant')
          ORDER BY b.block_start_at`,
        [BUILD_WEEK_START, BUILD_WEEK_END, t.dayBefore, worker],
      );

      const weekBlocks = async (): Promise<number> =>
        (
          await db.query(
            `SELECT count(*)::int AS n FROM shift_block_assignments a
               JOIN shift_blocks b ON b.block_id = a.block_id
              WHERE a.user_id = $1
                AND a.status IN ('scheduled','claimed','floated_in','pending_float_in')
                AND (b.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN $2 AND $3`,
            [worker, BUILD_WEEK_START, BUILD_WEEK_END],
          )
        ).rows[0].n;

      const start = await weekBlocks();
      const need = 41 - start; // cross 40 blocks = 20h
      expect(supply.rows.length).toBeGreaterThanOrEqual(need);

      for (let i = 0; i < need; i += 1) {
        const { rows } = await db.query(CLAIM, [supply.rows[i].assignment_id, worker, t.dayBefore]);
        expect(rows[0].id, `claim #${i} should succeed under a soft cap`).toBe(
          supply.rows[i].assignment_id,
        );
      }
      expect(await weekBlocks()).toBeGreaterThan(40); // > 20h, no hard rejection
    });
  });

  it('5a: a non-Harnwell-home worker cannot claim a Harnwell seat', async () => {
    await inTx(async (db) => {
      const seat = await anyVacant(db, 'harnwell', '2026-03-04');
      const intruder = WORKERS.find((w) => w.homeHouse === 'house-06')!.userId;
      const t = await anchors(db, seat.blockStartAt);

      await expectRpcErrorTx(db, CLAIM, [seat.assignmentId, intruder, t.dayBefore], /cross_house/);

      // Still vacant — the rejected claim left no trace.
      expect((await getAssignment(db, seat.assignmentId)).status).toBe('vacant');
    });
  });

  it('5a control: a Harnwell-home worker CAN claim a Harnwell seat', async () => {
    await inTx(async (db) => {
      const seat = await anyVacant(db, 'harnwell', '2026-03-04');
      const worker = await freeHomeWorker(db, 'harnwell', seat.blockStartAt);
      const t = await anchors(db, seat.blockStartAt);

      const { rows } = await db.query(CLAIM, [seat.assignmentId, worker, t.dayBefore]);
      expect(rows[0].id).toBe(seat.assignmentId);

      const after = await getAssignment(db, seat.assignmentId);
      expect(after.status).toBe('claimed');
      expect(after.user_id).toBe(worker);
      expect(after.is_cross_house_pickup).toBe(false);
    });
  });
});
