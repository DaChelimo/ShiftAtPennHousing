-- Migration: populate worker_my_shifts.dropped_still_open (parity T2-1).
--
-- Problem: a temporary drop discards the dropper. drop_shift sets the affected
-- shift_block_assignments rows to status='vacant', vacancy_origin='temporary_drop',
-- user_id=NULL. Because the per-worker SELECT RLS and worker_my_shifts both key on
-- user_id, the now-NULL vacant row is invisible to the worker who dropped it, so
-- worker_my_shifts could not derive dropped_still_open and hard-coded it false
-- (see 20260605000001).
--
-- Fix: persist the dropper identity on the vacant row, expose those rows to the
-- dropper via RLS + the view, and compute dropped_still_open from them. A re-fill
-- (claim / float-in / override) flips status off 'vacant' (and vacancy_origin off
-- 'temporary_drop'), so the row automatically stops being "dropped still open" with
-- no clear-on-refill logic. A later re-drop overwrites dropped_by_user_id/dropped_at.
--
-- Honors invariants: block atomicity (#5 — per-block rows untouched in shape) and
-- timezone (#6 — dropped_at is timestamptz now()).
-- Idempotent: ADD COLUMN IF NOT EXISTS; DROP POLICY IF EXISTS; CREATE OR REPLACE.

-- ---------------------------------------------------------------------------
-- 1. Schema: who dropped the block, and when (nullable; only set on a temporary
--    worker-drop). FK to users so a fired/removed worker NULLs the link.
-- ---------------------------------------------------------------------------
ALTER TABLE shift_block_assignments
  ADD COLUMN IF NOT EXISTS dropped_by_user_id uuid REFERENCES users (user_id),
  ADD COLUMN IF NOT EXISTS dropped_at timestamptz;

-- Speeds the new RLS clause / view predicate (dropper's own vacant rows).
CREATE INDEX IF NOT EXISTS shift_block_assignments_dropped_by_idx
  ON shift_block_assignments (dropped_by_user_id)
  WHERE dropped_by_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. drop_shift: record the dropper on the temporary-drop UPDATE only. The
--    function already authenticates ownership against p_user_id, so that is the
--    dropping worker. Signature/return/grants unchanged from 20260528000020.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION drop_shift(
  p_assignment_ids uuid[],
  p_user_id uuid,
  p_as_of timestamptz DEFAULT now()
)
RETURNS TABLE (
  dropped_assignment_ids uuid[],
  short_notice_warning boolean,
  direct_hmod_notification boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_min_start timestamptz;
  v_max_start timestamptz;
  v_expected_count integer;
  v_short_notice boolean;
  v_direct_hmod boolean;
  v_now_boundary timestamptz;
  v_below_headcount boolean;
BEGIN
  IF p_assignment_ids IS NULL OR array_length(p_assignment_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'empty_drop';
  END IF;

  SELECT
    COUNT(*)::integer,
    MIN(sb.block_start_at),
    MAX(sb.block_start_at)
  INTO v_count, v_min_start, v_max_start
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sba.assignment_id = ANY (p_assignment_ids)
    AND sba.user_id = p_user_id
    AND sba.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in',
                       'floated_out', 'pending_float_out');

  IF v_count <> array_length(p_assignment_ids, 1) THEN
    RAISE EXCEPTION 'drop_not_owned';
  END IF;

  -- F-05-005: cannot drop a block that starts before the current 30-minute
  -- boundary (its time has already begun/passed — no vacating history).
  v_now_boundary := to_timestamp(floor(extract(epoch FROM p_as_of) / 1800) * 1800);
  IF v_min_start < v_now_boundary THEN
    RAISE EXCEPTION 'drop_past_block';
  END IF;

  v_expected_count := (
    EXTRACT(EPOCH FROM (v_max_start - v_min_start)) / (30 * 60)
  )::integer + 1;

  IF v_expected_count <> v_count THEN
    RAISE EXCEPTION 'drop_not_contiguous';
  END IF;

  v_short_notice := v_min_start <= p_as_of + interval '20 minutes';

  -- F-05-006: would the drop leave any affected block below required headcount?
  -- Count seats where a worker is physically present, excluding the dropped rows.
  WITH affected AS (
    SELECT DISTINCT sb.block_id, sb.required_headcount
    FROM shift_block_assignments sba
    JOIN shift_blocks sb USING (block_id)
    WHERE sba.assignment_id = ANY (p_assignment_ids)
  )
  SELECT bool_or(
    (SELECT count(*)
       FROM shift_block_assignments x
      WHERE x.block_id = affected.block_id
        AND x.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
        AND NOT (x.assignment_id = ANY (p_assignment_ids))
    ) < affected.required_headcount
  )
  INTO v_below_headcount
  FROM affected;

  v_direct_hmod := COALESCE(v_below_headcount, false)
                   AND v_min_start <= p_as_of + interval '2 hours';

  UPDATE shift_block_assignments
  SET status = 'vacant',
      vacancy_origin = 'temporary_drop',
      user_id = NULL,
      is_cross_house_pickup = false,
      source_house_id = NULL,
      dropped_by_user_id = p_user_id,
      dropped_at = now()
  WHERE assignment_id = ANY (p_assignment_ids);

  RETURN QUERY SELECT p_assignment_ids, v_short_notice, v_direct_hmod;
END;
$$;

REVOKE ALL ON FUNCTION drop_shift(uuid[], uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION drop_shift(uuid[], uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. RLS: let a worker SELECT their own dropped-still-open vacant rows. This is
--    the worker's own data (they dropped it), so no privacy concern. OR'd in as
--    a separate policy alongside (not weakening) the existing three SELECT
--    policies: service-role bypass, own-assignment (user_id = auth.uid()), and
--    home-house/admin. PostgreSQL OR's permissive policies, so this widens the
--    own-data surface without touching the others.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "users can select own dropped vacant assignments" ON shift_block_assignments;
CREATE POLICY "users can select own dropped vacant assignments" ON shift_block_assignments
  FOR SELECT
  TO authenticated
  USING (dropped_by_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. View: re-create worker_my_shifts (same columns + security_invoker) so it
--    ALSO emits the dropper's own dropped-still-open vacant rows, with
--    dropped_still_open = true. The worker key for those rows is
--    dropped_by_user_id (user_id is NULL on a vacant row), so user_id is
--    COALESCE'd to dropped_by_user_id and the WHERE admits either an own active
--    assignment OR an own dropped-still-open vacant row. Scheduled/active rows
--    are unaffected (dropped_still_open=false), and the two arms are mutually
--    exclusive on status so no row duplicates.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW worker_my_shifts
WITH (security_invoker = true) AS
SELECT
  COALESCE(sba.user_id, sba.dropped_by_user_id)       AS user_id,
  sba.assignment_id::text                             AS id,
  sb.house_id                                         AS house_id,
  h.name                                              AS house_name,
  sb.block_start_at                                   AS start_at,
  sb.block_start_at + interval '30 minutes'           AS end_at,
  CASE
    WHEN sba.status IN ('floated_in', 'pending_float_in') THEN 'float_out'
    WHEN sba.status = 'claimed'                           THEN 'temp_pickup'
    WHEN sba.status = 'scheduled'                         THEN 'scheduled'
    ELSE 'scheduled'
  END                                                 AS kind,
  COALESCE(sba.is_cross_house_pickup, false)
    OR (COALESCE(sba.is_float, false) AND sba.source_house_id IS NOT NULL)
                                                      AS cross_house,
  sba.status IN ('pending_float_in', 'pending_float_out')
                                                      AS pending,
  EXISTS (
    SELECT 1
    FROM operating_calendar oc
    JOIN break_periods bp
      ON oc.date BETWEEN bp.start_date AND bp.end_date
     AND oc.profile_name = bp.profile_name
    WHERE oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
  )                                                   AS break_shift,
  (sba.status = 'vacant'
    AND sba.vacancy_origin = 'temporary_drop'
    AND sba.dropped_by_user_id IS NOT NULL)           AS dropped_still_open
FROM shift_block_assignments sba
JOIN shift_blocks sb USING (block_id)
JOIN houses h ON h.id = sb.house_id
WHERE
  -- Own active assignment (unchanged surface).
  (sba.user_id IS NOT NULL
    AND sba.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in'))
  -- OR own dropped-still-open vacant row (the dropper's personal calendar still
  -- shows the slot they vacated until someone re-fills it).
  OR (sba.status = 'vacant'
    AND sba.vacancy_origin = 'temporary_drop'
    AND sba.dropped_by_user_id IS NOT NULL);

GRANT SELECT ON worker_my_shifts TO anon, authenticated, service_role;

-- rollback:
-- (restore 20260605000001's worker_my_shifts body via CREATE OR REPLACE;)
-- DROP POLICY IF EXISTS "users can select own dropped vacant assignments" ON shift_block_assignments;
-- DROP INDEX IF EXISTS shift_block_assignments_dropped_by_idx;
-- ALTER TABLE shift_block_assignments DROP COLUMN IF EXISTS dropped_at;
-- ALTER TABLE shift_block_assignments DROP COLUMN IF EXISTS dropped_by_user_id;
