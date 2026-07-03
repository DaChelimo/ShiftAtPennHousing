-- Migration: Summer preference-based scheduling — admin-authored preference deadline.
--
-- Summer is an sm_built season (docs/operating-seasons/PLAN.md §18, decision #4), so
-- like the regular school year it is built from worker preferences: before summer
-- starts, workers key in the shifts they want and the SM builds from them. The
-- preference machinery is already period-generic (submit_preferences / the deadline
-- gate / the builder key off period_id, not the profile), and apply_compiled_season
-- already creates a scheduling_periods row for the season. Two gaps close here:
--
--   1. The deadline becomes ADMIN-AUTHORED ON THE SEASON. A new
--      operating_seasons.preference_deadline column is the authoring truth (one value
--      per season = one value for all 13 houses, since scheduling_periods is global).
--      The web season editor writes it; on apply, the web stamps the period's
--      preference_deadline from it via set_preference_deadline (apply's period upsert
--      deliberately leaves preference_deadline untouched on conflict, so a stamped
--      value survives re-apply).
--
--   2. The top-level `admin` role JOINS the SM/HM/BM setters of
--      set_preference_deadline, so the admin can drive the deadline centrally from the
--      season editor. SM/HM/BM keep their existing power (the /admin/preferences
--      oversight surface is unchanged).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE; re-runnable.

-- ============================================================
-- 1. Authoring column on the season header.
-- ============================================================
ALTER TABLE operating_seasons
  ADD COLUMN IF NOT EXISTS preference_deadline timestamptz;

COMMENT ON COLUMN operating_seasons.preference_deadline IS
  'Admin-authored preference-submission deadline for the season (end-of-day NY on the '
  'chosen date). NULL = no deadline authored. On apply the web stamps the season''s '
  'scheduling_periods.preference_deadline from this value via set_preference_deadline. '
  'Must fall on/before the season start (enforced by set_preference_deadline).';

-- ============================================================
-- 2. Add `admin` to the set_preference_deadline authorization set.
-- Unchanged from 20260611000003 except the role gate (admin OR sm/hm/bm) and its
-- error message. scheduling_periods stay GLOBAL, so any admin/sm/hm/bm may set the
-- one deadline that covers all houses.
-- ============================================================
CREATE OR REPLACE FUNCTION set_preference_deadline(
  p_actor_user_id      uuid,
  p_period_id          uuid,
  p_preference_deadline timestamptz
)
RETURNS TABLE (period_id uuid, preference_deadline timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date date;
  v_published  timestamptz;
BEGIN
  -- Authz: admin (any house — periods are global) OR SM/HM/BM. §4.2 / §13 / §18.
  IF NOT (
    user_is_admin(p_actor_user_id)
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = p_actor_user_id
        AND role IN ('sm', 'hm', 'bm')
    )
  ) THEN
    RAISE EXCEPTION 'Only an administrator, Student Manager, Housing Manager, or Building Manager may set the preference deadline.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_preference_deadline IS NULL THEN
    RAISE EXCEPTION 'A preference deadline is required.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT sp.start_date, sp.published_at
    INTO v_start_date, v_published
  FROM scheduling_periods sp
  WHERE sp.period_id = p_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No scheduling period % exists.', p_period_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Preferences are only collected before the schedule is published (§4.2:
  -- "The SM begins building the schedule only after the deadline has passed").
  IF v_published IS NOT NULL THEN
    RAISE EXCEPTION 'This scheduling period is already published; its preference deadline is locked.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Sanity bound: the deadline must fall on/before the period's first operating
  -- date (NY-anchored). The reminder cadence fires in the days leading up to the
  -- deadline, so a deadline after the period has started is incoherent. We do NOT
  -- over-constrain a lower bound (a deadline in the past is allowed — it simply
  -- closes submission immediately, e.g. an SM correcting/extending a window).
  IF p_preference_deadline > ((v_start_date::timestamp) AT TIME ZONE 'America/New_York') THEN
    RAISE EXCEPTION 'The preference deadline must fall on or before the period start date (%).', v_start_date
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  UPDATE scheduling_periods sp
     SET preference_deadline = p_preference_deadline
   WHERE sp.period_id = p_period_id
  RETURNING sp.period_id, sp.preference_deadline;
END;
$$;

REVOKE ALL ON FUNCTION set_preference_deadline(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_preference_deadline(uuid, uuid, timestamptz) TO authenticated, service_role;

-- rollback:
-- ALTER TABLE operating_seasons DROP COLUMN IF EXISTS preference_deadline;
-- (restore the 20260611000003 body of set_preference_deadline to drop admin from the gate)
