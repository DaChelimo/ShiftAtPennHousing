-- Migration: admin break-period authoring (BSpec §4.4; break "creating" pipeline).
--
-- Until now a break period could only be declared by hand-running a seed
-- (supabase/seeds/demo_break.sql): `break_periods` is empty in a fresh env and
-- there is no UI or RPC to create one. This adds the PROJECT-ADMIN authoring path
-- the web /admin/breaks screen calls. It follows the seed's canonical, NON-
-- DESTRUCTIVE recipe exactly:
--   1. retarget every operating_calendar date in [start,end] to the break's
--      operating profile (e.g. 'short_break'), and
--   2. upsert the matching break_periods row.
-- A date's existing (vacant) shift_blocks then become claimable break seats
-- because every break-membership read joins operating_calendar.profile_name =
-- break_periods.profile_name over [start_date,end_date]. NOTHING is deleted or
-- regenerated; occupied seats stay as read-only occupied.
--
-- Break PROFILE definitions (which houses close, hours, headcount, floating) are
-- NOT authored here — the admin picks from EXISTING operating_profiles and the
-- web screen previews their consequences. Editing profile definitions is a
-- separate, deferred admin power (v1: "view + dates only"). SMs have NO break
-- authoring power — every entry point is gated on user_is_admin.
--
-- The un-declare fallback profile is 'regular_school_year' (the load-bearing base
-- profile), matching demo_break.sql's reversal.

-- ── author_break_period: create (p_break_id NULL) or edit (existing id) ──────
CREATE OR REPLACE FUNCTION author_break_period(
  p_actor_user_id uuid,
  p_break_name    text,
  p_break_type    break_type_enum,
  p_start_date    date,
  p_end_date      date,
  p_profile_name  text,
  p_break_id      uuid DEFAULT NULL
)
RETURNS TABLE (new_break_id uuid, dates_declared integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_break_id    uuid;
  v_actor       uuid;
  v_old_start   date;
  v_old_end     date;
  v_old_profile text;
  v_declared    integer := 0;
BEGIN
  -- Authz: project administrator only (§2.7). The actor is the REAL caller
  -- (auth.uid()) for an authenticated request, so a non-admin cannot forge
  -- privilege by passing an admin's id; p_actor_user_id is trusted ONLY for
  -- service-role / test callers where there is no request JWT (auth.uid() null).
  -- Avoids the confused-deputy pattern that trusts a caller-supplied actor uuid.
  v_actor := COALESCE(auth.uid(), p_actor_user_id);
  IF NOT user_is_admin(v_actor) THEN
    RAISE EXCEPTION 'not authorized to author break periods'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_break_name IS NULL OR btrim(p_break_name) = '' THEN
    RAISE EXCEPTION 'break name is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'end date must be on or after start date'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM operating_profiles WHERE profile_name = p_profile_name) THEN
    RAISE EXCEPTION 'unknown operating profile %', p_profile_name
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  v_break_id := COALESCE(p_break_id, gen_random_uuid());

  -- On edit: restore dates this break previously declared that fall OUTSIDE the
  -- new window (and still point at its old profile) back to the school-year base,
  -- so shrinking or moving a break un-declares the dropped dates.
  IF p_break_id IS NOT NULL THEN
    SELECT start_date, end_date, profile_name
      INTO v_old_start, v_old_end, v_old_profile
      FROM break_periods
     WHERE break_periods.break_id = p_break_id;

    IF v_old_start IS NOT NULL THEN
      UPDATE operating_calendar
         SET profile_name = 'regular_school_year'
       WHERE date BETWEEN v_old_start AND v_old_end
         AND date NOT BETWEEN p_start_date AND p_end_date
         AND profile_name = v_old_profile;
    END IF;
  END IF;

  INSERT INTO break_periods (break_id, break_name, break_type, start_date, end_date, profile_name)
  VALUES (v_break_id, p_break_name, p_break_type, p_start_date, p_end_date, p_profile_name)
  ON CONFLICT (break_id) DO UPDATE
    SET break_name   = EXCLUDED.break_name,
        break_type   = EXCLUDED.break_type,
        start_date   = EXCLUDED.start_date,
        end_date     = EXCLUDED.end_date,
        profile_name = EXCLUDED.profile_name;

  -- Retarget the (new) date range to the break's profile.
  INSERT INTO operating_calendar (date, profile_name)
  SELECT d::date, p_profile_name
    FROM generate_series(p_start_date, p_end_date, interval '1 day') AS d
  ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;
  GET DIAGNOSTICS v_declared = ROW_COUNT;

  RETURN QUERY SELECT v_break_id, v_declared;
END;
$$;

-- ── remove_break_period: un-declare the range + delete the break row ─────────
CREATE OR REPLACE FUNCTION remove_break_period(
  p_actor_user_id uuid,
  p_break_id      uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start   date;
  v_end     date;
  v_profile text;
  v_restored integer := 0;
BEGIN
  -- Same actor derivation as author_break_period: real caller, not a forgeable param.
  IF NOT user_is_admin(COALESCE(auth.uid(), p_actor_user_id)) THEN
    RAISE EXCEPTION 'not authorized to remove break periods'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT start_date, end_date, profile_name
    INTO v_start, v_end, v_profile
    FROM break_periods
   WHERE break_id = p_break_id;

  IF v_start IS NULL THEN
    RETURN -1; -- no such break
  END IF;

  UPDATE operating_calendar
     SET profile_name = 'regular_school_year'
   WHERE date BETWEEN v_start AND v_end
     AND profile_name = v_profile;
  GET DIAGNOSTICS v_restored = ROW_COUNT;

  DELETE FROM break_periods WHERE break_id = p_break_id;

  RETURN v_restored;
END;
$$;

REVOKE ALL ON FUNCTION author_break_period(uuid, text, break_type_enum, date, date, text, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION author_break_period(uuid, text, break_type_enum, date, date, text, uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION remove_break_period(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remove_break_period(uuid, uuid) TO authenticated, service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS author_break_period(uuid, text, break_type_enum, date, date, text, uuid);
-- DROP FUNCTION IF EXISTS remove_break_period(uuid, uuid);
