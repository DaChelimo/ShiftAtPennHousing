// Scenario 14 (PLAN §4) — Reliability / fault-tolerance. AGENTS Hard Invariant #3, BSpec §10.1.
//
//   • no-takeback — once a float is pending/acknowledged, NO automated path revokes it. The only
//                   automated voider is `process_no_ack_float`; it keys off status='pending', so an
//                   acknowledged float is immune (not_pending), and a pending float is immune until
//                   its no-ack window opens (outside_lookahead). Re-running a tick never takes back
//                   an already-committed float — only a manual SM/HM/BM override may.
//   • idempotency — re-running a tick step (`process_no_ack_float`) or re-delivering a notification
//                   (`deliver_notification` / `mark_notification_read`) leaves identical end state:
//                   one void, one exclusion, one urgent notification; stamps applied exactly once.
//   • DST         — the build week's spring-forward day (2026-03-08) carries exactly 32 EDT-anchored
//                   blocks per house, contiguous in 30-minute steps; `generate_blocks_for_date` is a
//                   stable no-op on it (the generator produced precisely that set).

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { inTx } from './client';
import { setupAutomatedFloat } from './float-lookup-bridge';
import { expectAll, getAssignments } from './helpers';

const DATE = '2026-03-04';
const DST_DATE = '2026-03-08'; // spring-forward (02:00 EST → 03:00 EDT); window 08:00–24:00 is all EDT

const NO_ACK = `SELECT process_no_ack_float($1::uuid, $2::timestamptz) AS r`;
const ACK = `SELECT acknowledge_float($1::uuid, $2::uuid, $3::timestamptz) AS r`;

async function tsShift(db: Client, ts: Date, op: '+' | '-', interval: string): Promise<Date> {
  const { rows } = await db.query(`SELECT $1::timestamptz ${op} $2::interval AS t`, [ts, interval]);
  return rows[0].t as Date;
}

async function floatRow(
  db: Client,
  floatId: string,
): Promise<{ status: string; no_ack_at: Date | null }> {
  const { rows } = await db.query(
    `SELECT status::text AS status, no_ack_at FROM float_assignments WHERE float_id = $1`,
    [floatId],
  );
  return rows[0];
}

describe('14 reliability', () => {
  describe('no-takeback (inv #3)', () => {
    it('an ACKNOWLEDGED float is never revoked by the no-ack tick, even past the deadline', async () => {
      await inTx(async (db) => {
        const f = await setupAutomatedFloat(db, { dest: 'house-07', date: DATE });
        const tAck = await tsShift(db, f.S, '-', '12 hours');
        await db.query(ACK, [f.floatId, f.floater, tAck]);

        // Fire the no-ack tick at the no-ack threshold (S−15m) and again at the shift start S.
        const noAckT = await tsShift(db, f.S, '-', '15 minutes');
        expect((await db.query(NO_ACK, [f.floatId, noAckT])).rows[0].r).toMatchObject({
          processed: false,
          reason: 'not_pending',
        });
        expect((await db.query(NO_ACK, [f.floatId, f.S])).rows[0].r).toMatchObject({
          processed: false,
          reason: 'not_pending',
        });

        // The float stays acknowledged; both legs of the committed float are intact.
        const fa = await floatRow(db, f.floatId);
        expect(fa.status).toBe('acknowledged');
        expect(fa.no_ack_at).toBeNull();
        expectAll(await getAssignments(db, f.destinationAssignmentIds), 'floated_in');
        expectAll(await getAssignments(db, f.sourceAssignmentIds), 'floated_out');
      });
    });

    it('a PENDING float is not revoked by a tick that fires before its no-ack window', async () => {
      await inTx(async (db) => {
        const f = await setupAutomatedFloat(db, { dest: 'house-07', date: DATE });

        // Six hours out, the float start is far beyond the 15-minute lookahead → no-op.
        const early = await tsShift(db, f.S, '-', '6 hours');
        expect((await db.query(NO_ACK, [f.floatId, early])).rows[0].r).toMatchObject({
          processed: false,
          reason: 'outside_lookahead',
        });

        const fa = await floatRow(db, f.floatId);
        expect(fa.status).toBe('pending');
        expect(fa.no_ack_at).toBeNull();
        expectAll(await getAssignments(db, f.destinationAssignmentIds), 'pending_float_in');
        expectAll(await getAssignments(db, f.sourceAssignmentIds), 'pending_float_out');
      });
    });
  });

  describe('idempotency (§10.1)', () => {
    it('re-running process_no_ack_float at the same instant does not double-apply', async () => {
      await inTx(async (db) => {
        const f = await setupAutomatedFloat(db, { dest: 'house-07', date: DATE }); // pending, unacked
        const noAckT = await tsShift(db, f.S, '-', '15 minutes');

        const first = await db.query(NO_ACK, [f.floatId, noAckT]);
        expect(first.rows[0].r).toMatchObject({ processed: true });
        const blockId = (first.rows[0].r as { block_id: string }).block_id;

        // Second run at the same instant: the float is already voided → no-op.
        const second = await db.query(NO_ACK, [f.floatId, noAckT]);
        expect(second.rows[0].r).toMatchObject({ processed: false, reason: 'not_pending' });

        // Exactly one void, one no_acknowledgment exclusion, one urgent notification — no duplicates.
        expect((await floatRow(db, f.floatId)).status).toBe('voided');
        const exc = await db.query(
          `SELECT count(*)::int AS n FROM float_exclusions
            WHERE user_id = $1 AND reason = 'no_acknowledgment'`,
          [f.floater],
        );
        expect(exc.rows[0].n).toBe(1);
        const urgent = await db.query(
          `SELECT count(*)::int AS n FROM notifications
            WHERE type = 'hmod_urgent'::notification_type
              AND payload ->> 'reason' = 'float_no_acknowledgment'
              AND payload ->> 'block_id' = $1`,
          [blockId],
        );
        expect(urgent.rows[0].n).toBe(1);
      });
    });

    it('deliver_notification / mark_notification_read stamp exactly once (re-delivery is a no-op)', async () => {
      await inTx(async (db) => {
        const f = await setupAutomatedFloat(db, { dest: 'house-07', date: DATE });
        // The float wrote a personal_shift notification for the floater.
        const n = await db.query(
          `SELECT notification_id FROM notifications
            WHERE recipient_user_id = $1 AND type = 'personal_shift'::notification_type
            ORDER BY notification_id LIMIT 1`,
          [f.floater],
        );
        expect(n.rows.length).toBe(1);
        const notifId = n.rows[0].notification_id as string;

        const t1 = f.S;
        const t2 = await tsShift(db, f.S, '+', '1 hour');

        expect(
          (
            await db.query(`SELECT deliver_notification($1::uuid, $2::timestamptz) AS ok`, [
              notifId,
              t1,
            ])
          ).rows[0].ok,
        ).toBe(true);
        expect(
          (
            await db.query(`SELECT deliver_notification($1::uuid, $2::timestamptz) AS ok`, [
              notifId,
              t2,
            ])
          ).rows[0].ok,
        ).toBe(false);
        const delivered = await db.query(
          `SELECT delivered_at FROM notifications WHERE notification_id = $1`,
          [notifId],
        );
        expect((delivered.rows[0].delivered_at as Date).getTime()).toBe((t1 as Date).getTime());

        expect(
          (
            await db.query(
              `SELECT mark_notification_read($1::uuid, $2::uuid, $3::timestamptz) AS ok`,
              [notifId, f.floater, t1],
            )
          ).rows[0].ok,
        ).toBe(true);
        expect(
          (
            await db.query(
              `SELECT mark_notification_read($1::uuid, $2::uuid, $3::timestamptz) AS ok`,
              [notifId, f.floater, t2],
            )
          ).rows[0].ok,
        ).toBe(false);
        const ackd = await db.query(
          `SELECT acknowledged_at FROM notifications WHERE notification_id = $1`,
          [notifId],
        );
        expect((ackd.rows[0].acknowledged_at as Date).getTime()).toBe((t1 as Date).getTime());
      });
    });
  });

  describe('DST (2026-03-08 spring-forward)', () => {
    it('the spring-forward day has exactly 32 EDT-anchored blocks per house; the generator is a stable no-op', async () => {
      await inTx(async (db) => {
        // 1. Every house: exactly 32 blocks spanning NY-local 08:00 … 23:30.
        const perHouse = await db.query(
          `SELECT b.house_id, count(*)::int AS n,
                  min(to_char(b.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI')) AS first_ny,
                  max(to_char(b.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI')) AS last_ny
             FROM shift_blocks b
            WHERE (b.block_start_at AT TIME ZONE 'America/New_York')::date = $1::date
            GROUP BY b.house_id ORDER BY b.house_id`,
          [DST_DATE],
        );
        expect(perHouse.rows.length).toBe(13);
        for (const r of perHouse.rows) {
          expect(r.n).toBe(32);
          expect(r.first_ny).toBe('08:00');
          expect(r.last_ny).toBe('23:30');
        }

        // 2. EDT anchoring: the 08:00 NY block is 12:00 UTC (EDT = UTC−4). A naive EST anchor would
        //    yield 13:00 UTC — the bug the DST-correct generator avoids (PLAN §2.6 / §3 Phase-03).
        const anchor = await db.query(
          `SELECT DISTINCT to_char(b.block_start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') AS utc
             FROM shift_blocks b
            WHERE (b.block_start_at AT TIME ZONE 'America/New_York')::date = $1::date
              AND to_char(b.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI') = '08:00'`,
          [DST_DATE],
        );
        expect(anchor.rows.length).toBe(1);
        expect(anchor.rows[0].utc).toBe('2026-03-08T12:00');

        // 3. Contiguity: every consecutive pair is a 30-minute step (no block dropped or collapsed
        //    across the DST boundary — the gap is at 02:00–03:00, outside the operating window).
        const contiguous = await db.query(
          `SELECT bool_and(step = interval '30 minutes') AS all_ok FROM (
             SELECT b.block_start_at
                    - lag(b.block_start_at) OVER (PARTITION BY b.house_id ORDER BY b.block_start_at) AS step
               FROM shift_blocks b
              WHERE (b.block_start_at AT TIME ZONE 'America/New_York')::date = $1::date
           ) s WHERE step IS NOT NULL`,
          [DST_DATE],
        );
        expect(contiguous.rows[0].all_ok).toBe(true);

        // 4. The generator is idempotent on the DST day: re-running inserts 0 (the seed already
        //    produced exactly the 32/house set via the same DST-correct code path).
        const regen = await db.query(
          `SELECT blocks_inserted FROM generate_blocks_for_date($1::date)`,
          [DST_DATE],
        );
        expect(Number(regen.rows[0].blocks_inserted)).toBe(0);
      });
    });
  });
});
