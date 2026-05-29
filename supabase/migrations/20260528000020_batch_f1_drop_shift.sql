-- Batch F (F1): drop-handler corrections (F-05-004/005/006).
--   F-05-004 — a floating worker can drop their home-floated row: include
--              floated_out / pending_float_out in the ownable-status filter.
--   F-05-005 — reject dropping a block whose start is before the current
--              30-minute boundary (cannot vacate history).
--   F-05-006 — direct HMOD notification requires the drop to leave the block
--              below required headcount, not merely the within-2h time test.
-- (F-05-007 — claim-shift EF rejects claim_type='permanent' — is in
--  supabase/functions/claim-shift/index.ts.)

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
      source_house_id = NULL
  WHERE assignment_id = ANY (p_assignment_ids);

  RETURN QUERY SELECT p_assignment_ids, v_short_notice, v_direct_hmod;
END;
$$;

REVOKE ALL ON FUNCTION drop_shift(uuid[], uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION drop_shift(uuid[], uuid, timestamptz) TO service_role;
