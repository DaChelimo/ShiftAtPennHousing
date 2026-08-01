-- Migration: resolve the orchestrator cron's HTTP target through Vault, not a GUC.
--
-- WHY.
--
-- 20260528000002_phase_07_orchestrator.sql schedules `orchestrator-tick` with a body that
-- dereferences two custom GUCs:
--
--     current_setting('app.supabase_url')
--     current_setting('app.service_role_key')
--
-- and supabase/AGENTS.md records setting them as required deploy configuration. On hosted
-- Supabase that is IMPOSSIBLE: setting a custom `app.*` parameter needs superuser, and the
-- platform grants it to nobody. Both forms fail:
--
--     ALTER DATABASE postgres SET app.supabase_url = ...  ->  42501 permission denied
--     ALTER ROLE     postgres SET app.supabase_url = ...  ->  42501 permission denied
--
-- (Verified against a live project on 2026-07-27.) The cron would therefore be registered,
-- active, and raising `unrecognized configuration parameter` on every single run, with the
-- failure buried in cron.job_run_details. That is the same class of silent inertness as
-- landmine L1 itself: the job exists, so a `SELECT * FROM cron.job` check calls it healthy.
--
-- Supabase's supported mechanism for exactly this (pg_cron + pg_net calling an Edge
-- Function) is Vault. So the target is resolved through a helper that reads Vault FIRST and
-- falls back to the GUC, which keeps self-hosted and any environment that CAN set a GUC
-- working unchanged. Nothing about the schedule or the Edge Function changes.

-- ---------------------------------------------------------------------------
-- 1. The resolver.
-- ---------------------------------------------------------------------------
-- SECURITY: this returns the SERVICE ROLE KEY. It is deliberately granted to NO ONE.
-- pg_cron runs a job as the role that scheduled it (postgres, the owner here), and an owner
-- may execute its own function without a grant, so the cron works while anon, authenticated
-- and even service_role cannot call this at all. Per supabase/AGENTS.md, REVOKE ... FROM
-- PUBLIC does not strip Supabase's default anon/authenticated EXECUTE grants, so those roles
-- are named explicitly below.
CREATE OR REPLACE FUNCTION app_runtime_setting(p_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_value text;
BEGIN
  -- Vault first: the only mechanism hosted Supabase permits.
  BEGIN
    SELECT decrypted_secret
      INTO v_value
      FROM vault.decrypted_secrets
     WHERE name = p_name
     LIMIT 1;
  EXCEPTION
    -- vault may be absent (a bare Postgres) or unreadable; fall through to the GUC.
    WHEN undefined_table OR invalid_schema_name OR insufficient_privilege THEN
      v_value := NULL;
  END;

  IF COALESCE(v_value, '') <> '' THEN
    RETURN v_value;
  END IF;

  -- Fallback: a GUC, for environments where a superuser can actually set one.
  v_value := current_setting(p_name, true);
  IF COALESCE(v_value, '') <> '' THEN
    RETURN v_value;
  END IF;

  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION app_runtime_setting(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_runtime_setting(text) FROM anon, authenticated, service_role;

COMMENT ON FUNCTION app_runtime_setting(text) IS
  'Resolves a deploy-time setting from Vault, falling back to a GUC. Returns secrets, so it '
  'is granted to NO role: pg_cron executes it as the owning postgres role. Hosted Supabase '
  'forbids custom app.* GUCs entirely, which is why Vault is the primary source.';

-- ---------------------------------------------------------------------------
-- 2. Re-register orchestrator-tick against the resolver.
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    PERFORM cron.unschedule('orchestrator-tick');
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  PERFORM cron.schedule(
    'orchestrator-tick',
    '* * * * *',
    $sql$
      SELECT net.http_post(
        url := app_runtime_setting('app.supabase_url') || '/functions/v1/orchestrator-tick',
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || app_runtime_setting('app.service_role_key')
        )
      )
    $sql$
  );
END;
$do$;

-- ---------------------------------------------------------------------------
-- 3. Teach the readiness check to use the resolver.
-- ---------------------------------------------------------------------------
-- Checking current_setting() directly would now report a correctly-configured hosted
-- project as broken, since its values live in Vault and no GUC exists.
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
  v_resolved text;
  i          integer;
BEGIN
  FOR v_name IN SELECT unnest(ARRAY['pg_cron', 'pg_net']) LOOP
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = v_name) THEN
      RETURN QUERY SELECT 'extension: ' || v_name, 'ok', 'installed';
    ELSE
      RETURN QUERY SELECT 'extension: ' || v_name, 'MISSING',
                          'not installed -- scheduled work cannot run at all';
    END IF;
  END LOOP;

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

  -- Resolved through Vault-then-GUC, which is what the cron body actually does.
  FOR v_name IN SELECT unnest(ARRAY['app.supabase_url', 'app.service_role_key']) LOOP
    v_resolved := app_runtime_setting(v_name);

    IF COALESCE(v_resolved, '') = '' THEN
      RETURN QUERY SELECT 'setting: ' || v_name, 'MISSING',
                          'unresolved -- orchestrator-tick will fail every run. Set it with '
                          'SELECT vault.create_secret(''<value>'', ' || quote_literal(v_name) || ')';
    ELSE
      RETURN QUERY SELECT 'setting: ' || v_name, 'ok',
                          CASE WHEN v_name = 'app.service_role_key'
                               THEN 'set (' || length(v_resolved) || ' chars)'
                               ELSE v_resolved END;
    END IF;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION verify_scheduled_jobs() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION verify_scheduled_jobs() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_scheduled_jobs() TO service_role;

-- rollback:
-- (restore the 20260528000002 orchestrator-tick body, then)
-- DROP FUNCTION IF EXISTS app_runtime_setting(text);
