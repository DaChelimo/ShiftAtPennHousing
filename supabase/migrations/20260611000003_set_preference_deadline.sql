-- Migration: set_preference_deadline RPC (BSpec §4.2 / design §6.11)
--
-- Closes the write gap on the Preferences-oversight surface: the column
-- scheduling_periods.preference_deadline exists and the cron reads it
-- (send_preference_reminders fires 5/3/1 days before it), but there was NO
-- authenticated write path — only a service-role RLS policy. The web
-- Preferences page (apps/web/.../admin/preferences) therefore shipped the
-- "Set deadline" control DISABLED + flagged.
--
-- BSpec §4.2: "The SM sets a deadline for preference submission." §13: an HM
-- "can do everything an SM can do for their home house" and a BM holds "the same
-- administrative powers as HMs". So the authorized set is SM / HM / BM —
-- exactly user_can_build_schedule. scheduling_periods are GLOBAL (not
-- house-scoped: one regular_school_year period spans all 13 houses), so the
-- guard accepts ANY sm/hm/bm role row (any scope_house_id) — it does not gate
-- on a particular house.
--
-- Mirrors the cap-modification pattern: a SECURITY DEFINER RPC that validates
-- the caller's role + the input, then performs the UPDATE; a thin authenticated
-- Edge Function (supabase/functions/set-preference-deadline) wraps it for the
-- API/mobile path, and the web wires it through a server action. Setting the
-- deadline is a plain UPDATE of the existing column, so the reminder cron keeps
-- working unchanged (it recomputes its 5/3/1-day windows off the new value).
--
-- Idempotent: CREATE OR REPLACE; re-runnable.

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
  -- Authz: SM/HM/BM (any house — periods are global). §4.2 / §13.
  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = p_actor_user_id
      AND role IN ('sm', 'hm', 'bm')
  ) THEN
    RAISE EXCEPTION 'Only a Student Manager, Housing Manager, or Building Manager may set the preference deadline.'
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
-- DROP FUNCTION IF EXISTS set_preference_deadline(uuid, uuid, timestamptz);
