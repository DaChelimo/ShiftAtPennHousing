-- ============================================================================
-- Re-arm a single desk's escalation state (LOCAL Supabase only)
--
--   Invoke via the wrapper:  docs/float-testing/rearm-desk.sh <house> [from] [to]
--   Or directly:
--     psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
--       -v house=dubois -v p_from='2026-06-30 19:00' -v p_to='2026-07-01 00:00' \
--       -f docs/float-testing/rearm-desk.sql
--
-- Purpose: between test runs, put ONE house's blocks back to a pre-escalation
-- state so "Run orchestrator now" re-fires broadcast -> float_lookup ->
-- hmod_notify_allied for them. Unlike reset.sql this is SURGICAL: it does NOT
-- touch other houses, does NOT reset the dev sim-clock, and only reverts floats
-- that actually landed on the target blocks.
--
-- Variables (all passed by the wrapper; from/to may be empty):
--   :house   house_id, e.g. 'dubois'                                (required)
--   :p_from  NY-local lower bound 'YYYY-MM-DD HH:MM'; empty => app_now()
--   :p_to    NY-local upper bound 'YYYY-MM-DD HH:MM'; empty => +infinity
--
-- With no window it re-arms every block for the house from the sim-clock "now"
-- onward (i.e. all future/locked blocks). Bounds are interpreted in
-- America/New_York and are [from, to).
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _tgt ON COMMIT DROP AS
SELECT b.block_id
FROM shift_blocks b
WHERE b.house_id = :'house'
  AND b.block_start_at >= COALESCE((NULLIF(:'p_from',''))::timestamp AT TIME ZONE 'America/New_York', app_now())
  AND b.block_start_at <  COALESCE((NULLIF(:'p_to','' ))::timestamp AT TIME ZONE 'America/New_York', 'infinity'::timestamptz);

\echo '--- Target blocks ---'
SELECT count(*) AS target_blocks FROM _tgt;

-- 1. Revert float PLACEMENTS that landed on target blocks (usually a no-op when
--    the desk simply went to Allied). Restore the source crew's seats, drop the
--    float rows, and free the destination seats back to the vacant gap.
CREATE TEMP TABLE _floats ON COMMIT DROP AS
SELECT DISTINCT fa.float_id, fa.source_assignment_ids, fa.destination_assignment_ids
FROM float_assignments fa
WHERE EXISTS (
  SELECT 1 FROM shift_block_assignments a
  WHERE a.assignment_id = ANY (fa.destination_assignment_ids)
    AND a.block_id IN (SELECT block_id FROM _tgt)
);

UPDATE shift_block_assignments a
SET status='scheduled', vacancy_origin='none', is_float=false,
    is_cross_house_pickup=false, source_house_id=NULL, parent_float_id=NULL
WHERE a.assignment_id IN (SELECT unnest(source_assignment_ids) FROM _floats);

UPDATE shift_block_assignments a
SET status='vacant', vacancy_origin='temporary_drop', user_id=NULL, is_float=false,
    is_cross_house_pickup=false, source_house_id=NULL, parent_float_id=NULL
WHERE a.assignment_id IN (SELECT unnest(destination_assignment_ids) FROM _floats);

-- Any stray parent_float_id still pointing at a target block.
UPDATE shift_block_assignments a SET parent_float_id=NULL
WHERE a.block_id IN (SELECT block_id FROM _tgt) AND a.parent_float_id IS NOT NULL;

-- Ack reminders tied to the reverted floats (payload carries float_id).
DELETE FROM notifications n
WHERE n.type='ack_reminder'
  AND n.payload ? 'float_id'
  AND (n.payload->>'float_id')::uuid IN (SELECT float_id FROM _floats);

DELETE FROM float_assignments WHERE float_id IN (SELECT float_id FROM _floats);

-- 2. Clear the escalation MARKERS on the target blocks so the chain re-fires.
UPDATE shift_blocks SET coverage_locked_at=NULL
WHERE block_id IN (SELECT block_id FROM _tgt) AND coverage_locked_at IS NOT NULL;

DELETE FROM block_step_status WHERE block_id IN (SELECT block_id FROM _tgt);

-- Allied / broadcast alerts already raised for these blocks (payload.block_id).
DELETE FROM notifications n
WHERE n.type IN ('hmod_urgent','broadcast')
  AND n.payload ? 'block_id'
  AND (n.payload->>'block_id')::uuid IN (SELECT block_id FROM _tgt);

-- Float exclusions aimed at this house that overlap the window.
DELETE FROM float_exclusions fe
WHERE fe.destination_house_id = :'house'
  AND fe.window_start_at < COALESCE((NULLIF(:'p_to','' ))::timestamp AT TIME ZONE 'America/New_York', 'infinity'::timestamptz)
  AND fe.window_end_at   > COALESCE((NULLIF(:'p_from',''))::timestamp AT TIME ZONE 'America/New_York', app_now());

\echo '--- Post-reset (target blocks) ---'
SELECT count(*)                                            AS blocks,
       count(*) FILTER (WHERE coverage_locked_at IS NOT NULL) AS still_locked
FROM shift_blocks WHERE block_id IN (SELECT block_id FROM _tgt);

COMMIT;
