-- Migration: restore Vault-awareness to verify_scheduled_jobs' settings check.
--
-- WHY.
--
-- 20260727000002_cron_http_target_via_vault.sql taught this function to resolve
-- app.supabase_url / app.service_role_key through `app_runtime_setting()` (Vault first,
-- GUC fallback), precisely because hosted Supabase forbids custom `app.*` GUCs and a
-- correctly-configured hosted project would otherwise be reported as broken.
--
-- 20260728000003_shift_reminders.sql then did CREATE OR REPLACE on this function to fold
-- the new shift-reminders job into the expected list, and in doing so reinstated the
-- pre-fix body -- reverting the settings check to raw `current_setting(v_name, true)`.
-- The job list moved forward; the settings check silently moved backward.
--
-- The consequence is worse than a cosmetic wrong label: this is the one authoritative
-- readiness check for an autonomous environment, and on 2026-08-06 it reported
--
--     setting: app.supabase_url      MISSING
--     setting: app.service_role_key  MISSING
--
-- for a project where BOTH were correctly present in Vault and delivery was demonstrably
-- working. A health check that reports a healthy system as broken trains people to ignore
-- it, and would have sent the next person debugging push delivery down the same dead end
-- this migration's sibling (20260806000001) was written to close.
--
-- Body is the 20260728000003 definition verbatim -- same expected-job list, same job
-- checks -- with only the settings loop restored to app_runtime_setting().
CREATE OR REPLACE FUNCTION verify_scheduled_jobs()
RETURNS TABLE (check_name text, status text, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected constant text[][] := ARRAY[
    ['preference-reminders',    '0 * * * *'],
    ['orchestrator-tick',       '* * * * *'],
    ['swap-expiry',             '* * * * *'],
    ['break-phase-transitions', '*/15 * * * *'],
    ['deliver-notifications',   '* * * * *'],
    ['apply-house-transfers',   '15 * * * *'],
    ['operational-retention',   '20 3 * * *'],
    ['shift-reminders',         '5 * * * *']
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
                            'schedule is ' || v_actual || ', expected ' || v_schedule;
      ELSIF NOT COALESCE(v_active, false) THEN
        RETURN QUERY SELECT 'job: ' || v_name, 'INACTIVE', 'registered but disabled';
      ELSE
        RETURN QUERY SELECT 'job: ' || v_name, 'ok', v_actual;
      END IF;
    END LOOP;
  END IF;

  -- Resolved through Vault-then-GUC, which is what the cron bodies and
  -- deliver_pending_notifications actually do. Checking current_setting() directly
  -- reports a correctly-configured hosted project as broken.
  FOR v_name IN SELECT unnest(ARRAY['app.supabase_url', 'app.service_role_key']) LOOP
    v_resolved := app_runtime_setting(v_name);

    IF COALESCE(v_resolved, '') = '' THEN
      RETURN QUERY SELECT 'setting: ' || v_name, 'MISSING',
                          'unresolved -- cron jobs that call an Edge Function will fail. Set it with '
                          'SELECT vault.create_secret(''<value>'', ' || quote_literal(v_name) || ')';
    ELSE
      RETURN QUERY SELECT 'setting: ' || v_name, 'ok',
                          CASE WHEN v_name = 'app.service_role_key'
                               THEN 'set (' || length(v_resolved) || ' chars)'
                               ELSE v_resolved END;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION verify_scheduled_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_scheduled_jobs() TO service_role;

-- rollback:
-- (restore the 20260728000003 verify_scheduled_jobs body verbatim)
