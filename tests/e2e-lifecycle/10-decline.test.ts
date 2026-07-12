// Scenario 10 (PLAN §4) — Decline + reconciliation. BSpec §6.6 #7, §7.2.
//
// `decline_float` marks the float declined, re-opens the destination (vacant/temporary_drop), and
// excludes the decliner (reason 'declined'). Source-side reconciliation has two arms:
//   • restore  — the floater's home seat goes back to scheduled (the automated path always restores;
//                also the force-trigger path when its materialised source gap is still fully vacant).
//   • displace — a force-triggered float whose source fell below headcount materialised a temporary
//                'compensation' seat; if that seat was filled before the decline, the floater's home
//                seat cannot be handed back, so it re-opens as vacant/displaced_decliner.

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { inTx } from './client';
import { manufactureFloatGap, setupAutomatedFloat } from './float-lookup-bridge';
import { expectAll, freeHomeWorker, getAssignments } from './helpers';
import { BUILDER } from './roster';

const DATE = '2026-03-04';

const DECLINE = `SELECT decline_float($1::uuid, $2::uuid, $3::timestamptz) AS r`;
const FORCE = `SELECT force_trigger_float(
  $1::uuid, $2::uuid, $3::text, $4::uuid[], $5::uuid[], $6::text, $7::timestamptz) AS r`;

async function exclusionReasons(db: Client, userId: string, house: string): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT reason::text AS reason FROM float_exclusions
      WHERE user_id = $1 AND destination_house_id = $2`,
    [userId, house],
  );
  return rows.map((r) => r.reason as string);
}

async function sourceSeats(
  db: Client,
  userId: string,
  house: string,
  starts: Date[],
): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT a.assignment_id FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
      WHERE a.user_id = $1 AND b.house_id = $2 AND b.block_start_at = ANY($3::timestamptz[])
        AND a.status = 'scheduled'
      ORDER BY b.block_start_at`,
    [userId, house, starts],
  );
  return rows.map((r) => r.assignment_id as string);
}

describe('10 decline + reconciliation', () => {
  it('restore: an automated decline returns the floater to their home (source) seat', async () => {
    await inTx(async (db) => {
      const f = await setupAutomatedFloat(db, { dest: 'mayer', date: DATE });

      const dayBefore = (await db.query(`SELECT $1::timestamptz - interval '12 hours' AS t`, [f.S]))
        .rows[0].t;
      const { rows } = await db.query(DECLINE, [f.floatId, f.floater, dayBefore]);
      expect(rows[0].r).toMatchObject({ declined: true, float_id: f.floatId });

      const fr = await db.query(
        `SELECT status::text AS status, declined_at FROM float_assignments WHERE float_id = $1`,
        [f.floatId],
      );
      expect(fr.rows[0].status).toBe('declined');
      expect(fr.rows[0].declined_at).not.toBeNull();

      // Destination re-opens; source is restored to the floater.
      expectAll(await getAssignments(db, f.destinationAssignmentIds), 'vacant', 'temporary_drop');
      const src = await getAssignments(db, f.sourceAssignmentIds);
      expectAll(src, 'scheduled');
      for (const s of src) expect(s.user_id).toBe(f.floater);

      expect(await exclusionReasons(db, f.floater, 'mayer')).toContain('declined');
    });
  });

  it('displace: a force-triggered decline whose source gap was filled re-opens as displaced_decliner', async () => {
    await inTx(async (db) => {
      const { gap, starts, sourceWorkerIds } = await manufactureFloatGap(db, {
        dest: 'du-bois',
        date: DATE,
      });
      const floater = sourceWorkerIds[0];
      const srcIds = await sourceSeats(db, floater, 'quad', starts);
      const destIds = gap.map((g) => g.assignmentId);
      const before = (
        await db.query(`SELECT $1::timestamptz - interval '12 hours' AS t`, [starts[0]])
      ).rows[0].t;

      const ft = await db.query(FORCE, [
        BUILDER.userId,
        floater,
        'quad',
        srcIds,
        destIds,
        'du-bois',
        before,
      ]);
      const floatId = (ft.rows[0].r as { assigned: boolean; float_id: string }).float_id;
      expect((ft.rows[0].r as { assigned: boolean }).assigned).toBe(true);

      // The float-out dropped Quad below its headcount of 3, materialising vacant compensation seats
      // at the source. Fill one so the floater's seat can no longer be simply handed back.
      const comp = await db.query(
        `SELECT a.assignment_id, b.block_start_at
           FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
          WHERE a.parent_float_id = $1 AND a.status = 'vacant'
            AND NOT (a.assignment_id = ANY($2::uuid[]))
            AND NOT (a.assignment_id = ANY($3::uuid[]))
          ORDER BY b.block_start_at
          LIMIT 1`,
        [floatId, srcIds, destIds],
      );
      expect(comp.rows.length).toBe(1);
      const filler = await freeHomeWorker(db, 'quad', comp.rows[0].block_start_at, [floater]);
      await db.query(
        `UPDATE shift_block_assignments SET user_id = $2, status = 'claimed', vacancy_origin = 'none'
          WHERE assignment_id = $1`,
        [comp.rows[0].assignment_id, filler],
      );

      const { rows } = await db.query(DECLINE, [floatId, floater, before]);
      expect(rows[0].r).toMatchObject({ declined: true });

      // Floater's home seat cannot be restored → re-opens as displaced_decliner.
      const src = await getAssignments(db, srcIds);
      expectAll(src, 'vacant', 'displaced_decliner');
      for (const s of src) expect(s.user_id).toBeNull();

      expect(await exclusionReasons(db, floater, 'du-bois')).toContain('declined');
    });
  });
});
