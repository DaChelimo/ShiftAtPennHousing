-- Batch D (part): cross-phase consistency.
--   D10 — restore the worker-role filter in send_preference_reminders so only
--         SWs/SMs (who actually submit preferences) are reminded, not BMs or
--         pure HMs (X-4/F-07-006).
--   D11 — add the hmod_rotor.hmod_user_id FK to users and a trigger enforcing
--         that the rotor user holds an hm or bm role (F-02-001/F-01-005/007).
--
-- NOTE: D9 (revert user_has_house_admin_role to hm/bm-only + re-point the
-- schedule-builder policies to user_can_build_schedule) is intentionally NOT
-- included here: it re-points ~12 RLS policies whose correctness cannot be
-- verified by the current owner-role pgTAP suite (RLS is bypassed for the
-- table owner). It needs SET ROLE authenticated coverage (audit G1) first.

-- ============================================================
-- D10
-- ============================================================
CREATE OR REPLACE FUNCTION send_preference_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH active_thresholds AS (
    SELECT
      sp.period_id,
      sp.period_name,
      sp.preference_deadline,
      threshold_days
    FROM scheduling_periods sp
    CROSS JOIN (VALUES (5), (3), (1)) AS threshold_values(threshold_days)
    WHERE sp.preference_deadline IS NOT NULL
      AND sp.published_at IS NULL
      AND now() >= sp.preference_deadline - (threshold_values.threshold_days || ' days')::interval
      AND now() < sp.preference_deadline - (threshold_values.threshold_days || ' days')::interval
        + interval '1 hour'
  ),
  candidate_workers AS (
    SELECT DISTINCT
      active_thresholds.period_id,
      users.user_id,
      active_thresholds.threshold_days
    FROM active_thresholds
    JOIN users
      ON users.is_active = true
    -- Only workers who can submit preferences (SW/SM). Excludes BMs and
    -- pure HMs. A user may hold both sw+sm, hence DISTINCT.
    JOIN user_roles ur
      ON ur.user_id = users.user_id
     AND ur.role IN ('sw', 'sm')
    WHERE NOT EXISTS (
        SELECT 1
        FROM period_targets
        WHERE period_targets.period_id = active_thresholds.period_id
          AND period_targets.user_id = users.user_id
      )
  ),
  recorded_sends AS (
    INSERT INTO preference_reminder_sends (period_id, user_id, threshold_days)
    SELECT period_id, user_id, threshold_days
    FROM candidate_workers
    ON CONFLICT (period_id, user_id, threshold_days) DO NOTHING
    RETURNING period_id, user_id, threshold_days, notification_id, sent_at
  ),
  inserted_notifications AS (
    INSERT INTO notifications (notification_id, recipient_user_id, type, scheduled_for, payload)
    SELECT
      recorded_sends.notification_id,
      recorded_sends.user_id,
      'ack_reminder'::notification_type,
      recorded_sends.sent_at,
      jsonb_build_object(
        'kind', 'preference_reminder',
        'period_id', recorded_sends.period_id,
        'threshold_days', recorded_sends.threshold_days
      )
    FROM recorded_sends
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_inserted FROM inserted_notifications;

  RETURN v_inserted;
END;
$$;

-- ============================================================
-- D11 — hmod_rotor integrity.
-- ============================================================
ALTER TABLE hmod_rotor
  ADD CONSTRAINT hmod_rotor_hmod_user_id_fkey
  FOREIGN KEY (hmod_user_id) REFERENCES users (user_id);

CREATE OR REPLACE FUNCTION enforce_hmod_rotor_role()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = NEW.hmod_user_id AND role IN ('hm', 'bm')
  ) THEN
    RAISE EXCEPTION 'HMOD rotor user % must hold an hm or bm role', NEW.hmod_user_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER hmod_rotor_enforce_role
  BEFORE INSERT OR UPDATE OF hmod_user_id ON hmod_rotor
  FOR EACH ROW EXECUTE FUNCTION enforce_hmod_rotor_role();
