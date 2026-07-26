-- Migration: make the simulated-clock surface refuse to move outside a dev environment
-- (cost audit F-15).
--
-- F-15 is a Low-cost finding and the audit says so plainly. It is fixed anyway because
-- what it describes is not a cost problem, it is a blast-radius problem:
--
--   20260611000007_dev_sim_clock.sql lives in supabase/migrations/ and therefore applies
--   to EVERY environment, production included. app_now() is not a dev curiosity: it is
--   where orchestrator-tick sources the entire tick's notion of "now", and it gates
--   apply_compiled_season's future-block reconciliation. Anything that can set the offset
--   in production moves every escalation deadline in the system at once.
--
-- The offset is 0 by default and app_now() equals now() at offset 0, so nothing is
-- currently wrong. The gap is that the only guard is application-layer: setSimClock() and
-- clearSimClock() in apps/web/lib/actions/devClock.ts check isTimeTravelEnabled(), which
-- is a build-time flag. Anything holding the service-role key bypasses it entirely,
-- because the writes go through createServiceClient() straight to the table.
--
-- So the guard moves into the database, where it cannot be bypassed by a caller:
-- a BEFORE UPDATE trigger rejects any attempt to set a NON-ZERO offset unless
-- system_config('allow_time_travel') = 'true'.
--
-- DEFAULT IS DENY. That is the point -- a production database that was never explicitly
-- told it may time-travel cannot, and no one has to remember to turn anything off. This
-- is the opposite default from is_staggered_launch_enabled(), deliberately: there,
-- absent-means-off is the safe direction; here, absent-means-ALLOW would be the unsafe
-- one.
--
-- Resetting to zero is ALWAYS permitted, gate or no gate. A database must never be able
-- to get stuck in a time-travelled state it cannot leave.
--
-- Existing dev boxes keep working: the block below enables the flag automatically when
-- the clock has evidently already been used for time travel (a non-zero offset, or a
-- set_at stamp), which only a development database will have. seed.sql sets it too, so a
-- fresh local stack is enabled from the start. If a dev environment does end up denied,
-- the fix is one line:
--
--   INSERT INTO system_config (config_key, config_value, value_type)
--   VALUES ('allow_time_travel', 'true', 'enum')
--   ON CONFLICT (config_key) DO UPDATE SET config_value = 'true';

CREATE OR REPLACE FUNCTION time_travel_is_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT config_value = 'true'
       FROM system_config
      WHERE config_key = 'allow_time_travel'),
    false
  );
$$;

REVOKE ALL ON FUNCTION time_travel_is_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION time_travel_is_allowed() TO authenticated, service_role;

COMMENT ON FUNCTION time_travel_is_allowed() IS
  'Whether this environment may move the simulated clock. Absent config means NO -- a '
  'production database that was never told it may time-travel cannot. Cost audit F-15.';

CREATE OR REPLACE FUNCTION enforce_time_travel_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Returning to real time is always allowed: never let a database get stuck in a
  -- time-travelled state it has no way out of.
  IF COALESCE(NEW.offset_seconds, 0) = 0 THEN
    RETURN NEW;
  END IF;

  IF NOT time_travel_is_allowed() THEN
    RAISE EXCEPTION 'time_travel_disabled'
      USING DETAIL = 'The simulated clock cannot be moved in this environment. '
                     'app_now() drives every escalation deadline and the season '
                     'reconciliation cutoff.',
            HINT = 'Set system_config(''allow_time_travel'') = ''true'' in a development '
                   'database only.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dev_sim_clock_environment_gate ON dev_sim_clock;
CREATE TRIGGER dev_sim_clock_environment_gate
  BEFORE INSERT OR UPDATE ON dev_sim_clock
  FOR EACH ROW
  EXECUTE FUNCTION enforce_time_travel_gate();

-- Keep existing development databases working. A non-zero offset or a set_at stamp is
-- proof this database has already been used for time travel, which no production
-- database will have been.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM dev_sim_clock
    WHERE COALESCE(offset_seconds, 0) <> 0 OR set_at IS NOT NULL
  ) THEN
    INSERT INTO system_config (config_key, config_value, value_type, notes)
    VALUES ('allow_time_travel', 'true', 'enum',
            'Development only. Permits dev_sim_clock to hold a non-zero offset. Absent '
            'or not "true" means the simulated clock cannot be moved (cost audit F-15).')
    ON CONFLICT (config_key) DO NOTHING;
  END IF;
END;
$$;

-- rollback:
-- DROP TRIGGER IF EXISTS dev_sim_clock_environment_gate ON dev_sim_clock;
-- DROP FUNCTION IF EXISTS enforce_time_travel_gate();
-- DROP FUNCTION IF EXISTS time_travel_is_allowed();
-- DELETE FROM system_config WHERE config_key = 'allow_time_travel';
