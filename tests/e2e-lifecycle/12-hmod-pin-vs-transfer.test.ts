// Scenario 12 (PLAN §4) — HMOD pin vs transfer + 12a project-admin terminal. BSpec §5.4, §10.1, §2.6.
//
// PIN: a Harnwell gap can't be floated (Harnwell training invariant), so it escalates to
// HMOD/Allied. `process_hmod_notify_allied_step` resolves the recipient down a fixed chain:
//   HM (only when BOTH p_now and the block are in HM working hours) → HMOD-on-duty → project-admin.
// TRANSFER: a non-Harnwell gap the lookup can cover floats a worker in from another house.
// 12a: the project administrator is the guaranteed terminal; when it is unset and nothing else
// resolves, the step RAISE WARNINGs and returns cleanly (no recipient, no notification, no crash).

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { inTx } from './client';
import { manufactureFloatGap, planFloat } from './float-lookup-bridge';
import { anyVacant, notificationsFor } from './helpers';
import { HMS, PROJECT_ADMIN_ID } from './roster';

const DATE = '2026-03-04';
const HM_HARNWELL = HMS.find((h) => h.roles.some((r) => r.scope === 'harnwell'))!.userId;
const HM_QUAD = HMS.find((h) => h.roles.some((r) => r.scope === 'quad'))!.userId;

const HMOD_STEP = `SELECT process_hmod_notify_allied_step(
  $1::uuid, $2::text, $3::timestamptz, $4::timestamptz, $5::text) AS r`;

// Insert an HMOD rotor row for whatever week p_now lands in, computed with the resolver's OWN
// week-start formula so it matches regardless of the chosen instant.
const ROTOR_INSERT = `INSERT INTO hmod_rotor(week_start_date, hmod_user_id)
  SELECT ((( $1::timestamptz AT TIME ZONE 'America/New_York') - interval '8 hours')::date
          - (((extract(isodow FROM (( $1::timestamptz AT TIME ZONE 'America/New_York')
                                     - interval '8 hours')::date)::int + 2) % 7))),
         $2::uuid`;

interface StepResult {
  claimed: boolean;
  recipient_user_id: string | null;
  target: string | null;
}

/** Earliest vacant Harnwell seat on DATE whose start is inside HM working hours (08:00–16:30). */
async function workingHoursHarnwellBlock(
  db: Client,
): Promise<{ blockId: string; blockStartAt: Date }> {
  const { rows } = await db.query(
    `SELECT a.block_id, b.block_start_at
       FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
      WHERE b.house_id = 'harnwell' AND a.status = 'vacant'
        AND (b.block_start_at AT TIME ZONE 'America/New_York')::date = $1::date
        AND extract(hour FROM b.block_start_at AT TIME ZONE 'America/New_York') BETWEEN 8 AND 16
      ORDER BY b.block_start_at
      LIMIT 1`,
    [DATE],
  );
  expect(rows.length, 'no working-hours vacant Harnwell block').toBe(1);
  return { blockId: rows[0].block_id, blockStartAt: rows[0].block_start_at };
}

describe('12 HMOD pin vs transfer', () => {
  it('pin → HM: in working hours, a Harnwell gap notifies the house HM', async () => {
    await inTx(async (db) => {
      const blk = await workingHoursHarnwellBlock(db);
      const pNow = '2026-03-04 10:00:00-05'; // Wed 10:00 EST — HM working hours
      const r = (
        await db.query(HMOD_STEP, [
          blk.blockId,
          'harnwell',
          blk.blockStartAt,
          pNow,
          'escalation_chain',
        ])
      ).rows[0].r as StepResult;

      expect(r).toMatchObject({ claimed: true, recipient_user_id: HM_HARNWELL, target: 'hm' });
      const notif = (await notificationsFor(db, HM_HARNWELL, 'hmod_urgent')).find(
        (n) => n.payload.block_id === blk.blockId,
      );
      expect(notif).toBeTruthy();
      expect(notif!.payload).toMatchObject({ house_id: 'harnwell', reason: 'escalation_chain' });
    });
  });

  it('pin → HMOD: outside working hours, the on-duty HMOD (rotor) receives it', async () => {
    await inTx(async (db) => {
      const blk = await anyVacant(db, 'harnwell', DATE);
      const pNow = '2026-03-04 22:00:00-05'; // Wed 22:00 EST — outside HM working hours
      await db.query(ROTOR_INSERT, [pNow, HM_QUAD]);

      const r = (
        await db.query(HMOD_STEP, [
          blk.blockId,
          'harnwell',
          blk.blockStartAt,
          pNow,
          'escalation_chain',
        ])
      ).rows[0].r as StepResult;
      expect(r).toMatchObject({ claimed: true, recipient_user_id: HM_QUAD, target: 'hmod' });
    });
  });

  it('12a pin → project-admin terminal: HM+HMOD unresolved fall through to the configured admin', async () => {
    await inTx(async (db) => {
      const blk = await anyVacant(db, 'harnwell', DATE);
      const pNow = '2026-03-04 22:00:00-05'; // outside working hours, NO rotor → HMOD null
      const r = (
        await db.query(HMOD_STEP, [
          blk.blockId,
          'harnwell',
          blk.blockStartAt,
          pNow,
          'escalation_chain',
        ])
      ).rows[0].r as StepResult;

      expect(r).toMatchObject({
        claimed: true,
        recipient_user_id: PROJECT_ADMIN_ID,
        target: 'project_admin',
      });
      const notif = (await notificationsFor(db, PROJECT_ADMIN_ID, 'hmod_urgent')).find(
        (n) => n.payload.block_id === blk.blockId,
      );
      expect(notif).toBeTruthy();
    });
  });

  it('12a unset terminal: nothing resolves → claimed, no recipient, no notification, no crash', async () => {
    await inTx(async (db) => {
      const blk = await anyVacant(db, 'rodin', DATE); // rodin has no HM
      const pNow = '2026-03-04 10:00:00-05';
      await db.query(
        `DELETE FROM system_config WHERE config_key = 'project_administrator_user_id'`,
      );

      const r = (
        await db.query(HMOD_STEP, [
          blk.blockId,
          'rodin',
          blk.blockStartAt,
          pNow,
          'escalation_chain',
        ])
      ).rows[0].r as StepResult;
      expect(r.claimed).toBe(true);
      expect(r.recipient_user_id).toBeNull();

      const n = await db.query(
        `SELECT count(*)::int AS n FROM notifications
          WHERE type = 'hmod_urgent'::notification_type AND payload ->> 'block_id' = $1`,
        [blk.blockId],
      );
      expect(n.rows[0].n).toBe(0);
    });
  });

  it('transfer: a non-Harnwell gap the lookup can cover floats a worker in from another house', async () => {
    await inTx(async (db) => {
      const { gap } = await manufactureFloatGap(db, { dest: 'radian', date: DATE });
      const plan = await planFloat(db, 'radian', gap);

      expect(plan.result.assignments.length).toBeGreaterThan(0);
      const a = plan.result.assignments[0];
      const { rows } = await db.query(`SELECT home_house_id FROM users WHERE user_id = $1`, [
        a.workerId,
      ]);
      expect(rows[0].home_house_id).toBe('quad'); // transfers in from Quad, not radian
      expect(rows[0].home_house_id).not.toBe('radian');
    });
  });
});
