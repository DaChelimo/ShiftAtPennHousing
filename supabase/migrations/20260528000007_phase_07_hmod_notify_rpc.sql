-- Migration: Phase 07 atomic HMOD-notify step RPC — audit fix B-1 (hmod portion).
--
-- Spec sources:
--   ARCHITECTURE §1.3 (atomicity invariant),
--                §4.1 (block_step_status; ON CONFLICT DO NOTHING claim;
--                       rolled_back rows re-fire on the next match),
--                §4.2 ("Step: hmod_notify_allied. Resolve the current
--                       HMOD via hmod_rotor and hm_leave ..."),
--                §4.6 (HM/HMOD routing — both fire time AND block
--                       start time must be in HM hours for HM
--                       recipient; otherwise HMOD);
--   BEHAVIORAL_SPECIFICATION §10.1 (HM working hours [08:00, 17:00),
--                                   weekday only).
--
-- Audit finding addressed:
--
-- B-1 (hmod portion) — orchestrator-tick/index.ts called claimStep()
--   then hmodNotifyAlliedStep() as two separate round-trips. A crash
--   between them left block_step_status='fired' but no notification.
--   This RPC binds the claim INSERT, the recipient resolution, and
--   the notification INSERT into one plpgsql transaction. The
--   recipient resolution helpers (resolve_hm_for_user,
--   resolve_hm_for_house, resolve_hmod_on_duty, is_hm_working_time)
--   were introduced in migration 20260528000004 — see that migration
--   for the no-ack path which uses the same helpers.

CREATE OR REPLACE FUNCTION process_hmod_notify_allied_step(
  p_block_id uuid,
  p_house_id text,
  p_block_start_at timestamptz,
  p_now timestamptz,
  p_reason text DEFAULT 'escalation_chain'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed_count       integer;
  v_recipient_user_id   uuid;
  v_target              text;
BEGIN
  -- Try to claim the step.
  INSERT INTO block_step_status (block_id, step_name, status, fired_at, updated_at)
  VALUES (p_block_id, 'hmod_notify_allied', 'fired', p_now, p_now)
  ON CONFLICT (block_id, step_name) DO NOTHING;

  GET DIAGNOSTICS v_claimed_count = ROW_COUNT;

  IF v_claimed_count = 0 THEN
    -- rolled_back → fired transition (ARCH §4.5).
    UPDATE block_step_status
    SET status     = 'fired',
        fired_at   = p_now,
        updated_at = p_now
    WHERE block_id  = p_block_id
      AND step_name = 'hmod_notify_allied'
      AND status    = 'rolled_back';

    GET DIAGNOSTICS v_claimed_count = ROW_COUNT;
  END IF;

  IF v_claimed_count = 0 THEN
    RETURN jsonb_build_object(
      'claimed',           false,
      'recipient_user_id', NULL,
      'target',            NULL
    );
  END IF;

  -- Routing per ARCH §4.6.
  IF is_hm_working_time(p_now) AND is_hm_working_time(p_block_start_at) THEN
    v_recipient_user_id := resolve_hm_for_house(p_house_id, p_now);
    v_target := 'hm';
    -- Fallback to HMOD if the HM resolution returned NULL (entire
    -- leave chain on leave, or no HM registered for the house).
    IF v_recipient_user_id IS NULL THEN
      v_recipient_user_id := resolve_hmod_on_duty(p_now);
      v_target := 'hmod';
    END IF;
  ELSE
    v_recipient_user_id := resolve_hmod_on_duty(p_now);
    v_target := 'hmod';
  END IF;

  IF v_recipient_user_id IS NULL THEN
    -- No recipient resolvable. The step is claimed (we don't want
    -- future ticks to retry — this is a configuration issue, not a
    -- transient failure). Notification skipped.
    RETURN jsonb_build_object(
      'claimed',           true,
      'recipient_user_id', NULL,
      'target',            v_target
    );
  END IF;

  INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
  VALUES (
    v_recipient_user_id,
    'hmod_urgent'::notification_type,
    p_now,
    jsonb_build_object(
      'target',         v_target,
      'reason',         p_reason,
      'block_id',       p_block_id,
      'house_id',       p_house_id,
      'block_start_at', p_block_start_at
    )
  );

  RETURN jsonb_build_object(
    'claimed',           true,
    'recipient_user_id', v_recipient_user_id,
    'target',            v_target
  );
END;
$$;

REVOKE ALL ON FUNCTION process_hmod_notify_allied_step(uuid, text, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_hmod_notify_allied_step(uuid, text, timestamptz, timestamptz, text) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS process_hmod_notify_allied_step(uuid, text, timestamptz, timestamptz, text);
