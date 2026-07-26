-- Migration: retention for float_assignments and notifications (cost audit F-14).
--
-- Every piece of the retention mechanism already existed EXCEPT the job that deletes
-- anything. float_assignments.expires_for_cleanup_at is NOT NULL, has a dedicated index,
-- and float_retention_days is a live runtime config the orchestrator reads and threads
-- into process_float_lookup_assignment -- yet
-- `grep -rn "DELETE FROM float_assignments\|DELETE FROM notifications" supabase/ packages/ apps/`
-- returned nothing. The column was write-only and both tables grew forever.
--
-- That is the multiplier under F-06 and F-08 rather than a cost on its own: it converts
-- two every-minute scans from steady-state into monotonically degrading.
--
-- PRODUCT DECISION (2026-07-26): delete outright at 28 days. No archive tables -- four
-- weeks on, this operational detail is not information anyone acts on. Consequence,
-- accepted explicitly: shift_block_assignments.parent_float_id is ON DELETE SET NULL, so
-- deleting a float nulls the "why was this shift floated" linkage on assignment rows
-- older than 28 days.
--
-- THREE SAFETY RULES, none of which are negotiable:
--
--   1. A float that is still `pending` is NEVER deleted, at any age. Deleting a live
--      float would revoke it, and the no-takeback invariant (AGENTS #3) says automated
--      systems may not revoke a pending or acknowledged float. A 28-day-old pending
--      float is an anomaly to investigate, not to silently erase. The retention horizon
--      is in any case far past any window in which a float could still be acted on.
--   2. A notification is deleted only once it has reached a TERMINAL state -- delivered,
--      suppressed, or dead-lettered. A row that is somehow still undelivered after 28
--      days is evidence of a delivery fault and is kept. (After 20260726000004 that
--      cannot persist anyway: everything either delivers or dead-letters.)
--   3. Deletes are CHUNKED. An unbounded DELETE over a semester of notifications would
--      hold locks and write one enormous WAL record -- which, because notifications is
--      in the supabase_realtime publication with REPLICA IDENTITY FULL, would then be
--      decoded and fanned out to every connected client. That is F-09's failure mode and
--      retention must not reintroduce it.

INSERT INTO system_config (config_key, config_value, value_type, notes)
VALUES
  ('operational_retention_days', '28', 'integer',
   'Age past which delivered/terminal notifications and non-pending float assignments '
   'are deleted. Four weeks; after that the operational detail is not acted on. '
   'Deleting a float nulls shift_block_assignments.parent_float_id (ON DELETE SET NULL).'),
  ('retention_delete_batch_size', '5000', 'integer',
   'Rows deleted per statement by the retention sweep. Chunked so the sweep never holds '
   'a long lock or emits one huge WAL record for Realtime to fan out.')
ON CONFLICT (config_key) DO NOTHING;

CREATE OR REPLACE FUNCTION operational_retention_days()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(COALESCE(
    (SELECT NULLIF(regexp_replace(config_value, '\D', '', 'g'), '')::integer
       FROM system_config WHERE config_key = 'operational_retention_days'),
    28
  ), 1);
$$;

CREATE OR REPLACE FUNCTION purge_expired_operational_records(p_now timestamptz DEFAULT now())
RETURNS TABLE (floats_deleted integer, notifications_deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff     timestamptz := p_now - make_interval(days => operational_retention_days());
  v_batch      integer := GREATEST(COALESCE(
                   (SELECT NULLIF(regexp_replace(config_value, '\D', '', 'g'), '')::integer
                      FROM system_config WHERE config_key = 'retention_delete_batch_size'),
                   5000), 1);
  v_floats     integer := 0;
  v_notifs     integer := 0;
  v_round      integer;
BEGIN
  -- Floats. Safety rule 1: `pending` is excluded unconditionally. expires_for_cleanup_at
  -- is honoured as well as the age floor, so the existing float_retention_days knob still
  -- means something and the 28-day floor is the outer bound of the two.
  LOOP
    DELETE FROM float_assignments
    WHERE float_id IN (
      SELECT float_id
      FROM float_assignments
      WHERE status <> 'pending'
        AND created_at < v_cutoff
        AND expires_for_cleanup_at < p_now
      ORDER BY created_at
      LIMIT v_batch
    );
    GET DIAGNOSTICS v_round = ROW_COUNT;
    v_floats := v_floats + v_round;
    EXIT WHEN v_round < v_batch;
  END LOOP;

  -- Notifications. Safety rule 2: terminal states only.
  LOOP
    DELETE FROM notifications
    WHERE notification_id IN (
      SELECT notification_id
      FROM notifications
      WHERE created_at < v_cutoff
        AND (
          delivered_at IS NOT NULL
          OR suppressed_at IS NOT NULL
          OR dead_lettered_at IS NOT NULL
        )
      ORDER BY created_at
      LIMIT v_batch
    );
    GET DIAGNOSTICS v_round = ROW_COUNT;
    v_notifs := v_notifs + v_round;
    EXIT WHEN v_round < v_batch;
  END LOOP;

  RETURN QUERY SELECT v_floats, v_notifs;
END;
$$;

REVOKE ALL ON FUNCTION operational_retention_days() FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_expired_operational_records(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operational_retention_days() TO service_role;
GRANT EXECUTE ON FUNCTION purge_expired_operational_records(timestamptz) TO service_role;

COMMENT ON FUNCTION purge_expired_operational_records(timestamptz) IS
  'Delete non-pending float assignments and terminal-state notifications older than '
  'operational_retention_days (28). Cost audit F-14: without this, F-06''s and F-08''s '
  'every-minute scans degrade forever. Never deletes a pending float (no-takeback, '
  'AGENTS #3) or a non-terminal notification. Chunked to avoid a long lock and a huge '
  'Realtime fan-out.';

-- Daily, not per-minute: this is housekeeping, and running it hourly would burn the
-- saving it exists to produce. 03:20 is off-peak for a desk-staffing system.
DO $$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    IF to_regprocedure('cron.unschedule(text)') IS NOT NULL THEN
      BEGIN
        PERFORM cron.unschedule('operational-retention');
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;
    END IF;

    PERFORM cron.schedule(
      'operational-retention',
      '20 3 * * *',
      'SELECT purge_expired_operational_records()'
    );
  END IF;
EXCEPTION
  WHEN invalid_schema_name OR undefined_function THEN
    NULL;
END;
$$;

-- rollback:
-- SELECT cron.unschedule('operational-retention');
-- DROP FUNCTION IF EXISTS purge_expired_operational_records(timestamptz);
-- DROP FUNCTION IF EXISTS operational_retention_days();
-- DELETE FROM system_config WHERE config_key IN
--   ('operational_retention_days', 'retention_delete_batch_size');
