-- Migration: enable pg_cron / pg_net and register every scheduled job explicitly.
--
-- WHY THIS EXISTS (production-migration landmine L1).
--
-- All seven cron.schedule() call sites in this repo are wrapped in
--
--     IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN ... END IF;
--
-- Hosted Supabase does NOT enable pg_cron by default. So on a fresh hosted project every
-- one of those guards evaluates false, `supabase db push` reports success, all migrations
-- apply green, and the orchestrator tick, notification delivery, swap expiry, break
-- transitions, preference reminders, house transfers and the retention sweep are simply
-- never created. Nothing warns you. The system looks deployed and is inert.
--
-- Those guards exist for a good reason (a local stack without pg_cron must still migrate),
-- so this migration does not remove them. It makes them belt-and-braces instead of the
-- only line of defence: create the extensions FIRST, then re-register every job
-- idempotently now that cron.schedule is guaranteed to resolve.
--
-- CREATE EXTENSION is deliberately UNGUARDED. If an environment cannot create these, this
-- migration must fail loudly at push time rather than hand back a silently inert database.
-- That is the entire point of the change.
--
-- LOCAL STAYS CRON-FREE. supabase/seed.sql (which runs only on `db reset`, never on
-- `db push`) unschedules these again, so the local dev loop keeps its manual
-- "Run orchestrator now" harness and `expire_pending_swaps_if_uncronned` keeps returning
-- >= 0 for supabase/tests/cost-audit-remediation.sql. Hosted staging and production are
-- therefore an identical, fully autonomous pair; only the local copy differs.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- 1. Register every scheduled job.
-- ---------------------------------------------------------------------------
-- Bodies are copied verbatim from the migration that owns each job, so this stays a
-- re-registration and never a redefinition:
--
--   preference-reminders     20260527000005_schedule_builder.sql
--   orchestrator-tick        20260528000002_phase_07_orchestrator.sql
--   swap-expiry              20260611000007_dev_sim_clock.sql   (app_now(), supersedes
--                            the now() body in 20260530000001_phase_09_swaps.sql -- these
--                            are the two call sites that share one job name, which is why
--                            eight call sites produce seven jobs)
--   break-phase-transitions  20260531000002_phase_11_break_claim.sql
--   deliver-notifications    20260601000001_phase_12_notifications.sql
--   apply-house-transfers    20260719000001_house_transfers.sql
--   operational-retention    20260726000005_operational_retention.sql
DO $do$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT * FROM (VALUES
      ('preference-reminders',
       '0 * * * *',
       $sql$SELECT send_preference_reminders()$sql$),

      ('orchestrator-tick',
       '* * * * *',
       $sql$
        SELECT net.http_post(
          url := current_setting('app.supabase_url') || '/functions/v1/orchestrator-tick',
          headers := jsonb_build_object(
            'Authorization',
            'Bearer ' || current_setting('app.service_role_key')
          )
        )
       $sql$),

      ('swap-expiry',
       '* * * * *',
       $sql$UPDATE swap_requests SET status='expired' WHERE status='pending' AND expires_at <= app_now()$sql$),

      ('break-phase-transitions',
       '*/15 * * * *',
       $sql$SELECT execute_due_break_transitions()$sql$),

      ('deliver-notifications',
       '* * * * *',
       $sql$SELECT deliver_pending_notifications()$sql$),

      ('apply-house-transfers',
       '15 * * * *',
       $sql$SELECT apply_due_house_transfers()$sql$),

      ('operational-retention',
       '20 3 * * *',
       $sql$SELECT purge_expired_operational_records()$sql$)
    ) AS t(jobname, schedule, command)
  LOOP
    -- Re-registration, not duplication: cron.schedule() on an existing jobname updates it,
    -- but unscheduling first also clears a job whose SCHEDULE changed in a way that would
    -- otherwise persist.
    BEGIN
      PERFORM cron.unschedule(v_job.jobname);
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;

    PERFORM cron.schedule(v_job.jobname, v_job.schedule, v_job.command);
  END LOOP;
END;
$do$;

-- ---------------------------------------------------------------------------
-- 2. One authoritative readiness check for an autonomous environment.
-- ---------------------------------------------------------------------------
-- A registered job that cannot reach the Edge Function fails exactly as silently as a job
-- that was never registered: orchestrator-tick reads app.supabase_url and
-- app.service_role_key via current_setting() with no missing_ok, so when they are unset it
-- raises once a minute into cron.job_run_details and nothing surfaces. Checking
-- `SELECT * FROM cron.job` alone would report that environment healthy.
--
-- So this verifies the whole chain: extensions, every expected job at its expected
-- schedule, and the two settings the tick depends on. Any row with status <> 'ok' means
-- this database will NOT run unattended.
CREATE OR REPLACE FUNCTION verify_scheduled_jobs()
RETURNS TABLE (check_name text, status text, detail text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_expected constant text[][] := ARRAY[
    ['preference-reminders',    '0 * * * *'],
    ['orchestrator-tick',       '* * * * *'],
    ['swap-expiry',             '* * * * *'],
    ['break-phase-transitions', '*/15 * * * *'],
    ['deliver-notifications',   '* * * * *'],
    ['apply-house-transfers',   '15 * * * *'],
    ['operational-retention',   '20 3 * * *']
  ];
  v_name     text;
  v_schedule text;
  v_actual   text;
  v_active   boolean;
  i          integer;
BEGIN
  -- Extensions.
  FOR v_name IN SELECT unnest(ARRAY['pg_cron', 'pg_net']) LOOP
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = v_name) THEN
      RETURN QUERY SELECT 'extension: ' || v_name, 'ok', 'installed';
    ELSE
      RETURN QUERY SELECT 'extension: ' || v_name, 'MISSING',
                          'not installed -- scheduled work cannot run at all';
    END IF;
  END LOOP;

  -- Jobs. cron.job is absent entirely when pg_cron was never created.
  IF to_regclass('cron.job') IS NULL THEN
    RETURN QUERY SELECT 'cron.job', 'MISSING',
                        'pg_cron absent, so no job can be registered';
  ELSE
    FOR i IN 1 .. array_length(v_expected, 1) LOOP
      v_name     := v_expected[i][1];
      v_schedule := v_expected[i][2];

      EXECUTE 'SELECT schedule, active FROM cron.job WHERE jobname = $1'
        INTO v_actual, v_active
        USING v_name;

      IF v_actual IS NULL THEN
        RETURN QUERY SELECT 'job: ' || v_name, 'MISSING', 'not registered';
      ELSIF v_actual <> v_schedule THEN
        RETURN QUERY SELECT 'job: ' || v_name, 'DRIFT',
                            format('schedule is %L, expected %L', v_actual, v_schedule);
      ELSIF NOT COALESCE(v_active, false) THEN
        RETURN QUERY SELECT 'job: ' || v_name, 'INACTIVE',
                            'registered but active = false';
      ELSE
        RETURN QUERY SELECT 'job: ' || v_name, 'ok', v_actual;
      END IF;
    END LOOP;
  END IF;

  -- The two settings orchestrator-tick dereferences. Without these the job is registered
  -- and useless.
  FOR v_name IN SELECT unnest(ARRAY['app.supabase_url', 'app.service_role_key']) LOOP
    IF COALESCE(current_setting(v_name, true), '') = '' THEN
      RETURN QUERY SELECT 'setting: ' || v_name, 'MISSING',
                          'unset -- orchestrator-tick will raise on every run. Fix with '
                          'ALTER DATABASE postgres SET ' || v_name || ' = ...';
    ELSE
      -- Never return the service-role key itself.
      RETURN QUERY SELECT 'setting: ' || v_name, 'ok',
                          CASE WHEN v_name = 'app.service_role_key'
                               THEN 'set'
                               ELSE current_setting(v_name, true) END;
    END IF;
  END LOOP;
END;
$fn$;

-- Per supabase/AGENTS.md: REVOKE ... FROM PUBLIC does not strip Supabase's default
-- anon/authenticated EXECUTE grants, so name those roles explicitly.
REVOKE ALL ON FUNCTION verify_scheduled_jobs() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION verify_scheduled_jobs() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_scheduled_jobs() TO service_role;

COMMENT ON FUNCTION verify_scheduled_jobs() IS
  'Deploy readiness: extensions, every expected cron job at its expected schedule, and the '
  'app.supabase_url / app.service_role_key settings orchestrator-tick dereferences. Any '
  'row with status <> ''ok'' means this database will not run unattended. Service-role only.';

-- rollback:
-- DROP FUNCTION IF EXISTS verify_scheduled_jobs();
-- SELECT cron.unschedule(j) FROM unnest(ARRAY[
--   'preference-reminders','orchestrator-tick','swap-expiry','break-phase-transitions',
--   'deliver-notifications','apply-house-transfers','operational-retention']) AS j;
-- (pg_cron / pg_net are intentionally NOT dropped: other migrations depend on them.)
