// Scenario 4 (PLAN §4) — Permanent drop. BSpec §8.4.
//
// `permanent_drop_slot(user, house, dow, block_start_locals, drop_initiated_at, operator?)` vacates
// the worker's recurring slot (every matching DOW+local-time in the regular school year, after the
// drop instant, through the semester end) to vacant/permanent_drop. The passive SM alert was retired
// (2026-07-13). When an operator (not the worker) initiates it, the worker is alerted.

import { describe, expect, it } from 'vitest';

import { inTx } from './client';
import { anchors, expectAll, getAssignments, notificationsFor, workerWithRun } from './helpers';
import { BUILDER, PERIOD_ID } from './roster';

const PERM_DROP = `SELECT permanent_drop_slot($1::uuid, $2::text, $3::int, $4::text[],
  $5::timestamptz, $6::uuid) AS r`;

describe('04 drop (permanent)', () => {
  it('vacates the recurring slot to permanent_drop', async () => {
    await inTx(async (db) => {
      const run = await workerWithRun(db, 'gregory', '2026-03-04');
      const t = await anchors(db, run.firstStartAt);

      const { rows } = await db.query(PERM_DROP, [
        run.userId,
        'gregory',
        run.dow,
        run.hhmms,
        t.dayBefore,
        null,
      ]);
      const result = rows[0].r as { affected_count: number; semester_end_date: string };
      expect(result.affected_count).toBe(run.assignmentIds.length);

      // semester_end_date is the regular-school-year period's end.
      const period = await db.query(
        `SELECT end_date::text AS end_date FROM scheduling_periods WHERE period_id = $1`,
        [PERIOD_ID],
      );
      expect(result.semester_end_date).toBe(period.rows[0].end_date);

      const after = await getAssignments(db, run.assignmentIds);
      expectAll(after, 'vacant', 'permanent_drop');
      for (const a of after) expect(a.user_id).toBeNull();
    });
  });

  it('operator-initiated drop also alerts the removed worker', async () => {
    await inTx(async (db) => {
      const run = await workerWithRun(db, 'gregory', '2026-03-05');
      const t = await anchors(db, run.firstStartAt);

      await db.query(PERM_DROP, [
        run.userId,
        'gregory',
        run.dow,
        run.hhmms,
        t.dayBefore,
        BUILDER.userId, // operator ≠ dropper
      ]);

      const removal = await notificationsFor(db, run.userId, 'sw_permanent_removal_alert');
      expect(removal).toHaveLength(1);
      expect(removal[0].payload.operator_user_id).toBe(BUILDER.userId);
      expect(removal[0].payload.house_id).toBe('gregory');
    });
  });
});
