-- Batch G (G2): is_hm_working_time depends on the timezone database via
-- AT TIME ZONE, so it is STABLE, not IMMUTABLE (F-07-012). Marking it IMMUTABLE
-- could let the planner cache results incorrectly across a tz-data change or
-- in an index/generated-column context.
--
-- (The pg_cron GUCs app.supabase_url / app.service_role_key required by the
-- orchestrator-tick schedule are an ops/deploy concern documented in
-- ARCHITECTURE; they are set on the database, not in a migration.)

CREATE OR REPLACE FUNCTION is_hm_working_time(p_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    extract(isodow from p_at AT TIME ZONE 'America/New_York') BETWEEN 1 AND 5
    AND (
      extract(hour from p_at AT TIME ZONE 'America/New_York') >= 8
      AND extract(hour from p_at AT TIME ZONE 'America/New_York') < 17
    );
$$;

REVOKE ALL ON FUNCTION is_hm_working_time(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_hm_working_time(timestamptz) TO service_role;
