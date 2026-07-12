// Scenario 13 (PLAN §4) — Swaps. BSpec §8.1–8.3.
//
// Swap CREATION is the create-swap Edge Function in production; the harness replicates its
// swap_requests INSERT (swap-bridge.ts `createSwap`), then drives the pure acceptance RPCs
// (`accept_swap` / `apply_permanent_swap`), the acceptance-ineligibility helper
// (`swap_acceptance_ineligibility_reason`), and the expiry scan (`expire_pending_swaps`) directly
// with an injected `p_now` — mirroring how S4 bypassed orchestrator-tick. Each test runs in its own
// BEGIN…ROLLBACK transaction (client.ts `inTx`), so the committed published baseline stays pristine.
//
//   • shift swap     — accept_swap atomically exchanges seat ownership (§8.1).
//   • float swap     — accept_swap reassigns the active float (float_assignments.user_id) and
//                      notifies the destination SM of the corrected floater (§8.2).
//   • permanent swap — apply_permanent_swap bulk-transfers only the initiator-owned regular-year
//                      seats (§8.3, ARCH §8.4 ownership predicate).
//   • expiry         — expire_pending_swaps flips overdue pending rows (idempotently); an expired
//                      swap can no longer be accepted.
//   • ineligibility  — the acceptance guard refuses Harnwell-training / single-staff-float /
//                      pending-float swaps (shared vocabulary, AGENTS Hard Invariants #1/#2).

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { inTx } from './client';
import { setupAutomatedFloat } from './float-lookup-bridge';
import { expectAll, getAssignment, getAssignments, workerWithRun } from './helpers';
import { SM } from './roster';
import { createSwap, tsShift } from './swap-bridge';

const DATE = '2026-03-04'; // a Wednesday inside the published build week (all regular_school_year)

const ACCEPT = `SELECT accept_swap($1::uuid, $2::uuid, $3::timestamptz) AS r`;
const APPLY_PERMANENT = `SELECT apply_permanent_swap($1::uuid, $2::uuid, $3::uuid[], $4::timestamptz) AS r`;
const INELIGIBILITY = `SELECT swap_acceptance_ineligibility_reason($1::uuid) AS reason`;
const ACK = `SELECT acknowledge_float($1::uuid, $2::uuid, $3::timestamptz) AS r`;

async function swapStatus(db: Client, swapId: string): Promise<string> {
  const { rows } = await db.query(
    `SELECT status::text AS s FROM swap_requests WHERE swap_id = $1`,
    [swapId],
  );
  return rows[0].s as string;
}

describe('13 swaps', () => {
  it('shift swap: accept_swap atomically exchanges seat ownership (§8.1)', async () => {
    await inTx(async (db) => {
      const runA = await workerWithRun(db, 'lauder', DATE);
      const runB = await workerWithRun(db, 'mayer', DATE);
      const a1 = runA.assignmentIds[0];
      const b1 = runB.assignmentIds[0];

      const { swapId, expiresAt } = await createSwap(db, {
        swapType: 'shift_swap',
        initiator: runA.userId,
        counterparty: runB.userId,
        initiatorAssignmentIds: [a1],
        counterpartyAssignmentIds: [b1],
      });

      // Accept comfortably before expiry (= earliest span start − 3h).
      const pNow = await tsShift(db, expiresAt, '-', '1 hour');
      const { rows } = await db.query(ACCEPT, [swapId, runB.userId, pNow]);
      expect(rows[0].r).toMatchObject({ accepted: true });

      // Ownership exchanged atomically: A's seat → B, B's seat → A.
      expect((await getAssignment(db, a1)).user_id).toBe(runB.userId);
      expect((await getAssignment(db, b1)).user_id).toBe(runA.userId);
      expect(await swapStatus(db, swapId)).toBe('accepted');
    });
  });

  it('float swap: accept reassigns the float (float_assignments.user_id) + notifies the destination SM (§8.2)', async () => {
    await inTx(async (db) => {
      const DEST = 'kings-court';
      const f = await setupAutomatedFloat(db, { dest: DEST, date: DATE });

      // Acknowledge so the destination seats are floated_in — the active-float state a float swap
      // rides on (a pending float would be ineligible; see the pending-float case below).
      const tAck = await tsShift(db, f.S, '-', '12 hours');
      await db.query(ACK, [f.floatId, f.floater, tAck]);
      expectAll(await getAssignments(db, f.destinationAssignmentIds), 'floated_in');

      // Counterparty: a DIFFERENT Quad worker (home quad ⇒ may legitimately receive a float duty)
      // with their own scheduled desk run.
      const runQ2 = await workerWithRun(db, 'quad', DATE, [f.floater]);
      const k = f.destinationAssignmentIds.length;
      const deskSeats = runQ2.assignmentIds.slice(0, k);

      const { swapId, expiresAt } = await createSwap(db, {
        swapType: 'float_swap',
        initiator: f.floater,
        counterparty: runQ2.userId,
        initiatorAssignmentIds: f.destinationAssignmentIds, // the floated_in seats
        counterpartyAssignmentIds: deskSeats,
      });

      const pNow = await tsShift(db, expiresAt, '-', '1 hour');
      const { rows } = await db.query(ACCEPT, [swapId, runQ2.userId, pNow]);
      expect(rows[0].r).toMatchObject({ accepted: true });

      // The float-in seats now show the corrected floater (Q2) and remain floats.
      for (const s of await getAssignments(db, f.destinationAssignmentIds)) {
        expect(s.user_id).toBe(runQ2.userId);
        expect(s.is_float).toBe(true);
      }
      // The float assignment itself is reattributed to the new floater.
      const fa = await db.query(`SELECT user_id FROM float_assignments WHERE float_id = $1`, [
        f.floatId,
      ]);
      expect(fa.rows[0].user_id).toBe(runQ2.userId);
      // The desk seats now belong to the former floater.
      for (const s of await getAssignments(db, deskSeats)) expect(s.user_id).toBe(f.floater);

      // §8.2: the destination house's SM is notified of the corrected floater identity.
      const notif = await db.query(
        `SELECT count(*)::int AS n FROM notifications
          WHERE recipient_user_id = $1 AND type = 'swap_request'::notification_type
            AND payload ->> 'corrected_floater_user_id' = $2`,
        [SM.userId, runQ2.userId],
      );
      expect(notif.rows[0].n).toBeGreaterThanOrEqual(1);
    });
  });

  it('permanent swap: apply_permanent_swap transfers only the initiator-owned regular-year seats (§8.3)', async () => {
    await inTx(async (db) => {
      const runA = await workerWithRun(db, 'gutmann', DATE); // initiator (owns the recurring slot)
      const runB = await workerWithRun(db, 'mayer', DATE); // new owner (counterparty)
      const runC = await workerWithRun(db, 'lauder', DATE); // third party — owns the skipped seat
      const newOwner = runB.userId;

      const aSeats = runA.assignmentIds.slice(0, 3);
      const foreignSeat = runC.assignmentIds[0]; // a seat A no longer owns → ownership predicate skips it
      const affected = [...aSeats, foreignSeat];

      const { swapId, expiresAt } = await createSwap(db, {
        swapType: 'permanent_swap',
        initiator: runA.userId,
        counterparty: newOwner,
        initiatorAssignmentIds: aSeats,
        counterpartyAssignmentIds: null, // unresolved at creation (§8.3)
      });

      const pNow = await tsShift(db, expiresAt, '-', '1 hour');
      const { rows } = await db.query(APPLY_PERMANENT, [swapId, newOwner, affected, pNow]);
      expect(rows[0].r).toMatchObject({ accepted: true, transferred_count: 3 });

      // A's three seats transfer to the new owner; the foreign seat (still C's) is skipped.
      for (const s of await getAssignments(db, aSeats)) expect(s.user_id).toBe(newOwner);
      expect((await getAssignment(db, foreignSeat)).user_id).toBe(runC.userId);
      expect(await swapStatus(db, swapId)).toBe('accepted');
    });
  });

  describe('expiry', () => {
    it('expire_pending_swaps flips an overdue pending swap and is idempotent', async () => {
      await inTx(async (db) => {
        const runA = await workerWithRun(db, 'lauder', DATE);
        const runB = await workerWithRun(db, 'mayer', DATE);
        const { swapId, expiresAt } = await createSwap(db, {
          swapType: 'shift_swap',
          initiator: runA.userId,
          counterparty: runB.userId,
          initiatorAssignmentIds: [runA.assignmentIds[0]],
          counterpartyAssignmentIds: [runB.assignmentIds[0]],
        });
        expect(await swapStatus(db, swapId)).toBe('pending');

        const afterExpiry = await tsShift(db, expiresAt, '+', '1 minute');
        const first = await db.query(`SELECT expire_pending_swaps($1::timestamptz) AS n`, [
          afterExpiry,
        ]);
        expect(Number(first.rows[0].n)).toBeGreaterThanOrEqual(1); // at least our swap flipped
        expect(await swapStatus(db, swapId)).toBe('expired');

        // Idempotent: re-running at the same instant leaves the already-expired swap unchanged.
        await db.query(`SELECT expire_pending_swaps($1::timestamptz) AS n`, [afterExpiry]);
        expect(await swapStatus(db, swapId)).toBe('expired');
      });
    });

    it('a swap past its expires_at cannot be accepted (auto-expired → not_pending)', async () => {
      await inTx(async (db) => {
        const runA = await workerWithRun(db, 'lauder', DATE);
        const runB = await workerWithRun(db, 'mayer', DATE);
        const a1 = runA.assignmentIds[0];
        const b1 = runB.assignmentIds[0];
        const { swapId, expiresAt } = await createSwap(db, {
          swapType: 'shift_swap',
          initiator: runA.userId,
          counterparty: runB.userId,
          initiatorAssignmentIds: [a1],
          counterpartyAssignmentIds: [b1],
        });

        const afterExpiry = await tsShift(db, expiresAt, '+', '1 minute');
        const { rows } = await db.query(ACCEPT, [swapId, runB.userId, afterExpiry]);
        expect(rows[0].r).toMatchObject({ accepted: false, reason: 'not_pending' });
        expect(await swapStatus(db, swapId)).toBe('expired');
        // No seat changed hands.
        expect((await getAssignment(db, a1)).user_id).toBe(runA.userId);
        expect((await getAssignment(db, b1)).user_id).toBe(runB.userId);
      });
    });
  });

  describe('acceptance ineligibility (shared vocabulary)', () => {
    it('harnwell_training_required: a swap placing a non-Harnwell worker at the Harnwell desk is refused', async () => {
      await inTx(async (db) => {
        const harn = await workerWithRun(db, 'harnwell', DATE);
        const outsider = await workerWithRun(db, 'lauder', DATE);
        const h1 = harn.assignmentIds[0]; // a Harnwell seat
        const n1 = outsider.assignmentIds[0];

        const { swapId, expiresAt } = await createSwap(db, {
          swapType: 'shift_swap',
          initiator: harn.userId,
          counterparty: outsider.userId,
          initiatorAssignmentIds: [h1],
          counterpartyAssignmentIds: [n1],
        });

        const reason = await db.query(INELIGIBILITY, [swapId]);
        expect(reason.rows[0].reason).toBe('harnwell_training_required');

        const pNow = await tsShift(db, expiresAt, '-', '1 hour');
        const { rows } = await db.query(ACCEPT, [swapId, outsider.userId, pNow]);
        expect(rows[0].r).toMatchObject({ accepted: false, reason: 'harnwell_training_required' });
        // No partial write: both seats keep their owners.
        expect((await getAssignment(db, h1)).user_id).toBe(harn.userId);
        expect((await getAssignment(db, n1)).user_id).toBe(outsider.userId);
      });
    });

    it('single_staff_cannot_float: a float swap handing the float to a single-staff worker is refused', async () => {
      await inTx(async (db) => {
        const DEST = 'kings-court';
        const f = await setupAutomatedFloat(db, { dest: DEST, date: DATE });
        const tAck = await tsShift(db, f.S, '-', '12 hours');
        await db.query(ACK, [f.floatId, f.floater, tAck]); // floated_in

        // Counterparty is a single-staff-home worker — ineligible to receive a float duty.
        const single = await workerWithRun(db, 'lauder', DATE);
        const k = f.destinationAssignmentIds.length;

        const { swapId, expiresAt } = await createSwap(db, {
          swapType: 'float_swap',
          initiator: f.floater,
          counterparty: single.userId,
          initiatorAssignmentIds: f.destinationAssignmentIds,
          counterpartyAssignmentIds: single.assignmentIds.slice(0, k),
        });

        const reason = await db.query(INELIGIBILITY, [swapId]);
        expect(reason.rows[0].reason).toBe('single_staff_cannot_float');

        const pNow = await tsShift(db, expiresAt, '-', '1 hour');
        const { rows } = await db.query(ACCEPT, [swapId, single.userId, pNow]);
        expect(rows[0].r).toMatchObject({ accepted: false, reason: 'single_staff_cannot_float' });
        // The float is untouched — still owned by the original floater and acknowledged.
        const fa = await db.query(
          `SELECT user_id, status::text AS s FROM float_assignments WHERE float_id = $1`,
          [f.floatId],
        );
        expect(fa.rows[0].user_id).toBe(f.floater);
        expect(fa.rows[0].s).toBe('acknowledged');
      });
    });

    it('block_in_pending_float: a swap touching a seat in a pending (unacknowledged) float is ineligible', async () => {
      await inTx(async (db) => {
        const DEST = 'kings-court';
        // No ack → the destination seats sit pending_float_in under a pending float.
        const f = await setupAutomatedFloat(db, { dest: DEST, date: DATE });
        expectAll(await getAssignments(db, f.destinationAssignmentIds), 'pending_float_in');

        const other = await workerWithRun(db, 'lauder', DATE);
        const k = f.destinationAssignmentIds.length;
        const { swapId } = await createSwap(db, {
          swapType: 'shift_swap',
          initiator: f.floater,
          counterparty: other.userId,
          initiatorAssignmentIds: f.destinationAssignmentIds,
          counterpartyAssignmentIds: other.assignmentIds.slice(0, k),
        });

        const reason = await db.query(INELIGIBILITY, [swapId]);
        expect(reason.rows[0].reason).toBe('block_in_pending_float');
      });
    });
  });
});
