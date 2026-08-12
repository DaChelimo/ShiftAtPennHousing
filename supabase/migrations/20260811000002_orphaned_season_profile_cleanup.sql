-- Migration: Orphaned compiled-season profile cleanup (admin self-service).
--
-- apply_compiled_season's calendar-collision guard (20260702000006) blocks applying
-- a season whenever any date in its range is already mapped to a DIFFERENT profile.
-- operating_calendar has no FK to operating_seasons by design (compiled runtime
-- config is decoupled from authoring, ARCH §operating-seasons), so deleting an
-- operating_seasons row does NOT clean up what it compiled. If that ever happens
-- (e.g. a season row removed by hand), the leftover `s_<slug>_<date>` rows in
-- operating_calendar / staffing_patterns / operating_profiles / float_routing /
-- break_periods silently outlive the season and can collide with a later season's
-- date range — exactly what happened with an orphaned `s_summer2026_20260701`
-- profile blocking Fall 2026 (2026-08-11).
--
-- These two RPCs let an admin find and remove such orphans from /admin/operations
-- instead of requiring a manual SQL cleanup every time. A profile is "orphaned"
-- when its name matches the compiled-season convention (`s_<slug>_...`) but no
-- CURRENT operating_seasons row owns it (mirrors the LIKE check in
-- apply_compiled_season's own collision guard).
--
-- Deletion is deliberately conservative: it only ever removes the pure compiled
-- CONFIG tables (operating_calendar, staffing_patterns, float_routing,
-- break_periods, operating_profiles), which have no downstream FK dependents. It
-- REFUSES (raises, deletes nothing) if the orphaned profile still has a
-- scheduling_periods row, since that table has real dependents (draft
-- assignments, preferences, period targets, per-house publish rows) that must be
-- resolved by hand rather than silently cascaded away.

CREATE OR REPLACE FUNCTION list_orphaned_season_profiles(p_calling_user_id uuid)
RETURNS TABLE (
  profile_name text,
  min_date date,
  max_date date,
  calendar_rows bigint,
  profile_rows bigint,
  pattern_rows bigint,
  period_rows bigint,
  float_routing_rows bigint,
  break_periods_rows bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT user_is_admin(p_calling_user_id) THEN
    RAISE EXCEPTION 'list_orphaned_season_profiles: caller is not an administrator'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH names AS (
    SELECT oc.profile_name FROM operating_calendar oc WHERE oc.profile_name ~ '^s_'
    UNION
    SELECT op.profile_name FROM operating_profiles op WHERE op.profile_name ~ '^s_'
    UNION
    SELECT sp.profile_name FROM staffing_patterns sp WHERE sp.profile_name ~ '^s_'
    UNION
    SELECT spd.profile_name FROM scheduling_periods spd WHERE spd.profile_name ~ '^s_'
    UNION
    SELECT fr.profile_name FROM float_routing fr WHERE fr.profile_name ~ '^s_'
    UNION
    SELECT bp.profile_name FROM break_periods bp WHERE bp.profile_name ~ '^s_'
  ),
  orphans AS (
    SELECT n.profile_name
    FROM names n
    WHERE NOT EXISTS (
      SELECT 1 FROM operating_seasons os
      WHERE n.profile_name LIKE ('s_' || os.slug || '_%')
    )
  )
  SELECT
    o.profile_name,
    (SELECT min(oc.date) FROM operating_calendar oc WHERE oc.profile_name = o.profile_name),
    (SELECT max(oc.date) FROM operating_calendar oc WHERE oc.profile_name = o.profile_name),
    (SELECT count(*) FROM operating_calendar oc WHERE oc.profile_name = o.profile_name),
    (SELECT count(*) FROM operating_profiles op WHERE op.profile_name = o.profile_name),
    (SELECT count(*) FROM staffing_patterns sp WHERE sp.profile_name = o.profile_name),
    (SELECT count(*) FROM scheduling_periods spd WHERE spd.profile_name = o.profile_name),
    (SELECT count(*) FROM float_routing fr WHERE fr.profile_name = o.profile_name),
    (SELECT count(*) FROM break_periods bp WHERE bp.profile_name = o.profile_name)
  FROM orphans o
  ORDER BY o.profile_name;
END;
$$;

CREATE OR REPLACE FUNCTION delete_orphaned_season_profile(
  p_calling_user_id uuid,
  p_profile_name text
)
RETURNS TABLE (
  calendar_rows_deleted bigint,
  pattern_rows_deleted bigint,
  float_routing_rows_deleted bigint,
  break_periods_rows_deleted bigint,
  profile_rows_deleted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_rows bigint;
  v_cal bigint;
  v_pat bigint;
  v_fr bigint;
  v_bp bigint;
  v_prof bigint;
BEGIN
  IF NOT user_is_admin(p_calling_user_id) THEN
    RAISE EXCEPTION 'delete_orphaned_season_profile: caller is not an administrator'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_profile_name !~ '^s_' THEN
    RAISE EXCEPTION 'delete_orphaned_season_profile: % is not a compiled-season profile name', p_profile_name
      USING ERRCODE = 'check_violation';
  END IF;

  -- Re-verify orphan status at delete time, in case a season claiming this profile
  -- was created between the list call and this one.
  IF EXISTS (
    SELECT 1 FROM operating_seasons os
    WHERE p_profile_name LIKE ('s_' || os.slug || '_%')
  ) THEN
    RAISE EXCEPTION 'delete_orphaned_season_profile: % is owned by an active operating season', p_profile_name
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_period_rows FROM scheduling_periods WHERE profile_name = p_profile_name;
  IF v_period_rows > 0 THEN
    RAISE EXCEPTION 'delete_orphaned_season_profile: % still has % scheduling_periods row(s) with attached schedule data (preferences, drafts, publish state); resolve those manually before deleting',
      p_profile_name, v_period_rows
      USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM operating_calendar WHERE profile_name = p_profile_name;
  GET DIAGNOSTICS v_cal = ROW_COUNT;
  DELETE FROM staffing_patterns WHERE profile_name = p_profile_name;
  GET DIAGNOSTICS v_pat = ROW_COUNT;
  DELETE FROM float_routing WHERE profile_name = p_profile_name;
  GET DIAGNOSTICS v_fr = ROW_COUNT;
  DELETE FROM break_periods WHERE profile_name = p_profile_name;
  GET DIAGNOSTICS v_bp = ROW_COUNT;
  DELETE FROM operating_profiles WHERE profile_name = p_profile_name;
  GET DIAGNOSTICS v_prof = ROW_COUNT;

  RETURN QUERY SELECT v_cal, v_pat, v_fr, v_bp, v_prof;
END;
$$;

REVOKE ALL ON FUNCTION list_orphaned_season_profiles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_orphaned_season_profiles(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION delete_orphaned_season_profile(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_orphaned_season_profile(uuid, text) TO authenticated, service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS list_orphaned_season_profiles(uuid);
-- DROP FUNCTION IF EXISTS delete_orphaned_season_profile(uuid, text);
