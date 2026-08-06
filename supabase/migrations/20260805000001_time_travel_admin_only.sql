-- Migration: the simulated clock moves from an environment gate to a role gate.
--
-- Product decision (2026-08-05), as we move toward production: the project administrator
-- must still be able to move the simulated clock in production (there is no other way to
-- exercise the time-driven escalation chain against real production data once it's live),
-- but it must never again be something anyone with a login (or the service-role key) can
-- move. 20260726000008_time_travel_environment_gate.sql's "DEFAULT IS DENY in production"
-- posture is REVERSED here on purpose: production may now time-travel, but only when the
-- acting user is the project administrator. The blast-radius concern that migration
-- documented is unchanged (app_now() drives every escalation deadline and the season
-- reconciliation cutoff) -- the mitigation just moves from "no one, anywhere" to "one
-- accountable person, everywhere, who has to be told what they're about to do."
--
-- Mechanism: enforce_time_travel_gate() no longer reads system_config('allow_time_travel').
-- It instead requires NEW.set_by to be a real user holding the admin role (user_is_admin,
-- migration 20260702000002), REGARDLESS of environment. dev_sim_clock.set_by already exists
-- (20260611000007) and every writer (setSimClock/clearSimClock in
-- apps/web/lib/actions/devClock.ts) already stamps it from the signed-in session -- so this
-- is enforceable at the database layer even though the actual write goes through the
-- service-role client (which bypasses RLS): the trigger checks WHO the app claims performed
-- the write, not what key it used to perform it.
--
-- Resetting to zero remains ALWAYS permitted, gate or no gate -- a database must never be
-- able to get stuck in a time-travelled state it cannot leave.
--
-- allow_time_travel / time_travel_is_allowed() are retired: nothing else in the codebase
-- reads them (grepped clean at the time of this migration), and leaving an unused
-- environment flag beside a role check invites someone to "fix" a denied write by flipping
-- the wrong knob.

DROP TRIGGER IF EXISTS dev_sim_clock_environment_gate ON dev_sim_clock;

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

  IF NEW.set_by IS NULL OR NOT user_is_admin(NEW.set_by) THEN
    RAISE EXCEPTION 'time_travel_admin_only'
      USING DETAIL = 'The simulated clock can only be moved by the project administrator, '
                     'in every environment including production. app_now() drives every '
                     'escalation deadline and the season reconciliation cutoff.',
            HINT = 'Sign in as the project administrator to change simulated time.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_time_travel_gate() IS
  'Rejects a non-zero dev_sim_clock offset unless set_by is the project administrator. '
  'Role-gated in every environment, not environment-gated (superseded 20260726000008).';

CREATE TRIGGER dev_sim_clock_admin_gate
  BEFORE INSERT OR UPDATE ON dev_sim_clock
  FOR EACH ROW
  EXECUTE FUNCTION enforce_time_travel_gate();

DROP FUNCTION IF EXISTS time_travel_is_allowed();

DELETE FROM system_config WHERE config_key = 'allow_time_travel';

-- rollback:
-- DROP TRIGGER IF EXISTS dev_sim_clock_admin_gate ON dev_sim_clock;
-- CREATE OR REPLACE FUNCTION time_travel_is_allowed()
-- RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
--   SELECT COALESCE((SELECT config_value = 'true' FROM system_config WHERE config_key = 'allow_time_travel'), false);
-- $$;
-- GRANT EXECUTE ON FUNCTION time_travel_is_allowed() TO authenticated, service_role;
-- (then restore enforce_time_travel_gate()'s body from 20260726000008 and re-create
--  dev_sim_clock_environment_gate)
