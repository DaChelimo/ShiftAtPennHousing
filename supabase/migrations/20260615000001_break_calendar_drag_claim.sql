-- Migration: Break redesign B1 — calendar drag claiming.
--
-- The worker break picker becomes a draggable calendar (Behavioral Spec §4.4 "The
-- calendar picker"): the worker drags a TIME range and the system fills one open seat
-- per 30-minute block ("system-assigned lane" — lanes are interchangeable). FCFS conflicts
-- and the weekly hard cap TRIM the claim to the part actually still open; the function
-- returns exactly what it claimed so the client can reconcile its optimistic drag.
--
-- Two additive pieces:
--   1. house_schedule_grid gains block_id + required_headcount so the picker can address
--      blocks and render "filled / required" coverage. Reusing the §11.4 grid (migration
--      20260612000001) as the break read model means NO new read surface: it already
--      returns vacant + occupied seats per block with the claimant's name, RLS-scoped to
--      the caller's home house. The block generator pre-creates required_headcount seat
--      rows per block, so the grid's rows at a time ARE the capacity.
--   2. claim_break_blocks(uuid[], uuid, timestamptz) — the per-block FCFS range claim.
--
-- Invariants honored: Harnwell training (#1 — skips Harnwell blocks for non-Harnwell
-- callers), hours cap (#4 — incremental weekly hard-cap re-check, trims the tail), block
-- atomicity (#5 — per-30-min-block), timezone (#6 — NY date/ week math via timestamptz).
-- Over-claiming is impossible: enforce_block_occupied_headcount (20260614000004) is the
-- backstop, and we only ever claim a seat already 'vacant'.
-- Idempotent: CREATE OR REPLACE for both the view and the function.

-- ---------------------------------------------------------------------------
-- 1. house_schedule_grid + block_id + required_headcount (appended columns).
--    CREATE OR REPLACE keeps the existing column order; new columns go last.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW house_schedule_grid
WITH (security_invoker = true) AS
SELECT
  sb.house_id,
  h.name                                              AS house_name,
  h.desk_phone                                        AS desk_phone,
  sba.assignment_id::text                             AS id,
  sb.block_start_at                                   AS start_at,
  sb.block_start_at + interval '30 minutes'           AS end_at,
  sba.status::text                                    AS status,
  COALESCE(sba.is_float, false)                       AS is_float,
  COALESCE(sba.is_cross_house_pickup, false)          AS is_cross_house_pickup,
  sba.user_id                                         AS user_id,
  d.name                                              AS worker_name,
  d.phone                                             AS worker_phone,
  sb.block_id                                         AS block_id,
  sb.required_headcount                               AS required_headcount
FROM shift_block_assignments sba
JOIN shift_blocks sb USING (block_id)
JOIN houses h ON h.id = sb.house_id
LEFT JOIN worker_directory d ON d.user_id = sba.user_id
WHERE sba.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in', 'vacant');

REVOKE ALL ON house_schedule_grid FROM PUBLIC, anon, authenticated;
GRANT SELECT ON house_schedule_grid TO authenticated, service_role;

COMMENT ON VIEW house_schedule_grid IS
  'BSpec §11.4 house schedule grid + break calendar read model: per-30-min-block '
  'staffing of a house with worker name/phone (via worker_directory) + the desk phone, '
  'plus block_id + required_headcount so the §4.4 break picker can address blocks and '
  'show filled/required coverage. security_invoker — the shift_block_assignments RLS '
  '(own/home-house/admin) scopes which houses a caller can see. Present seats + vacant gaps.';

-- ---------------------------------------------------------------------------
-- 2. claim_break_blocks — per-block FCFS range claim (the drag).
--    For each distinct block (chronological, so the cap trims the TAIL), inside a break
--    claim_window: claim ONE still-vacant seat applying the claim_break_shift guards.
--    Blocks with no open seat / a caller time-conflict / past the cap are SKIPPED.
--    Returns exactly the (block_id, assignment_id) pairs claimed = the server-side trim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_break_blocks(
  p_block_ids uuid[],
  p_user_id uuid,
  p_as_of timestamptz
)
RETURNS TABLE(claimed_block_id uuid, claimed_assignment_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimer        record;
  v_block          record;
  v_break_id       uuid;
  v_week_start_date date;
  v_week_start_at  timestamptz;
  v_week_end_at    timestamptz;
  v_current_blocks integer;
  v_cap            record;
  v_seat           uuid;
BEGIN
  SELECT user_id, home_house_id, is_active
    INTO v_claimer
  FROM users
  WHERE user_id = p_user_id;

  IF NOT FOUND OR v_claimer.is_active = false THEN
    RAISE EXCEPTION 'user_inactive';
  END IF;

  FOR v_block IN
    SELECT sb.block_id AS bid, sb.house_id, sb.block_start_at
    FROM shift_blocks sb
    WHERE sb.block_id = ANY (p_block_ids)
    ORDER BY sb.block_start_at, sb.block_id
  LOOP
    -- Resolve the break covering this block's NY date; skip non-break blocks.
    SELECT bp.break_id
      INTO v_break_id
    FROM operating_calendar oc
    JOIN break_periods bp
      ON oc.date BETWEEN bp.start_date AND bp.end_date
     AND oc.profile_name = bp.profile_name
    WHERE oc.date = (v_block.block_start_at AT TIME ZONE 'America/New_York')::date;

    CONTINUE WHEN v_break_id IS NULL;

    -- Round 1 only: claiming is gated to the claim window (pre_open + open_feed skip).
    CONTINUE WHEN break_claim_phase(v_break_id, p_as_of) <> 'claim_window';

    -- Harnwell training (#1): a non-Harnwell worker can never staff Harnwell.
    CONTINUE WHEN v_block.house_id = 'harnwell' AND v_claimer.home_house_id <> 'harnwell';

    -- Time-conflict: the caller already covers a seat at this block start.
    CONTINUE WHEN EXISTS (
      SELECT 1
      FROM shift_block_assignments existing
      JOIN shift_blocks eb USING (block_id)
      WHERE existing.user_id = p_user_id
        AND existing.status NOT IN ('vacant', 'allied')
        AND eb.block_start_at = v_block.block_start_at
    );

    -- Weekly hard-cap re-check (#4). Incremental: COUNT sees rows already claimed in
    -- this loop, so the drag trims the tail once the worker hits 40h that week.
    v_week_start_date := date_trunc(
      'week', v_block.block_start_at AT TIME ZONE 'America/New_York'
    )::date;
    v_week_start_at := v_week_start_date::timestamp AT TIME ZONE 'America/New_York';
    v_week_end_at := (v_week_start_date + 7)::timestamp AT TIME ZONE 'America/New_York';

    SELECT count(*)::integer
      INTO v_current_blocks
    FROM shift_block_assignments existing
    JOIN shift_blocks eb USING (block_id)
    WHERE existing.user_id = p_user_id
      AND existing.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
      AND eb.block_start_at >= v_week_start_at
      AND eb.block_start_at < v_week_end_at;

    SELECT *
      INTO v_cap
    FROM effective_weekly_cap(v_week_start_date, v_block.block_start_at);

    IF v_cap.cap_enforcement = 'hard'
       AND ((v_current_blocks + 1)::numeric * 0.5) > v_cap.hours_cap THEN
      CONTINUE;  -- cap reached for this week — trim the rest of the drag
    END IF;

    -- Pick one still-vacant seat on this block (lane-agnostic). SKIP LOCKED makes
    -- concurrent callers split the seats rather than collide (true FCFS).
    SELECT a.assignment_id
      INTO v_seat
    FROM shift_block_assignments a
    WHERE a.block_id = v_block.bid
      AND a.status = 'vacant'
    ORDER BY a.assignment_id
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    CONTINUE WHEN v_seat IS NULL;  -- block already full (FCFS lost) — trimmed away

    UPDATE shift_block_assignments
    SET status = 'claimed',
        user_id = p_user_id,
        vacancy_origin = 'none',
        is_cross_house_pickup = (v_claimer.home_house_id <> v_block.house_id),
        source_house_id = CASE
          WHEN v_claimer.home_house_id <> v_block.house_id THEN v_claimer.home_house_id
          ELSE NULL
        END
    WHERE assignment_id = v_seat
      AND status = 'vacant';

    IF FOUND THEN
      claimed_block_id := v_block.bid;
      claimed_assignment_id := v_seat;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION claim_break_blocks(uuid[], uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_break_blocks(uuid[], uuid, timestamptz) TO service_role;

COMMENT ON FUNCTION claim_break_blocks(uuid[], uuid, timestamptz) IS
  'BSpec §4.4 break calendar drag claim. Per distinct block (chronological), inside the '
  'break claim_window, claims one still-vacant seat applying the claim_break_shift guards '
  '(active user, Harnwell training, per-block time-conflict, incremental weekly hard cap). '
  'Skips full / conflicting / over-cap blocks; returns exactly the claimed pairs (the '
  'server-side trim the UI reconciles its optimistic drag against). Atomic.';

-- rollback:
-- DROP FUNCTION IF EXISTS claim_break_blocks(uuid[], uuid, timestamptz);
-- (house_schedule_grid: re-CREATE OR REPLACE without block_id/required_headcount)
