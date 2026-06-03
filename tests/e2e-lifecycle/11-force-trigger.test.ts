// Scenario 11 (PLAN §4) — Force-trigger. BSpec §6.6.
//
// `force_trigger_float` assigns a worker manually (no automatic lookup): the float is pending with
// initiated_by = force_triggered and force_triggered_by = the initiator; destination →
// pending_float_in, source → pending_float_out; the float-out drops the source below headcount, so a
// vacant 'temporary_drop' compensation seat is materialised — and it surfaces in the open-shifts feed
// for the source house. The worker is notified (personal_shift) so they can acknowledge / decline.

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { inTx } from './client';
import { manufactureFloatGap } from './float-lookup-bridge';
import { expectAll, getAssignments, notificationsFor } from './helpers';
import { BUILDER } from './roster';

const DEST = 'house-11';
const DATE = '2026-03-04';

const FORCE = `SELECT force_trigger_float(
  $1::uuid, $2::uuid, $3::text, $4::uuid[], $5::uuid[], $6::text, $7::timestamptz) AS r`;

async function sourceSeats(db: Client, userId: string, starts: Date[]): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT a.assignment_id FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
      WHERE a.user_id = $1 AND b.house_id = 'quad' AND b.block_start_at = ANY($2::timestamptz[])
        AND a.status = 'scheduled'
      ORDER BY b.block_start_at`,
    [userId, starts],
  );
  return rows.map((r) => r.assignment_id as string);
}

describe('11 force-trigger float', () => {
  it('assigns pending/force_triggered; source gap surfaces in open-shifts feed; worker notified', async () => {
    await inTx(async (db) => {
      const { gap, starts, sourceWorkerIds } = await manufactureFloatGap(db, {
        dest: DEST,
        date: DATE,
      });
      const floater = sourceWorkerIds[0];
      const srcIds = await sourceSeats(db, floater, starts);
      const destIds = gap.map((g) => g.assignmentId);
      // Pre-T-2h (well before the automatic float-lookup window): a full day ahead.
      const before = (await db.query(`SELECT $1::timestamptz - interval '1 day' AS t`, [starts[0]]))
        .rows[0].t;

      const ft = await db.query(FORCE, [
        BUILDER.userId,
        floater,
        'quad',
        srcIds,
        destIds,
        DEST,
        before,
      ]);
      const r = ft.rows[0].r as { assigned: boolean; float_id: string };
      expect(r.assigned).toBe(true);

      const fr = await db.query(
        `SELECT status::text AS status, initiated_by::text AS initiated_by, force_triggered_by, user_id
           FROM float_assignments WHERE float_id = $1`,
        [r.float_id],
      );
      expect(fr.rows[0]).toMatchObject({
        status: 'pending',
        initiated_by: 'force_triggered',
        force_triggered_by: BUILDER.userId,
        user_id: floater,
      });

      const dest = await getAssignments(db, destIds);
      expectAll(dest, 'pending_float_in');
      for (const d of dest) {
        expect(d.user_id).toBe(floater);
        expect(d.source_house_id).toBe('quad');
      }
      expectAll(await getAssignments(db, srcIds), 'pending_float_out');

      // Source-side gap materialised as a vacant temporary_drop seat tied to this float…
      const comp = await db.query(
        `SELECT a.assignment_id FROM shift_block_assignments a
          WHERE a.parent_float_id = $1 AND a.status = 'vacant' AND a.vacancy_origin = 'temporary_drop'
            AND NOT (a.assignment_id = ANY($2::uuid[]))`,
        [r.float_id, [...srcIds, ...destIds]],
      );
      expect(comp.rows.length).toBeGreaterThan(0);

      // …and it surfaces in the source house's open-shifts feed.
      const feed = await db.query(
        `SELECT assignment_id FROM weekly_open_shifts_feed('quad', $1::timestamptz)`,
        [before],
      );
      const feedIds = new Set(feed.rows.map((x) => x.assignment_id as string));
      expect(comp.rows.every((c) => feedIds.has(c.assignment_id as string))).toBe(true);

      const fa = (await notificationsFor(db, floater, 'personal_shift')).find(
        (n) => n.payload.float_id === r.float_id,
      );
      expect(fa).toBeTruthy();
      expect(fa!.payload.kind).toBe('float_assigned');
      expect(fa!.payload.initiated_by).toBe('force_triggered');
      expect(fa!.payload.force_triggered_by).toBe(BUILDER.userId);
    });
  });
});
