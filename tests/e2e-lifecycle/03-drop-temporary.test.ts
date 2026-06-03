// Scenario 3 (PLAN §4) — Temporary drop. BSpec §8, §5.
//
// `drop_shift(assignment_ids, user_id, as_of)` vacates a contiguous owned run to
// vacant/temporary_drop and reports two flags: `short_notice_warning` (run starts ≤20m out) and
// `direct_hmod_notification` (the drop leaves a block below required headcount AND starts ≤2h out).
// House-06 is single-staff (headcount 1), so dropping its sole worker close to start trips both.

import { describe, expect, it } from 'vitest';

import { inTx } from './client';
import { anchors, expectAll, expectRpcErrorTx, getAssignments, workerWithRun } from './helpers';
import { WORKERS } from './roster';

const DROP = `SELECT * FROM drop_shift($1::uuid[], $2::uuid, $3::timestamptz)`;

describe('03 drop (temporary)', () => {
  it('advance-notice drop vacates the run with no warnings', async () => {
    await inTx(async (db) => {
      const run = await workerWithRun(db, 'house-06', '2026-03-03');
      const t = await anchors(db, run.firstStartAt);

      const { rows } = await db.query(DROP, [run.assignmentIds, run.userId, t.dayBefore]);
      expect(rows[0].short_notice_warning).toBe(false);
      expect(rows[0].direct_hmod_notification).toBe(false);
      expect(rows[0].dropped_assignment_ids).toHaveLength(run.assignmentIds.length);

      const after = await getAssignments(db, run.assignmentIds);
      expectAll(after, 'vacant', 'temporary_drop');
      for (const a of after) expect(a.user_id).toBeNull();
    });
  });

  it('short-notice drop of the sole worker flags short-notice + direct HMOD', async () => {
    await inTx(async (db) => {
      const run = await workerWithRun(db, 'house-06', '2026-03-02');
      const t = await anchors(db, run.firstStartAt);

      const { rows } = await db.query(DROP, [run.assignmentIds, run.userId, t.tMinus10m]);
      expect(rows[0].short_notice_warning).toBe(true);
      expect(rows[0].direct_hmod_notification).toBe(true); // single-staff block → below headcount

      const after = await getAssignments(db, run.assignmentIds);
      expectAll(after, 'vacant', 'temporary_drop');
    });
  });

  it('dropping a run you do not own raises', async () => {
    await inTx(async (db) => {
      const run = await workerWithRun(db, 'house-06', '2026-03-04');
      const nonOwner = WORKERS.find((w) => w.homeHouse === 'quad')!.userId; // owns no house-06 blocks
      const t = await anchors(db, run.firstStartAt);

      await expectRpcErrorTx(
        db,
        DROP,
        [run.assignmentIds, nonOwner, t.dayBefore],
        /drop_not_owned/,
      );

      // Untouched — still scheduled to the original owner.
      const after = await getAssignments(db, run.assignmentIds);
      expectAll(after, 'scheduled');
    });
  });
});
