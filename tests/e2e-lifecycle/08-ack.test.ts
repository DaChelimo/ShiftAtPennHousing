// Scenario 8 (PLAN §4) — Acknowledge a float. BSpec §7.
//
// `acknowledge_float` flips the destination pending_float_in → floated_in, the source
// pending_float_out → floated_out, and the float pending → acknowledged (acknowledged_at set). Once
// acknowledged, the float's still-future ack reminders disappear from `pending_notification_deliveries`
// (the defensive re-check: it only emits ack_reminders whose float is still pending).

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { inTx } from './client';
import { floatTimes, setupAutomatedFloat } from './float-lookup-bridge';
import { expectAll, getAssignments } from './helpers';

const DEST = 'kings-court';
const DATE = '2026-03-04';

const ACK = `SELECT acknowledge_float($1::uuid, $2::uuid, $3::timestamptz) AS r`;

/** Count of a float's still-pending ack_reminder deliveries at p_now. */
async function pendingReminderCount(db: Client, floatId: string, pNow: Date): Promise<number> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n
       FROM pending_notification_deliveries($1) d
      WHERE d.type = 'ack_reminder'::notification_type
        AND d.payload ->> 'float_id' = $2`,
    [pNow, floatId],
  );
  return rows[0].n as number;
}

describe('08 acknowledge float', () => {
  it('acknowledge → dest floated_in, source floated_out, status acknowledged; reminders drop', async () => {
    await inTx(async (db) => {
      const f = await setupAutomatedFloat(db, { dest: DEST, date: DATE });
      const t = await floatTimes(db, f.S);

      // Before ack: all 5 reminders are deliverable at S (scheduled_for ≤ S, float still pending).
      expect(await pendingReminderCount(db, f.floatId, f.S)).toBe(5);

      const { rows } = await db.query(ACK, [f.floatId, f.floater, t.r6h]);
      expect(rows[0].r).toMatchObject({ acknowledged: true, float_id: f.floatId });

      const fr = await db.query(
        `SELECT status::text AS status, acknowledged_at FROM float_assignments WHERE float_id = $1`,
        [f.floatId],
      );
      expect(fr.rows[0].status).toBe('acknowledged');
      expect(fr.rows[0].acknowledged_at).not.toBeNull();

      expectAll(await getAssignments(db, f.destinationAssignmentIds), 'floated_in');
      expectAll(await getAssignments(db, f.sourceAssignmentIds), 'floated_out');

      // After ack: the float is no longer pending → its reminders are suppressed from delivery,
      // even though the notification rows still physically exist.
      expect(await pendingReminderCount(db, f.floatId, f.S)).toBe(0);
      const stillStored = await db.query(
        `SELECT count(*)::int AS n FROM notifications
          WHERE type = 'ack_reminder'::notification_type AND payload ->> 'float_id' = $1`,
        [f.floatId],
      );
      expect(stillStored.rows[0].n).toBe(5);
    });
  });

  it('acknowledging an already-acknowledged float is a no-op (not_pending)', async () => {
    await inTx(async (db) => {
      const f = await setupAutomatedFloat(db, { dest: DEST, date: DATE });
      const t = await floatTimes(db, f.S);
      await db.query(ACK, [f.floatId, f.floater, t.r6h]);

      const { rows } = await db.query(ACK, [f.floatId, f.floater, t.r2h]);
      expect(rows[0].r).toMatchObject({ acknowledged: false, reason: 'not_pending' });
    });
  });
});
