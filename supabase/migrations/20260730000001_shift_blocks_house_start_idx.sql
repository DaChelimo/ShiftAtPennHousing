-- Composite index for the house-scoped week reads that dominate this table's access
-- pattern: the live calendar, schedule builder, hours report, people roster hours, and
-- launch-gate reads all filter `shift_blocks` by (house_id, block_start_at range).
--
-- The existing `shift_blocks_block_start_at_idx` (block_start_at only, 20260527000004)
-- forces those queries to scan every house's blocks in the date range and discard the
-- rest. EXPLAIN ANALYZE on a real house-week query (perf audit, 2026-07-29) showed this
-- concretely: the date-range index scan produced 264 matching rows for Harnwell but the
-- planner had to walk 2,197 rows total before the house_id filter dropped 1,933 of them.
-- Immaterial today (sub-millisecond either way at this data volume) but it is O(houses)
-- work for O(1) useful rows, and it will matter once every house has a full season
-- seeded rather than the current handful.
--
-- Not CONCURRENTLY: this project's other shift_blocks indexes (see
-- 20260527000004_shift_blocks_calendar_generation.sql,
-- 20260702000005_operating_seasons_guardrails.sql) are created the same way, inside the
-- normal migration transaction, and the table is small enough in every environment this
-- migration runs against for the brief lock to be a non-issue.
CREATE INDEX IF NOT EXISTS shift_blocks_house_start_idx
  ON shift_blocks (house_id, block_start_at);

-- rollback:
-- DROP INDEX IF EXISTS shift_blocks_house_start_idx;
