-- Migration: coverage-conditional pickup lock (BEHAVIORAL_SPECIFICATION §5.3/§5.4/§5.5).
--
-- The T-2h pickup lock was purely clock-based: a vacant seat became unpickable
-- the moment block_start_at fell within 2h, even when a co-worker was still on
-- the desk. On a multi-staff desk (double-staffed Harnwell, triple Quad) that
-- wrongly locked a dropped seat that a real worker still covered.
--
-- Re-anchored to COVERAGE, consistent with the coverage floor (escalation fires
-- only when a desk would otherwise be EMPTY). The settled rule: a vacant seat is
-- claimable iff
--   status = 'vacant'
--   AND block_start_at > as_of
--   AND coverage_locked_at IS NULL                      -- one-way lock not yet set
--   AND ( block_start_at > as_of + 2h                   -- still outside the cutoff
--         OR a sibling on the block is REAL-present )    -- desk still staffed
--
-- TWO present-sets, deliberately NOT collapsed:
--   * escalation (orchestrator) counts 'allied' as present — stop escalating a
--     desk Allied covers.
--   * the pickup lock here does NOT count 'allied' — a secured-Allied window
--     stays locked, never re-opened to pickup. The "real worker" exemption is
--     {scheduled, claimed, floated_in, pending_float_in}.
--
-- The lock is ONE-WAY per block (§5.5): once an empty desk hits its T-2h step
-- (float_lookup / hmod_notify_allied), its seats stay locked even after a
-- floater/Allied fills the desk. Recorded via shift_blocks.coverage_locked_at,
-- set by the orchestrator at that step (NOT at broadcast — T-3h stays claimable).

-- ---------------------------------------------------------------------------
-- 1. The one-way coverage-lock marker.
-- ---------------------------------------------------------------------------
ALTER TABLE shift_blocks
  ADD COLUMN IF NOT EXISTS coverage_locked_at timestamptz;

COMMENT ON COLUMN shift_blocks.coverage_locked_at IS
  'When this block''s desk reached its T-2h coverage-securing step (float_lookup / '
  'hmod_notify_allied) while EMPTY. Set once by the orchestrator (lock_block_coverage); '
  'one-way. While non-null the block''s vacant seats are unpickable even if later filled '
  '(BEHAVIORAL_SPECIFICATION §5.5).';

-- ---------------------------------------------------------------------------
-- 2. Real-worker presence helper. A vacant seat being claimed is status='vacant',
--    so it never counts itself; any OTHER seat in a real-present status means the
--    desk is still staffed. 'allied' is intentionally excluded (see header).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION block_has_present_worker(p_block_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM shift_block_assignments
    WHERE block_id = p_block_id
      AND status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Idempotent, one-way lock. Sets the marker only when currently NULL, so a
--    later float/Allied fill can never re-open the seat (and re-firing the step
--    keeps the original lock time).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lock_block_coverage(
  p_block_id uuid,
  p_as_of timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE shift_blocks
  SET coverage_locked_at = p_as_of
  WHERE block_id = p_block_id
    AND coverage_locked_at IS NULL;
$$;

-- ---------------------------------------------------------------------------
-- 4. Coverage-conditional claimability (replaces the clock-only predicate).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_assignment_claimable(
  p_assignment_id uuid,
  p_as_of timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM shift_block_assignments sba
    JOIN shift_blocks sb USING (block_id)
    WHERE sba.assignment_id = p_assignment_id
      AND sba.status = 'vacant'
      AND sb.block_start_at > p_as_of
      AND sb.coverage_locked_at IS NULL
      AND (
        sb.block_start_at > p_as_of + interval '2 hours'
        OR block_has_present_worker(sb.block_id)
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. claim_open_shift: replace the clock-only T-2h gate with the coverage-
--    conditional one. Everything else (Harnwell training, time conflict, hours
--    cap, atomic vacant→claimed UPDATE) is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_open_shift(
  p_assignment_id uuid,
  p_user_id uuid,
  p_as_of timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target record;
  v_claimer record;
  v_week_start_date date;
  v_week_start_at timestamptz;
  v_week_end_at timestamptz;
  v_current_blocks integer;
  v_cap record;
  v_claimed_assignment_id uuid;
BEGIN
  SELECT
    sba.assignment_id,
    sba.status,
    sb.block_id,
    sb.house_id,
    sb.block_start_at,
    sb.coverage_locked_at
  INTO v_target
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sba.assignment_id = p_assignment_id;

  IF NOT FOUND OR v_target.status <> 'vacant' THEN
    RAISE EXCEPTION 'shift_unavailable';
  END IF;

  SELECT user_id, home_house_id, is_active
  INTO v_claimer
  FROM users
  WHERE user_id = p_user_id;

  IF NOT FOUND OR v_claimer.is_active = false THEN
    RAISE EXCEPTION 'user_inactive';
  END IF;

  IF v_target.block_start_at <= p_as_of THEN
    RAISE EXCEPTION 'past_t2h_cutoff';
  END IF;

  -- §5.4/§5.5 coverage-conditional lock: a one-way locked block is never
  -- claimable; an unlocked block within T-2h is claimable only while a real
  -- worker is still on the desk (block_has_present_worker, allied excluded).
  IF v_target.coverage_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'past_t2h_cutoff';
  END IF;

  IF v_target.block_start_at <= p_as_of + interval '2 hours'
     AND NOT block_has_present_worker(v_target.block_id) THEN
    RAISE EXCEPTION 'past_t2h_cutoff';
  END IF;

  IF v_target.house_id = 'harnwell' AND v_claimer.home_house_id <> 'harnwell' THEN
    RAISE EXCEPTION 'cross_house_ineligible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM shift_block_assignments existing
    JOIN shift_blocks existing_block USING (block_id)
    WHERE existing.user_id = p_user_id
      AND existing.status <> 'vacant'
      AND existing.status <> 'allied'
      AND existing_block.block_start_at = v_target.block_start_at
  ) THEN
    RAISE EXCEPTION 'time_conflict';
  END IF;

  -- §9.2: calendar week (Monday 00:00 → Sunday 23:59) in America/New_York.
  v_week_start_date := date_trunc(
    'week',
    v_target.block_start_at AT TIME ZONE 'America/New_York'
  )::date;
  v_week_start_at := v_week_start_date::timestamp AT TIME ZONE 'America/New_York';
  v_week_end_at := (v_week_start_date + 7)::timestamp AT TIME ZONE 'America/New_York';

  SELECT COUNT(*)::integer
  INTO v_current_blocks
  FROM shift_block_assignments existing
  JOIN shift_blocks existing_block USING (block_id)
  WHERE existing.user_id = p_user_id
    AND existing.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
    AND existing_block.block_start_at >= v_week_start_at
    AND existing_block.block_start_at < v_week_end_at;

  SELECT *
  INTO v_cap
  FROM effective_weekly_cap(v_week_start_date, v_target.block_start_at);

  IF v_cap.cap_enforcement = 'hard'
     AND ((v_current_blocks + 1)::numeric * 0.5) > v_cap.hours_cap THEN
    RAISE EXCEPTION 'hard_cap_exceeded';
  END IF;

  UPDATE shift_block_assignments
  SET status = 'claimed',
      user_id = p_user_id,
      vacancy_origin = 'none',
      is_cross_house_pickup = (v_claimer.home_house_id <> v_target.house_id),
      source_house_id = CASE
        WHEN v_claimer.home_house_id <> v_target.house_id THEN v_claimer.home_house_id
        ELSE NULL
      END
  WHERE assignment_id = p_assignment_id
    AND status = 'vacant'
  RETURNING assignment_id INTO v_claimed_assignment_id;

  IF v_claimed_assignment_id IS NULL THEN
    RAISE EXCEPTION 'shift_unavailable';
  END IF;

  RETURN v_claimed_assignment_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. worker_open_shifts: expose the server-authoritative claimability inputs so
--    the mobile client consumes them instead of re-deriving T-2h.
--      coverage_locked — the block's one-way lock is set (unpickable).
--      desk_covered    — a sibling real worker is on the block (claimable within
--                        T-2h until block_start_at).
--    (CREATE OR REPLACE appends the two new columns at the end of the SELECT.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW worker_open_shifts AS
WITH open_blocks AS (
  SELECT
    sba.assignment_id,
    sb.block_id,
    sb.house_id,
    sb.block_start_at,
    sb.coverage_locked_at,
    sba.vacancy_origin,
    CASE
      WHEN sba.vacancy_origin = 'permanent_drop' THEN 'permanent_opening'
      ELSE 'weekly'
    END AS feed
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sba.status = 'vacant'
    AND sb.block_start_at > now()
    -- Weekly rows: exclude blocks whose NY-local date is in a break period not
    -- in its open_feed phase. Permanent openings are not break-phase filtered.
    AND (
      sba.vacancy_origin = 'permanent_drop'
      OR NOT EXISTS (
        SELECT 1
        FROM operating_calendar oc
        JOIN break_periods bp
          ON oc.date BETWEEN bp.start_date AND bp.end_date
        WHERE oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
          AND break_claim_phase(bp.break_id, now()) <> 'open_feed'
      )
    )
),
candidate_users AS (
  SELECT u.user_id, u.home_house_id
  FROM users u
  WHERE u.is_active = true
    AND EXISTS (
      SELECT 1
      FROM user_roles ur
      WHERE ur.user_id = u.user_id
        AND ur.role IN ('sw', 'sm', 'hm')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM user_roles ur
      WHERE ur.user_id = u.user_id
        AND ur.role = 'bm'
    )
)
SELECT
  cu.user_id                                  AS eligible_user_id,
  ob.assignment_id::text                      AS id,
  ob.house_id                                 AS house_id,
  h.name                                      AS house_name,
  ob.block_start_at                           AS start_at,
  ob.block_start_at + interval '30 minutes'   AS end_at,
  ob.feed                                     AS feed,
  (ob.house_id = cu.home_house_id)            AS home_house,
  CASE
    WHEN ob.feed = 'permanent_opening' THEN (
      SELECT count(*)::integer
      FROM shift_block_assignments sba2
      JOIN shift_blocks sb2 USING (block_id)
      WHERE sba2.status = 'vacant'
        AND sba2.vacancy_origin = 'permanent_drop'
        AND sb2.house_id = ob.house_id
        AND sb2.block_start_at >= now()
        AND EXTRACT(
              ISODOW FROM (sb2.block_start_at AT TIME ZONE 'America/New_York')
            )
            = EXTRACT(
              ISODOW FROM (ob.block_start_at AT TIME ZONE 'America/New_York')
            )
        AND (sb2.block_start_at AT TIME ZONE 'America/New_York')::time
            = (ob.block_start_at AT TIME ZONE 'America/New_York')::time
    )
    ELSE NULL
  END                                         AS weeks_remaining,
  (ob.coverage_locked_at IS NOT NULL)         AS coverage_locked,
  block_has_present_worker(ob.block_id)       AS desk_covered
FROM open_blocks ob
JOIN houses h ON h.id = ob.house_id
CROSS JOIN candidate_users cu
-- Cross-house eligibility matrix (canonical, crossHousePickup.ts): non-Harnwell
-- houses accept any candidate; Harnwell accepts only home-Harnwell workers. The
-- home-house case is subsumed.
WHERE ob.house_id <> 'harnwell' OR cu.home_house_id = 'harnwell';

GRANT SELECT ON worker_open_shifts TO anon, authenticated, service_role;

-- rollback:
-- (recreate worker_open_shifts + is_assignment_claimable + claim_open_shift from
--  20260605000001 / 20260527000006, then)
-- DROP FUNCTION IF EXISTS lock_block_coverage(uuid, timestamptz);
-- DROP FUNCTION IF EXISTS block_has_present_worker(uuid);
-- ALTER TABLE shift_blocks DROP COLUMN IF EXISTS coverage_locked_at;
