// Scenario 9 (PLAN §4) — No-acknowledgment. BSpec §7.3.
//
// When a pending float is not acknowledged by the deadline, `process_no_ack_float` (fired at
// p_now ≥ S−15m = deadline − no_ack_trigger) voids it, re-opens the destination as the original gap
// (vacant/temporary_drop — NOT displaced_decliner; PLAN §4's label is the force-trigger *source*
// branch, §2.6 #8: assert the code), excludes the unresponsive worker (no_acknowledgment), restores
// the automated floater's home seat, and escalates the gap to HMOD/Allied.

import { describe, expect, it } from 'vitest';

import { inTx } from './client';
import { floatTimes, setupAutomatedFloat } from './float-lookup-bridge';
import { expectAll, getAssignments, notificationsFor } from './helpers';
import { PROJECT_ADMIN_ID } from './roster';

const DEST = 'lauder';
const DATE = '2026-03-04';

const NO_ACK = `SELECT process_no_ack_float($1::uuid, $2::timestamptz, 15) AS r`;

describe('09 no-ack float', () => {
  it('voids the float, re-opens the gap, excludes the worker, restores source, escalates HMOD', async () => {
    await inTx(async (db) => {
      const f = await setupAutomatedFloat(db, { dest: DEST, date: DATE });
      const t = await floatTimes(db, f.S);

      const { rows } = await db.query(NO_ACK, [f.floatId, t.noAckAt]); // p_now = S − 15m
      const r = rows[0].r as { processed: boolean; house_id: string; hmod_step_claimed: boolean };
      expect(r.processed).toBe(true);
      expect(r.house_id).toBe(DEST);
      expect(r.hmod_step_claimed).toBe(true);

      const fr = await db.query(
        `SELECT status::text AS status, no_ack_at FROM float_assignments WHERE float_id = $1`,
        [f.floatId],
      );
      expect(fr.rows[0].status).toBe('voided');
      expect(fr.rows[0].no_ack_at).not.toBeNull();

      // Destination re-opens as the original temporary-drop gap.
      expectAll(await getAssignments(db, f.destinationAssignmentIds), 'vacant', 'temporary_drop');

      // Automated source is restored to the floater.
      const src = await getAssignments(db, f.sourceAssignmentIds);
      expectAll(src, 'scheduled');
      for (const s of src) expect(s.user_id).toBe(f.floater);

      // Exclusion recorded with reason no_acknowledgment for this worker + destination.
      const excl = await db.query(
        `SELECT reason::text AS reason FROM float_exclusions
          WHERE user_id = $1 AND destination_house_id = $2`,
        [f.floater, DEST],
      );
      expect(excl.rows.map((x) => x.reason)).toContain('no_acknowledgment');

      // HMOD/Allied escalation: an hmod_urgent for the gap. lauder has no HM and the rotor is
      // empty, so the guaranteed terminal (project administrator) receives it.
      const urgent = await notificationsFor(db, PROJECT_ADMIN_ID, 'hmod_urgent');
      const mine = urgent.find((n) => n.payload.house_id === DEST);
      expect(mine).toBeTruthy();
      expect(mine!.payload.reason).toBe('float_no_acknowledgment');
    });
  });

  it('a no-ack outside the lookahead window does not fire', async () => {
    await inTx(async (db) => {
      const f = await setupAutomatedFloat(db, { dest: DEST, date: DATE });
      // p_now well before S − 15m → outside_lookahead, nothing happens.
      const early = (await db.query(`SELECT $1::timestamptz - interval '2 hours' AS t`, [f.S]))
        .rows[0].t;
      const { rows } = await db.query(NO_ACK, [f.floatId, early]);
      expect(rows[0].r).toMatchObject({ processed: false, reason: 'outside_lookahead' });

      const fr = await db.query(
        `SELECT status::text AS s FROM float_assignments WHERE float_id=$1`,
        [f.floatId],
      );
      expect(fr.rows[0].s).toBe('pending');
    });
  });
});
