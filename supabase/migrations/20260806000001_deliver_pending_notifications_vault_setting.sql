-- Migration: resolve deliver_pending_notifications' HTTP target through Vault, not a GUC.
--
-- WHY.
--
-- 20260727000002_cron_http_target_via_vault.sql fixed this exact problem for
-- orchestrator-tick: on hosted Supabase, setting a custom `app.*` GUC requires
-- superuser, which the platform grants to nobody (`ALTER DATABASE postgres SET
-- app.supabase_url = ...` -> 42501 permission denied, verified against a live project).
-- That migration introduced `app_runtime_setting()`, which reads Vault first and falls
-- back to a GUC, and repointed orchestrator-tick's cron body at it.
--
-- deliver_pending_notifications (phase-12, most recently redefined by
-- 20260728000003_shift_reminders.sql) was never updated to match. It still calls
-- current_setting('app.supabase_url', true) / current_setting('app.service_role_key',
-- true) directly, so on hosted Supabase it unconditionally hits its own
-- "must be configured" early return and RAISE WARNING on every single invocation --
-- every notification type this function delivers (float assignments, swaps, shift
-- reminders, ack reminders, everything under BSpec S10.1) has been silently
-- undeliverable on hosted Supabase since phase 12 shipped. Discovered 2026-08-06 while
-- manually verifying push delivery end-to-end: FIREBASE_SERVICE_ACCOUNT_JSON was
-- correctly configured and a real device had a real registered token, yet
-- deliver_pending_notifications() returned 0 with nothing due -- because it can never
-- see app.supabase_url / app.service_role_key at all on this platform, independent of
-- whether they were ever set.
--
-- Body is otherwise byte-for-byte the 20260728000003 definition.
CREATE OR REPLACE FUNCTION deliver_pending_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  v_notification notifications%ROWTYPE;
  v_supabase_url text := app_runtime_setting('app.supabase_url');
  v_service_key  text := app_runtime_setting('app.service_role_key');
  v_queued       integer := 0;
BEGIN
  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING 'deliver_pending_notifications: app.supabase_url and app.service_role_key must be configured';
    RETURN 0;
  END IF;

  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE WARNING 'deliver_pending_notifications: pg_net net.http_post is unavailable';
    RETURN 0;
  END IF;

  -- One set-based statement per minute that permanently drains the tombstones, instead
  -- of re-filtering them per row forever (F-08).
  PERFORM sweep_suppressed_ack_reminders(now());

  FOR v_notification IN
    SELECT * FROM pending_notification_deliveries(now())
  LOOP
    PERFORM net.http_post(
      url := rtrim(v_supabase_url, '/') || '/functions/v1/dispatch-push',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'user_id', v_notification.recipient_user_id,
        'notification_id', v_notification.notification_id
      )
    );
    v_queued := v_queued + 1;
  END LOOP;

  RETURN v_queued;
END;
$$;

-- rollback:
-- (restore the 20260728000003 deliver_pending_notifications body verbatim)
