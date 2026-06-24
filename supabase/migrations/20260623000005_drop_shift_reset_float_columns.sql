-- Fix: dropping a float/cross-house row leaves a constraint-violating vacant seat.
--
-- F-05-004 widened `drop_shift`'s ownable-status filter to include floated_in /
-- floated_out / pending_float_* so a floating worker (or a worker who swapped IN a
-- float, §8.2 float_swap) can drop their float row. But the vacate UPDATE only reset
-- `is_cross_house_pickup` and `source_house_id` — it never reset `is_float`. Vacating
-- an `is_float = true` row therefore produced (is_float = true, source_house_id = NULL),
-- which violates the `source_house_required_when_non_home` CHECK
--   (is_float = false AND is_cross_house_pickup = false) OR source_house_id IS NOT NULL
-- so the whole RPC raised and the `drop-shift` Edge Function returned 400. In the mobile
-- app the drop is best-effort/optimistic, so the card vanished then reappeared on the next
-- snapshot — symptom: "I can't drop the shift I swapped for / am floating."
--
-- Align the vacate with every other "return a float seat to vacant" site
-- (batch_f4_no_ack, batch_f2_ack_decline, batch_a3_publish_per_house): also reset
-- `is_float = false` and `parent_float_id = NULL` so the dropped block becomes a plain
-- vacant seat the orchestrator can re-cover. Logic otherwise unchanged.

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

  -- Vacate: reset the FULL non-home column set (is_float included) so an
  -- is_float / cross-house row does not violate source_house_required_when_non_home.
  UPDATE shift_block_assignments
  SET status = 'vacant',
      vacancy_origin = 'temporary_drop',
      user_id = NULL,
      is_float = false,
      is_cross_house_pickup = false,
      source_house_id = NULL,
      parent_float_id = NULL,
      dropped_by_user_id = p_user_id,
      dropped_at = now()
  WHERE assignment_id = ANY (p_assignment_ids);

  RETURN QUERY SELECT p_assignment_ids, v_short_notice, v_direct_hmod;
END;
$$;

REVOKE ALL ON FUNCTION drop_shift(uuid[], uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION drop_shift(uuid[], uuid, timestamptz) TO service_role;
