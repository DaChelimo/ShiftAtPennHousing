// Scenario 1 (PLAN §4) — Publish a built schedule. BSpec §4.
//
// The S2 seed already builds + publishes all 13 houses, so this verifies the post-publish
// invariants on the build week and exercises the publish RPC's guard live (re-publishing an
// already-published house must raise). Drafts→scheduled is proven by the resulting state: drafts
// are consumed (deleted by publish) and scheduled seats carry the published shape.

import { describe, expect, it } from 'vitest';

import { inTx } from './client';
import { BUILD_WEEK_END, BUILD_WEEK_START, BUILDER, HEADCOUNT, HOUSES, PERIOD_ID } from './roster';

const WEEK: [string, string] = [BUILD_WEEK_START, BUILD_WEEK_END];
const NY_DATE = `(b.block_start_at AT TIME ZONE 'America/New_York')::date`;
const TOTAL_SEATS = HOUSES.reduce((sum, h) => sum + (HEADCOUNT[h] ?? 1) * 32 * 7, 0); // 3584

describe('01 publish', () => {
  it('period is published and every house has a publication row', async () => {
    await inTx(async (db) => {
      const period = await db.query(
        `SELECT published_at FROM scheduling_periods WHERE period_id = $1`,
        [PERIOD_ID],
      );
      expect(period.rows[0].published_at).not.toBeNull();

      const pubs = await db.query(
        `SELECT count(*)::int AS n FROM period_house_publications WHERE period_id = $1`,
        [PERIOD_ID],
      );
      expect(pubs.rows[0].n).toBe(HOUSES.length);
    });
  });

  it('drafts became scheduled seats with the published shape; none left over', async () => {
    await inTx(async (db) => {
      // Publish deletes drafts as it consumes them — none remain for the period.
      const drafts = await db.query(
        `SELECT count(*)::int AS n FROM draft_block_assignments WHERE period_id = $1`,
        [PERIOD_ID],
      );
      expect(drafts.rows[0].n).toBe(0);

      // Every scheduled seat in the build week is owned, non-float, non-pickup, origin 'none'.
      const badScheduled = await db.query(
        `SELECT count(*)::int AS n FROM shift_block_assignments a
           JOIN shift_blocks b ON b.block_id = a.block_id
          WHERE a.status = 'scheduled' AND ${NY_DATE} BETWEEN $1 AND $2
            AND (a.user_id IS NULL OR a.vacancy_origin <> 'none'
                 OR a.is_float OR a.is_cross_house_pickup OR a.source_house_id IS NOT NULL)`,
        WEEK,
      );
      expect(badScheduled.rows[0].n).toBe(0);

      // Every vacant seat in the build week is an unfilled original opening.
      const badVacant = await db.query(
        `SELECT count(*)::int AS n FROM shift_block_assignments a
           JOIN shift_blocks b ON b.block_id = a.block_id
          WHERE a.status = 'vacant' AND ${NY_DATE} BETWEEN $1 AND $2
            AND (a.user_id IS NOT NULL OR a.vacancy_origin <> 'never_assigned')`,
        WEEK,
      );
      expect(badVacant.rows[0].n).toBe(0);
    });
  });

  it('seats partition into scheduled + vacant = Σ headcount·blocks, with gaps remaining', async () => {
    await inTx(async (db) => {
      const counts = await db.query(
        `SELECT
           count(*) FILTER (WHERE a.status = 'scheduled')::int AS scheduled,
           count(*) FILTER (WHERE a.status = 'vacant')::int    AS vacant,
           count(*)::int AS total
         FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
         WHERE ${NY_DATE} BETWEEN $1 AND $2`,
        WEEK,
      );
      const { scheduled, vacant, total } = counts.rows[0];
      expect(scheduled).toBeGreaterThan(0);
      expect(vacant).toBeGreaterThan(0); // deliberate gaps → float/escalation material
      expect(scheduled + vacant).toBe(total);
      expect(total).toBe(TOTAL_SEATS);
    });
  });

  it('re-publishing an already-published house raises (publish guard is live)', async () => {
    await inTx(async (db) => {
      let msg: string | null = null;
      try {
        await db.query(`SELECT publish_schedule($1::uuid, $2::uuid, $3::text)`, [
          PERIOD_ID,
          BUILDER.userId,
          'quad',
        ]);
      } catch (err) {
        msg = err instanceof Error ? err.message : String(err);
      }
      expect(msg).not.toBeNull();
      expect(msg as string).toMatch(/already published/i);
    });
  });
});
