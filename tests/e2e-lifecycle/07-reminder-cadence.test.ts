// Scenario 7 (PLAN §4) — Ack-reminder cadence. BSpec §7.1.
//
// A just-assigned float snapshots escalating ack reminders at deadline−{6h,2h,1h,30m,5m}, where the
// deadline is S−10m (ack_deadline_offset_minutes). Reminders already at-or-before the assignment
// instant are skipped (`snapshot_float_ack_reminders`: `t > p_now`). Reminders are `ack_reminder`
// notifications with payload kind `float_ack_reminder` (PLAN §2.4 trap: the type is `ack_reminder`).

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { inTx } from './client';
import {
  applyPlan,
  floatTimes,
  manufactureFloatGap,
  planFloat,
  setupAutomatedFloat,
} from './float-lookup-bridge';

const DEST = 'house-06';
const DATE = '2026-03-04';

/** Sorted epoch-ms of the floater's ack_reminder scheduled_for instants for a given float. */
async function reminderInstants(db: Client, floater: string, floatId: string): Promise<number[]> {
  const { rows } = await db.query(
    `SELECT scheduled_for
       FROM notifications
      WHERE recipient_user_id = $1
        AND type = 'ack_reminder'::notification_type
        AND payload ->> 'kind' = 'float_ack_reminder'
        AND payload ->> 'float_id' = $2
      ORDER BY scheduled_for`,
    [floater, floatId],
  );
  return rows.map((r) => (r.scheduled_for as Date).getTime());
}

describe('07 reminder cadence', () => {
  it('creates 5 reminders at deadline−{6h,2h,1h,30m,5m} when assigned before the window', async () => {
    await inTx(async (db) => {
      const f = await setupAutomatedFloat(db, { dest: DEST, date: DATE }); // pNow = S − 1 day
      const t = await floatTimes(db, f.S);

      const actual = await reminderInstants(db, f.floater, f.floatId);
      const expected = [t.r6h, t.r2h, t.r1h, t.r30m, t.r5m]
        .map((d) => d.getTime())
        .sort((a, b) => a - b);
      expect(actual).toEqual(expected);
    });
  });

  it('skips past-due reminders: assigning at deadline−2h leaves only the 1h/30m/5m reminders', async () => {
    await inTx(async (db) => {
      const { gap, S } = await manufactureFloatGap(db, { dest: DEST, date: DATE });
      const plan = await planFloat(db, DEST, gap);
      const t = await floatTimes(db, S);

      // Assign exactly at the 2h reminder instant → 6h and 2h are at-or-before p_now (skipped).
      const [written] = await applyPlan(db, plan, t.r2h);
      expect(written.rpc.assigned).toBe(true);

      const actual = await reminderInstants(db, written.assignment.workerId, written.rpc.float_id!);
      const expected = [t.r1h, t.r30m, t.r5m].map((d) => d.getTime()).sort((a, b) => a - b);
      expect(actual).toEqual(expected);
    });
  });
});
