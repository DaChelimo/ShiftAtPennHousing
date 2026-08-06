-- Migration: the T-3h `broadcast` step pushed one notification PER 30-MINUTE BLOCK,
-- and pushed it even for seats it had already locked out of pickup.
--
-- TWO DEFECTS, both seen live on the Harnwell pilot on 2026-08-06 and both fixed
-- here because both live in `process_broadcast_step`.
--
-- DEFECT 1 -- no span merge. `process_broadcast_step(p_block_id, ...)` takes ONE
-- block, formats ONE start time, and claims `block_step_status(block_id,
-- 'broadcast')`, so an N-block vacancy emits N notifications. A one-hour vacancy
-- produced "Harnwell needs cover on Thu, Aug 6, 11:00." and "... 11:30." as two
-- separate pushes; a four-hour vacancy would produce eight. This is exactly the
-- failure 20260729000013 called out for the drop path ("8 pushes for one event is
-- how a mandatory channel gets muted at the OS level, which would silently break
-- the float ack notifications that share it") and then fixed only on that path.
-- `notify_shift_opened` has merged spans since that migration; the escalation
-- chain never did.
--
-- DEFECT 2 -- announcing locked seats. `coverage_locked_at` (BSpec §5.5) marks a
-- block whose desk was empty at its T-2h step; its seats are NOT claimable and
-- `is_assignment_claimable` refuses them. `drop_shift` has suppressed
-- `notify_shift_opened` on a locked block since 20260729000013, but
-- `process_broadcast_step` had no such check. Normally the ordering hides this
-- (broadcast is T-3h, the lock is T-2h), but any vacancy discovered INSIDE T-2h
-- fires both in the same minute -- which is what happened: the blocks were locked
-- at 14:58:00 and the broadcast went out at 14:59:00 telling every Harnwell worker
-- to "Open the app to claim it." Every one of them would have hit a dead end.
--
-- WHAT MERGING MEANS HERE. The chain step stays PER BLOCK -- every block still
-- claims its own `block_step_status` row, so the chain's atomicity, its rollback
-- procedure (ARCH §4.5) and its onward escalation to float/Allied are all
-- unchanged. Only the NOTIFICATION is merged: a block computes the contiguous run
-- of not-yet-announced vacant blocks it belongs to, and emits only if it is the
-- FIRST block of that run, describing the whole run. Every other block in the run
-- claims its step and emits nothing.
--
-- That test is ORDER-INDEPENDENT: it depends on the run's shape, not on which
-- block the orchestrator happens to visit first. Whichever order the tick walks
-- 11:00 and 11:30 in, exactly one notification comes out, and it says
-- "11:00 to 12:00".
--
-- Run membership deliberately EXCLUDES blocks whose broadcast fired in an EARLIER
-- tick (`fired_at < p_now`; the orchestrator passes one `now` for the whole tick).
-- Without that clause an incremental vacancy would go silent: 11:00 dropped and
-- announced at 08:00, then 11:30 dropped at 09:00 would find 11:00 still vacant,
-- decide it was not the run start, and nobody would ever hear about 11:30.
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
  v_locked           boolean;
  v_run_start        timestamptz;
  v_run_last         timestamptz;
BEGIN
  INSERT INTO block_step_status (block_id, step_name, status, fired_at, updated_at)
  VALUES (p_block_id, 'broadcast', 'fired', p_now, p_now)
  ON CONFLICT (block_id, step_name) DO NOTHING;

  GET DIAGNOSTICS v_claimed_count = ROW_COUNT;

  IF v_claimed_count = 0 THEN
    -- ARCH §4.5 rollback procedure: a force-trigger decline / no-ack rolls
    -- broadcast back so the chain re-fires it.
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

  -- DEFECT 2. The step is CLAIMED either way -- the chain must still advance to
  -- float_lookup / Allied for this block -- but a locked seat is not claimable, so
  -- there is nothing honest to say to a worker about it.
  SELECT sb.coverage_locked_at IS NOT NULL
    INTO v_locked
  FROM shift_blocks sb
  WHERE sb.block_id = p_block_id;

  IF COALESCE(v_locked, false) THEN
    RETURN jsonb_build_object(
      'claimed',             true,
      'notifications_sent',  0,
      'suppressed',          'coverage_locked'
    );
  END IF;

  -- DEFECT 1. The contiguous run of vacant, uncovered, unlocked, not-yet-announced
  -- blocks at this house that contains this block.
  --
  -- `block_has_escalation_coverage` is the ESCALATION present-set (it counts
  -- `allied`), matching the coverage floor the orchestrator used to decide this
  -- block was actionable at all. Do not swap it for `block_has_present_worker`;
  -- the two are distinct on purpose (ARCH / supabase AGENTS "Coverage lock").
  --
  -- The +/- 24 hour window bounds the scan. A desk that closes overnight has no
  -- blocks to be contiguous with, so a real run terminates long before the bound;
  -- the window exists so a pathological data state cannot make this walk the table.
  WITH candidate AS (
    SELECT sb.block_id, sb.block_start_at
    FROM shift_blocks sb
    WHERE sb.house_id = p_house_id
      AND sb.voided_at IS NULL
      AND sb.coverage_locked_at IS NULL
      AND sb.block_start_at >= p_block_start_at - interval '24 hours'
      AND sb.block_start_at <= p_block_start_at + interval '24 hours'
      AND EXISTS (
        SELECT 1 FROM shift_block_assignments a
        WHERE a.block_id = sb.block_id AND a.status = 'vacant'
      )
      AND NOT block_has_escalation_coverage(sb.block_id)
      -- Announced by an earlier TICK: not part of this run. This block's own row,
      -- just written above with fired_at = p_now, is correctly retained.
      AND NOT EXISTS (
        SELECT 1 FROM block_step_status s
        WHERE s.block_id  = sb.block_id
          AND s.step_name = 'broadcast'
          AND s.status    = 'fired'
          AND s.fired_at  < p_now
      )
  ),
  islanded AS (
    SELECT
      block_id,
      block_start_at,
      block_start_at
        - (row_number() OVER (ORDER BY block_start_at)) * interval '30 minutes' AS island_key
    FROM candidate
  ),
  mine AS (
    SELECT island_key FROM islanded WHERE block_id = p_block_id
  )
  SELECT MIN(i.block_start_at), MAX(i.block_start_at)
    INTO v_run_start, v_run_last
  FROM islanded i
  JOIN mine m ON m.island_key = i.island_key;

  -- Defensive: this block did not qualify as its own candidate (a status changed
  -- under us between the orchestrator's scan and now). Announce it alone rather
  -- than going silent -- the chain has already committed to escalating it.
  IF v_run_start IS NULL THEN
    v_run_start := p_block_start_at;
    v_run_last  := p_block_start_at;
  END IF;

  IF v_run_start <> p_block_start_at THEN
    RETURN jsonb_build_object(
      'claimed',             true,
      'notifications_sent',  0,
      'suppressed',          'merged_into_run_start'
    );
  END IF;

  WITH inserted AS (
    INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
    SELECT
      u.user_id,
      'broadcast'::notification_type,
      p_now,
      jsonb_build_object(
        'kind',           'open_shift',
        'block_id',       p_block_id,
        'house_id',       p_house_id,
        'block_start_at', v_run_start,
        -- Appended 2026-08-06. Every existing consumer reads by key, so a new key
        -- is additive; the body now states a range, so clients that render the
        -- payload rather than the body need the end too.
        'block_end_at',   v_run_last + interval '30 minutes',
        'home_house',     (u.home_house_id = p_house_id),
        'title',          'A shift just opened up',
        -- Phrased identically to notify_shift_opened so the two paths are
        -- indistinguishable to a worker. No em/en dashes (AGENTS conventions).
        'body',
          h.name || ' needs cover on '
          || to_char(v_run_start AT TIME ZONE 'America/New_York', 'Dy, Mon FMDD')
          || ', '
          || to_char(v_run_start AT TIME ZONE 'America/New_York', 'HH24:MI')
          || ' to '
          -- Parenthesised: AT TIME ZONE binds tighter than +, so without these the
          -- interval, not the timestamp, gets the zone conversion.
          || to_char((v_run_last + interval '30 minutes') AT TIME ZONE 'America/New_York', 'HH24:MI')
          || '. Open the app to claim it.'
      )
    FROM users u
    JOIN houses h ON h.id = p_house_id
    WHERE u.is_active = true
      -- Same eligibility matrix as worker_open_shifts.
      AND EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = u.user_id AND ur.role IN ('sw', 'sm', 'hm')
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = u.user_id AND ur.role = 'bm'
      )
      -- Hard invariant #1: Harnwell seats are only ever offered to home-Harnwell
      -- workers, at every write point and every notification point.
      AND (p_house_id <> 'harnwell' OR u.home_house_id = 'harnwell')
      AND wants_open_shift_notification(u.user_id, p_house_id)
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
REVOKE EXECUTE ON FUNCTION process_broadcast_step(uuid, text, timestamptz, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION process_broadcast_step(uuid, text, timestamptz, timestamptz) TO service_role;

COMMENT ON FUNCTION process_broadcast_step(uuid, text, timestamptz, timestamptz) IS
  'BSpec §5.4 / §10.1 -- the escalation chain broadcast step. Claims the chain step '
  'PER BLOCK, but emits at most ONE notification per contiguous run of vacant '
  'unannounced blocks, from the run''s first block, describing the whole run. '
  'Emits nothing for a coverage-locked block, whose seats are not claimable.';

-- rollback: CREATE OR REPLACE process_broadcast_step from 20260728000001.
