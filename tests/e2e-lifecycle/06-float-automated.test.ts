// Scenario 6 (PLAN §4) — Automated float (Quad → single-staff). BSpec §6.2 + invariants 6a–6c.
//
// Manufacture a vacant gap in a single-staff house over a window Quad staffs, run the PURE
// `packages/core` float-lookup through the bridge (the same decision the orchestrator makes), and
// write it with `process_float_lookup_assignment`. Assert: a Quad floater is chosen; destination →
// pending_float_in, source → pending_float_out, float pending/automated, personal_shift notified.
// Invariants: Quad never floats to Harnwell (6a), a single-staff worker is never a source (6b), and
// the weekly hours cap is NOT consulted on float (6c).

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { inTx } from './client';
import {
  applyPlan,
  consecutiveVacant,
  manufactureFloatGap,
  planFloat,
} from './float-lookup-bridge';
import { anchors, expectAll, getAssignments, notificationsFor } from './helpers';

const DEST = 'house-05';
const DATE = '2026-03-04';

async function homeHouse(db: Client, userId: string): Promise<string> {
  const { rows } = await db.query(`SELECT home_house_id FROM users WHERE user_id = $1`, [userId]);
  return rows[0].home_house_id as string;
}

/** Direct setup-only load: claim up to `count` vacant `house` seats for `userId` from `fromDate` on. */
async function loadOverCap(
  db: Client,
  userId: string,
  house: string,
  fromDate: string,
  count: number,
): Promise<number> {
  const r = await db.query(
    `WITH pick AS (
       SELECT a.assignment_id
         FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
        WHERE b.house_id = $2 AND a.status = 'vacant'
          AND (b.block_start_at AT TIME ZONE 'America/New_York')::date >= $3::date
          AND NOT EXISTS (
            SELECT 1 FROM shift_block_assignments x JOIN shift_blocks xb ON xb.block_id = x.block_id
             WHERE x.user_id = $1 AND xb.block_start_at = b.block_start_at AND x.status <> 'vacant')
        ORDER BY b.block_start_at
        LIMIT $4)
     UPDATE shift_block_assignments y
        SET user_id = $1, status = 'claimed', vacancy_origin = 'none'
       FROM pick WHERE y.assignment_id = pick.assignment_id`,
    [userId, house, fromDate, count],
  );
  return r.rowCount ?? 0;
}

async function weeklyHours(db: Client, userId: string, anchorTs: Date): Promise<number> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS blocks
       FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
      WHERE a.user_id = $1 AND a.status IN ('scheduled', 'claimed', 'floated_in')
        AND date_trunc('week', b.block_start_at AT TIME ZONE 'America/New_York')
          = date_trunc('week', $2::timestamptz AT TIME ZONE 'America/New_York')`,
    [userId, anchorTs],
  );
  return rows[0].blocks / 2;
}

describe('06 automated float', () => {
  it('core lookup picks a Quad floater; RPC sets pending float-in/out + personal_shift notif', async () => {
    await inTx(async (db) => {
      const { gap, S, sourceWorkerIds } = await manufactureFloatGap(db, { dest: DEST, date: DATE });
      const plan = await planFloat(db, DEST, gap);

      expect(plan.result.assignments).toHaveLength(1);
      const a = plan.result.assignments[0];
      expect(a.sourceHouseId).toBe('quad');
      expect(sourceWorkerIds).toContain(a.workerId);
      expect(await homeHouse(db, a.workerId)).toBe('quad');
      expect(a.blocks.map((b) => b).sort()).toEqual(gap.map((g) => g.blockId).sort());

      const t = await anchors(db, S);
      const [written] = await applyPlan(db, plan, t.dayBefore);
      expect(written.rpc.assigned).toBe(true);
      const floatId = written.rpc.float_id!;

      const fr = await db.query(
        `SELECT status::text AS status, initiated_by::text AS initiated_by, user_id
           FROM float_assignments WHERE float_id = $1`,
        [floatId],
      );
      expect(fr.rows[0]).toMatchObject({
        status: 'pending',
        initiated_by: 'automated',
        user_id: a.workerId,
      });

      const dest = await getAssignments(db, written.destinationAssignmentIds);
      expectAll(dest, 'pending_float_in');
      for (const d of dest) {
        expect(d.user_id).toBe(a.workerId);
        expect(d.is_float).toBe(true);
        expect(d.source_house_id).toBe('quad');
      }

      const src = await getAssignments(db, written.sourceAssignmentIds);
      expectAll(src, 'pending_float_out');
      for (const s of src) expect(s.is_float).toBe(false);

      const fa = (await notificationsFor(db, a.workerId, 'personal_shift')).find(
        (n) => n.payload.float_id === floatId,
      );
      expect(fa).toBeTruthy();
      expect(fa!.payload.kind).toBe('float_assigned');
      expect(fa!.payload.destination_house_id).toBe(DEST);
    });
  });

  it('6a: a Harnwell vacancy never yields a Quad floater (Harnwell short-circuits to Allied)', async () => {
    await inTx(async (db) => {
      const gap = await consecutiveVacant(db, 'harnwell', DATE, 2);
      const plan = await planFloat(db, 'harnwell', gap);

      expect(plan.result.assignments).toHaveLength(0);
      expect(plan.result.alliedBlockIds.slice().sort()).toEqual(gap.map((g) => g.blockId).sort());
      // No float_routing row targets Harnwell — there is no Quad (or any) source to draw from.
      expect(plan.input.sources).toHaveLength(0);
    });
  });

  it('6b: the lookup never selects a single-staff (headcount-1) worker as a source', async () => {
    await inTx(async (db) => {
      const { gap } = await manufactureFloatGap(db, { dest: DEST, date: DATE });
      const plan = await planFloat(db, DEST, gap);

      for (const s of plan.input.sources) expect(['quad', 'harnwell']).toContain(s.sourceHouseId);
      expect(plan.result.assignments.length).toBeGreaterThan(0);
      for (const a of plan.result.assignments) {
        expect(['quad', 'harnwell']).toContain(await homeHouse(db, a.workerId));
      }
    });
  });

  it('6c: a worker already over the weekly hours cap is still float-eligible (cap not checked)', async () => {
    await inTx(async (db) => {
      const { gap, S } = await manufactureFloatGap(db, { dest: DEST, date: DATE });
      const floater = (await planFloat(db, DEST, gap)).result.assignments[0].workerId;

      // Load the chosen floater far past the 20h soft cap on later days (window stays clean).
      const added = await loadOverCap(db, floater, 'quad', '2026-03-05', 60);
      expect(added).toBeGreaterThanOrEqual(40);
      expect(await weeklyHours(db, floater, S)).toBeGreaterThan(20);

      // Re-plan: selection is cap-independent → the over-cap worker is still chosen…
      const plan2 = await planFloat(db, DEST, gap);
      expect(plan2.result.assignments.map((a) => a.workerId)).toContain(floater);

      // …and the write path assigns them without a cap objection.
      const t = await anchors(db, S);
      const written = await applyPlan(db, plan2, t.dayBefore);
      expect(written.find((w) => w.assignment.workerId === floater)!.rpc.assigned).toBe(true);
    });
  });
});
