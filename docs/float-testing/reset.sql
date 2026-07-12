-- ============================================================================
-- Float / escalation BETWEEN-SCENARIO reset (LOCAL Supabase only)
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f docs/float-testing/reset.sql
--
-- Fast cleanup between scenarios: clears all floats, exclusions, float-related
-- notifications, orchestrator step-state and coverage locks, and resets the dev
-- sim-clock to real time. It also restores the source crews (Quad/Harnwell) to
-- plain `scheduled` (undoing any pending/voided float-out left on their seats).
--
-- For a lighter, single-desk reset that keeps the sim clock and other houses
-- untouched, use rearm-desk.sh instead.
--
-- It does NOT recreate the source crews from scratch (run setup.sql for that) and
-- does NOT restore DuBois gaps you created — to restore a DuBois shift you dropped,
-- re-assign those assignment_ids to the worker, e.g.
--   UPDATE shift_block_assignments SET status='scheduled', vacancy_origin='none',
--     user_id=(SELECT user_id FROM users WHERE email='gina-dubois@upenn.edu')
--   WHERE assignment_id IN ('<id1>','<id2>', ...);
-- ...or simply run your next scenario on a fresh date.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

UPDATE dev_sim_clock SET offset_seconds = 0 WHERE id;

UPDATE shift_block_assignments SET parent_float_id = NULL WHERE parent_float_id IS NOT NULL;
DELETE FROM float_assignments;
DELETE FROM float_exclusions;
DELETE FROM notifications
WHERE type IN ('hmod_urgent', 'ack_reminder', 'broadcast')
   OR (type = 'personal_shift' AND payload->>'kind' = 'float_assigned');
DELETE FROM block_step_status;

-- Coverage-lock markers (added by the coverage-conditional pickup lock,
-- migration 20260627000001) MUST be cleared too, otherwise the one-way lock
-- keeps the desk locked and escalation never re-fires.
UPDATE shift_blocks SET coverage_locked_at = NULL WHERE coverage_locked_at IS NOT NULL;

-- Source seats knocked off 'scheduled' by a float-out → restored (keep owner).
UPDATE shift_block_assignments
SET status = 'scheduled', vacancy_origin = 'none', is_float = false,
    is_cross_house_pickup = false, source_house_id = NULL
WHERE status IN ('pending_float_out', 'floated_out');

-- Destination float-in seats → back to the vacant gap they came from.
UPDATE shift_block_assignments
SET status = 'vacant', vacancy_origin = 'temporary_drop', user_id = NULL,
    is_float = false, is_cross_house_pickup = false, source_house_id = NULL
WHERE status IN ('pending_float_in', 'floated_in');

-- Restore DuBois gaps (drops + reopened float-ins) to the recurring slot owner,
-- derived from the same NY weekday+time in another week of the published pattern.
-- DuBois is single-staff, so there is no duplicate-seat risk.
UPDATE shift_block_assignments a
SET status = 'scheduled', vacancy_origin = 'none',
    user_id = (
      SELECT a2.user_id FROM shift_block_assignments a2
      JOIN shift_blocks b2 ON b2.block_id = a2.block_id
      WHERE b2.house_id = 'dubois' AND a2.status = 'scheduled' AND a2.user_id IS NOT NULL
        AND extract(isodow FROM (b2.block_start_at AT TIME ZONE 'America/New_York'))
            = extract(isodow FROM (b.block_start_at AT TIME ZONE 'America/New_York'))
        AND (b2.block_start_at AT TIME ZONE 'America/New_York')::time
            = (b.block_start_at AT TIME ZONE 'America/New_York')::time
      LIMIT 1
    )
FROM shift_blocks b
WHERE b.block_id = a.block_id AND b.house_id = 'dubois'
  AND a.status = 'vacant' AND a.vacancy_origin = 'temporary_drop'
  -- Only restore when a recurring owner resolves; DuBois may be claim-based
  -- (no scheduled crew) in which case a dropped block stays vacant.
  AND EXISTS (
    SELECT 1 FROM shift_block_assignments a2
    JOIN shift_blocks b2 ON b2.block_id = a2.block_id
    WHERE b2.house_id = 'dubois' AND a2.status = 'scheduled' AND a2.user_id IS NOT NULL
      AND extract(isodow FROM (b2.block_start_at AT TIME ZONE 'America/New_York'))
          = extract(isodow FROM (b.block_start_at AT TIME ZONE 'America/New_York'))
      AND (b2.block_start_at AT TIME ZONE 'America/New_York')::time
          = (b.block_start_at AT TIME ZONE 'America/New_York')::time
  );

COMMIT;
