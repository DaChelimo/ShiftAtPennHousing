-- Migration: Phase 07 atomic broadcast step RPC — audit fix B-1 (broadcast).
--
-- Spec sources:
--   ARCHITECTURE §1.3 (atomicity invariant),
--                §4.1 (block_step_status; ON CONFLICT DO NOTHING claim;
--                       rolled_back rows are treated as "not yet
--                       processed" and re-fire when re-evaluated),
--                §4.2 ("Step: broadcast. Query users WHERE
--                       broadcast_subscribed = true AND home_house_id
--                       = :house_id AND is_active = true ... Generate
--                       notifications for each matched user.");
--   BEHAVIORAL_SPECIFICATION §5.4 (T-3h broadcast step),
--                            §10.1 (broadcast goes only to subscribed
--                                   SWs at the shift's home house).
--
-- Audit finding addressed:
--
-- B-1 (broadcast portion) — orchestrator-tick/index.ts called
--   claimStep() (INSERT block_step_status ... 'fired') and then
--   broadcastStep() (INSERT INTO notifications) as two separate
--   PostgREST round-trips. If the Edge Function died between them,
--   the chain step said 'fired' but no notifications were sent — the
--   "broadcast" never reached anyone, and no retry mechanism existed
--   because the orchestrator's "not yet processed" predicate excludes
--   rows with status='fired'.
--
--   This RPC ties the claim INSERT and the notifications INSERT into
--   one plpgsql transaction. Either both succeed or neither commits.
--   Idempotency is preserved via ON CONFLICT DO NOTHING on the
--   block_step_status PK — concurrent ticks racing on the same block
--   resolve cleanly: one wins the claim, the other returns
--   `claimed=false` and inserts no notifications.
--
-- Per the spec, no role filter on the user query: the broadcast
-- subscription guard at write time (BSpec §10.1) makes it structurally
-- impossible for an HM or BM to have broadcast_subscribed=true.

CREATE OR REPLACE FUNCTION process_broadcast_step(
  p_block_id uuid,
  p_house_id text,
  p_block_start_at timestamptz,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed_count    integer;
  v_notifications    integer;
BEGIN
  -- Try to claim. ON CONFLICT DO NOTHING handles the "fresh row"
  -- race: only one tick inserts; concurrent calls return 0 affected.
  INSERT INTO block_step_status (block_id, step_name, status, fired_at, updated_at)
  VALUES (p_block_id, 'broadcast', 'fired', p_now, p_now)
  ON CONFLICT (block_id, step_name) DO NOTHING;

  GET DIAGNOSTICS v_claimed_count = ROW_COUNT;

  IF v_claimed_count = 0 THEN
    -- The PK collision means a row already exists. Try the
    -- rolled_back → fired transition (ARCH §4.5 rollback procedure):
    -- a force-trigger decline / no-ack rolls broadcast back so the
    -- chain re-fires it. The UPDATE only matches rolled_back rows; if
    -- the existing row is 'fired' or 'completed_via_force_trigger',
    -- the UPDATE matches nothing and we exit without claiming.
    UPDATE block_step_status
    SET status     = 'fired',
        fired_at   = p_now,
        updated_at = p_now
    WHERE block_id  = p_block_id
      AND step_name = 'broadcast'
      AND status    = 'rolled_back';

    GET DIAGNOSTICS v_claimed_count = ROW_COUNT;
  END IF;

  IF v_claimed_count = 0 THEN
    RETURN jsonb_build_object(
      'claimed',             false,
      'notifications_sent',  0
    );
  END IF;

  -- Insert one notification per subscribed SW at the block's house.
  WITH inserted AS (
    INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
    SELECT
      user_id,
      'broadcast'::notification_type,
      p_now,
      jsonb_build_object(
        'block_id',       p_block_id,
        'house_id',       p_house_id,
        'block_start_at', p_block_start_at
      )
    FROM users
    WHERE broadcast_subscribed = true
      AND home_house_id        = p_house_id
      AND is_active            = true
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_notifications FROM inserted;

  RETURN jsonb_build_object(
    'claimed',             true,
    'notifications_sent',  v_notifications
  );
END;
$$;

REVOKE ALL ON FUNCTION process_broadcast_step(uuid, text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_broadcast_step(uuid, text, timestamptz, timestamptz) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS process_broadcast_step(uuid, text, timestamptz, timestamptz);
