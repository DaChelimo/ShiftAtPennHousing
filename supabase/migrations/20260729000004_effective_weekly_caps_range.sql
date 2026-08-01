-- Batched weekly-cap lookup, so a client can resolve the cap for every week it can
-- navigate to in ONE round trip.
--
-- Why this exists: the mobile app had no cap read path at all. It computed the weekly
-- cap client-side from two compiled-in constants (soft 20h / break-hard 40h) selected by
-- a `breakProfile` boolean that was hardwired `false` on the live path, so every worker
-- saw "20h soft cap" in every season, including a summer season configured at 40h/hard
-- through /admin/operations. The fix is the same rule the coverage lock already follows:
-- the SERVER is authoritative and the client consumes, never re-derives.
--
-- Why batched rather than N calls to effective_weekly_cap: the worker-week snapshot
-- spans the navigable window (Monday(now) - 1 week through +4) and is refetched on every
-- debounced Realtime burst. Six RPCs per refetch multiplies the exact amplification that
-- WorkerShiftsRepository's debounce+conflate exists to contain (publish_schedule and
-- apply_compiled_season each touch tens of thousands of rows).
--
-- This delegates to effective_weekly_cap rather than reimplementing it, so the
-- weekly_cap_overrides / operating_calendar / operating_profiles precedence restored by
-- 20260724000001 stays defined in exactly one place.
CREATE OR REPLACE FUNCTION effective_weekly_caps(
  p_from_week_start date,
  p_to_week_start   date
)
RETURNS TABLE (
  week_start_date date,
  hours_cap       integer,
  cap_enforcement cap_enforcement_enum
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Bound the fan-out. The caller is a client, and generate_series over an unbounded
  -- range would run effective_weekly_cap (itself a 7-day calendar scan) once per week.
  -- 53 weeks covers any window the app offers with room to spare.
  IF p_to_week_start < p_from_week_start THEN
    RETURN;
  END IF;
  IF (p_to_week_start - p_from_week_start) > 371 THEN
    RAISE EXCEPTION 'effective_weekly_caps: range too wide (max 53 weeks)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  -- date_trunc('week') is Monday-based, matching the Mon..Sun week every cap path uses.
  SELECT ws::date, c.hours_cap, c.cap_enforcement
  FROM generate_series(
         date_trunc('week', p_from_week_start::timestamp),
         date_trunc('week', p_to_week_start::timestamp),
         interval '7 days'
       ) AS ws
  CROSS JOIN LATERAL effective_weekly_cap(ws::date, NULL::timestamptz) AS c;
END;
$$;

COMMENT ON FUNCTION effective_weekly_caps(date, date) IS
  'Effective weekly hours cap + enforcement for each Monday in [from, to]. Client-callable: returns global schedule config only, no user-scoped data.';

-- Grants. Per supabase/AGENTS.md a REVOKE FROM PUBLIC does NOT strip Supabase''s default
-- per-role grants, so the roles are named explicitly. This one is DELIBERATELY reachable
-- by `authenticated` (the mobile app calls it directly) and deliberately NOT reachable by
-- `anon`: the values are global schedule config, not user data, but there is no reason to
-- expose the operating calendar to an unauthenticated caller.
REVOKE ALL ON FUNCTION effective_weekly_caps(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION effective_weekly_caps(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION effective_weekly_caps(date, date) TO authenticated, service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS effective_weekly_caps(date, date);
