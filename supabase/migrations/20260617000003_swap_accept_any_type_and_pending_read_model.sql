-- Migration: accept ANY swap type from a {swap_id}-only client + a pending-swap read model.
--
-- Two additive functions, no schema changes, no behavior change to existing RPCs:
--
-- 1. resolve_permanent_swap_affected(p_swap_id, p_now) -> uuid[]
--    Expands a permanent_swap's recurring_pattern to the initiator-owned FUTURE
--    regular-school-year assignment_ids, so a mobile client can accept a permanent
--    swap by sending only { swap_id } (the accept-swap Edge Function calls this, then
--    feeds the result to the existing apply_permanent_swap, which re-filters to
--    still-owned regular_school_year seats). The slot query mirrors permanent_drop_slot
--    (20260614000005) verbatim — same house + day-of-week + block_start_locals match,
--    same current-or-upcoming term bound (DST-safe NY-local comparison, invariant #6).
--
-- 2. worker_pending_swaps() -> TABLE
--    A SECURITY DEFINER read model for the AUTHENTICATED worker's pending swaps (both
--    directions). Returns the swap, its direction, the other party's name, and BOTH
--    sides' span (start / end / block count) + assignment-id arrays — everything the
--    mobile needs to (a) flag a My-Shifts card that has a pending swap and (b) render an
--    accept/decline popup that shows the hours being swapped. RLS is enforced in-function
--    (auth.uid() must be initiator or counterparty); blocks are 30-min (invariant #5), so
--    a span's end is max(block_start_at) + 30 minutes.

-- ---------------------------------------------------------------------------
-- 1. Permanent-swap affected-assignment resolver
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_permanent_swap_affected(
  p_swap_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_swap          swap_requests%ROWTYPE;
  v_house         text;
  v_dow           integer;
  v_locals        text[];
  v_semester_end  date;
  v_ids           uuid[];
BEGIN
  SELECT * INTO v_swap FROM swap_requests WHERE swap_id = p_swap_id;
  IF NOT FOUND
     OR v_swap.swap_type::text <> 'permanent_swap'
     OR v_swap.recurring_pattern IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  v_house := v_swap.recurring_pattern ->> 'house_id';
  v_dow   := (v_swap.recurring_pattern ->> 'day_of_week')::integer;
  SELECT array_agg(elem)
    INTO v_locals
  FROM jsonb_array_elements_text(v_swap.recurring_pattern -> 'block_start_locals') AS elem;

  -- Current-or-upcoming regular school year (same anchor as permanent_drop_slot): the
  -- earliest term not yet ended. No qualifying term -> nothing to transfer (never
  -- unbounded).
  SELECT end_date
    INTO v_semester_end
  FROM scheduling_periods
  WHERE profile_name = 'regular_school_year'
    AND end_date >= (p_now AT TIME ZONE 'America/New_York')::date
  ORDER BY start_date
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  SELECT array_agg(sba.assignment_id)
    INTO v_ids
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  JOIN operating_calendar oc
    ON oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
  WHERE sba.user_id = v_swap.initiator_user_id
    AND sb.house_id = v_house
    AND EXTRACT(DOW FROM sb.block_start_at AT TIME ZONE 'America/New_York') = v_dow
    AND TO_CHAR(sb.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI') = ANY (v_locals)
    AND sb.block_start_at > p_now
    AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date <= v_semester_end
    AND oc.profile_name = 'regular_school_year'
    AND sba.status IN ('scheduled', 'claimed', 'floated_in');

  RETURN COALESCE(v_ids, ARRAY[]::uuid[]);
END;
$$;

REVOKE ALL ON FUNCTION resolve_permanent_swap_affected(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_permanent_swap_affected(uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Pending-swap read model for the authenticated worker
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION worker_pending_swaps()
RETURNS TABLE (
  swap_id                     uuid,
  swap_type                   text,
  direction                   text,   -- 'incoming' (I'm counterparty) | 'outgoing' (I'm initiator)
  status                      text,
  created_at                  timestamptz,
  expires_at                  timestamptz,
  other_user_id               uuid,
  other_user_name             text,
  initiator_assignment_ids    uuid[],
  counterparty_assignment_ids uuid[],
  initiator_start             timestamptz,
  initiator_end               timestamptz,
  initiator_blocks            integer,
  counterparty_start          timestamptz,
  counterparty_end            timestamptz,
  counterparty_blocks         integer,
  recurring_pattern           jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sr.swap_id,
    sr.swap_type::text,
    CASE WHEN sr.initiator_user_id = auth.uid() THEN 'outgoing' ELSE 'incoming' END,
    sr.status::text,
    sr.created_at,
    sr.expires_at,
    CASE WHEN sr.initiator_user_id = auth.uid() THEN sr.counterparty_user_id ELSE sr.initiator_user_id END,
    CASE WHEN sr.initiator_user_id = auth.uid() THEN cp.name ELSE ini.name END,
    sr.initiator_assignment_ids,
    sr.counterparty_assignment_ids,
    ispan.span_start, ispan.span_end, COALESCE(ispan.block_count, 0),
    cspan.span_start, cspan.span_end, COALESCE(cspan.block_count, 0),
    sr.recurring_pattern
  FROM swap_requests sr
  JOIN users ini ON ini.user_id = sr.initiator_user_id
  LEFT JOIN users cp ON cp.user_id = sr.counterparty_user_id
  LEFT JOIN LATERAL (
    SELECT
      min(sb.block_start_at)                            AS span_start,
      max(sb.block_start_at) + interval '30 minutes'    AS span_end,
      count(*)::integer                                 AS block_count
    FROM shift_block_assignments a
    JOIN shift_blocks sb ON sb.block_id = a.block_id
    WHERE a.assignment_id = ANY (sr.initiator_assignment_ids)
  ) ispan ON true
  LEFT JOIN LATERAL (
    SELECT
      min(sb.block_start_at)                            AS span_start,
      max(sb.block_start_at) + interval '30 minutes'    AS span_end,
      count(*)::integer                                 AS block_count
    FROM shift_block_assignments a
    JOIN shift_blocks sb ON sb.block_id = a.block_id
    WHERE a.assignment_id = ANY (COALESCE(sr.counterparty_assignment_ids, ARRAY[]::uuid[]))
  ) cspan ON true
  WHERE sr.status = 'pending'
    AND (sr.initiator_user_id = auth.uid() OR sr.counterparty_user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION worker_pending_swaps() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_pending_swaps() TO authenticated;

-- rollback: DROP FUNCTION worker_pending_swaps();
--           DROP FUNCTION resolve_permanent_swap_affected(uuid, timestamptz);
