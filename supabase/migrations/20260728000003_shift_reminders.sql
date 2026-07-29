-- Shift reminders: the notification, its per-worker lead times, and its producer.
--
-- WHY THIS EXISTS (2026-07-28). The Settings screen has always listed "Shift reminders,
-- always on (before each shift)" and the system has never sent one. There was no
-- notification type, no producer, no cron and no storage; `ack_reminder` is the FLOAT
-- acknowledgment reminder, which is a different thing entirely. This builds the channel
-- the app has been claiming to have, and makes its timing the worker's choice.
--
-- PRODUCT DECISION (stakeholder, 2026-07-28). A worker picks any combination of three
-- lead times: 2 hours, 1 hour, 30 minutes before the shift starts. All three, some, or
-- NONE. This makes shift reminders the third configurable channel and supersedes the
-- 2026-07-28 statement that they are mandatory: unlike a swap request or a float, a
-- reminder asks nothing of the worker, so silencing it costs only the person who chose to.
-- The default is 1 hour alone: enough time to get to a desk, quiet enough not to train
-- people to ignore it.
--
-- THE THING TO GET RIGHT: a reminder is per SHIFT, not per block. Every operation works
-- in 30-minute blocks (invariant #5), so a 4-hour shift is EIGHT rows in
-- shift_block_assignments. Reminding per row would push eight notifications per lead time,
-- twenty-four for a worker who ticked all three. The producer below coalesces each
-- worker's contiguous same-house run and reminds once per run.

-- ---------------------------------------------------------------------------
-- 1. The worker's chosen lead times.
-- ---------------------------------------------------------------------------
-- Minutes before the shift starts. An EMPTY array is the "none" case and is a legitimate,
-- fully-supported choice, not a null-ish accident, which is why the column is NOT NULL
-- with an empty-array default rather than nullable.
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS shift_reminder_offsets integer[] NOT NULL DEFAULT ARRAY[60];

-- Only the three offered lead times, and no duplicates. The UI offers exactly these, so a
-- value outside the set means a client is constructing requests by hand.
--
-- The de-duplication test needs `unnest`, and a CHECK constraint may not contain a
-- subquery, so it lives in an IMMUTABLE helper the constraint calls instead.
CREATE OR REPLACE FUNCTION is_valid_shift_reminder_offsets(p_offsets integer[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_offsets <@ ARRAY[120, 60, 30]
     AND COALESCE(array_length(p_offsets, 1), 0)
         = (SELECT count(DISTINCT o)::integer FROM unnest(p_offsets) o);
$$;

COMMENT ON FUNCTION is_valid_shift_reminder_offsets(integer[]) IS
  'Subset of the three offered lead times, no duplicates. A separate function because a '
  'CHECK constraint cannot contain the subquery the de-duplication test needs.';

ALTER TABLE notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_shift_reminder_offsets_valid;
ALTER TABLE notification_preferences
  ADD CONSTRAINT notification_preferences_shift_reminder_offsets_valid
  CHECK (is_valid_shift_reminder_offsets(shift_reminder_offsets));

COMMENT ON COLUMN notification_preferences.shift_reminder_offsets IS
  'Minutes before a shift starts at which to remind this worker. Any subset of '
  '{120, 60, 30}; empty means no shift reminders at all (a supported choice). Default '
  '{60}. A worker with no row behaves as if they held the defaults, so read this through '
  'worker_shift_reminder_offsets(), never raw.';

-- The defaults live in ONE place for the same reason wants_open_shift_notification exists:
-- "never opened Settings" and "explicitly kept the defaults" must be indistinguishable.
CREATE OR REPLACE FUNCTION worker_shift_reminder_offsets(p_user_id uuid)
RETURNS integer[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT np.shift_reminder_offsets
     FROM notification_preferences np
     WHERE np.user_id = p_user_id),
    ARRAY[60]
  );
$$;

REVOKE ALL ON FUNCTION worker_shift_reminder_offsets(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION worker_shift_reminder_offsets(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Idempotency bookkeeping.
-- ---------------------------------------------------------------------------
-- Mirrors preference_reminder_sends: the producer runs on a schedule and would otherwise
-- re-enqueue the same reminder on every pass. The identity is (worker, the run's FIRST
-- seat, lead time) -- the first seat is what makes this per-shift rather than per-block.
CREATE TABLE IF NOT EXISTS shift_reminder_sends (
  user_id             uuid        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  first_assignment_id uuid        NOT NULL,
  offset_minutes      integer     NOT NULL CHECK (offset_minutes IN (120, 60, 30)),
  notification_id     uuid        NOT NULL DEFAULT gen_random_uuid(),
  shift_start_at      timestamptz NOT NULL,
  enqueued_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, first_assignment_id, offset_minutes)
);

ALTER TABLE shift_reminder_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service-role bypass" ON shift_reminder_sends;
CREATE POLICY "service-role bypass" ON shift_reminder_sends
  TO service_role USING (true) WITH CHECK (true);

-- No worker-facing policy on purpose: this is delivery bookkeeping, not something a
-- worker reads. Their reminders reach them as notifications like anything else.
GRANT ALL ON shift_reminder_sends TO service_role;

CREATE INDEX IF NOT EXISTS shift_reminder_sends_shift_start_idx
  ON shift_reminder_sends (shift_start_at);

COMMENT ON TABLE shift_reminder_sends IS
  'One row per (worker, shift, lead time) reminder already enqueued. Keyed on the '
  'shift''s FIRST seat, which is what keeps a reminder per SHIFT rather than per '
  '30-minute block (invariant #5). Purged with the other operational records.';

-- ---------------------------------------------------------------------------
-- 3. Contiguous shift runs.
-- ---------------------------------------------------------------------------
-- The read models coalesce per-block rows for DISPLAY; nothing did it server-side. This
-- resolves each worker's runs the same way: same worker, same house, blocks adjacent on
-- the instant timeline (duration arithmetic, never wall clock, so a run spanning a DST
-- transition stays one run -- invariant #6).
CREATE OR REPLACE FUNCTION worker_shift_runs(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS TABLE (
  user_id             uuid,
  house_id            text,
  house_name          text,
  first_assignment_id uuid,
  run_start_at        timestamptz,
  run_end_at          timestamptz,
  block_count         integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH seats AS (
    SELECT
      sba.user_id,
      sb.house_id,
      sba.assignment_id,
      sb.block_start_at,
      -- A new run starts wherever the previous block for this (worker, house) does not
      -- end exactly where this one begins.
      CASE
        WHEN lag(sb.block_start_at) OVER w IS NULL
          OR lag(sb.block_start_at) OVER w + interval '30 minutes' <> sb.block_start_at
        THEN 1 ELSE 0
      END AS is_run_start
    FROM shift_block_assignments sba
    JOIN shift_blocks sb USING (block_id)
    WHERE sba.user_id IS NOT NULL
      -- Statuses where the worker is actually expected at a desk. A vacated, cancelled or
      -- floated-out seat is not this worker's shift and must never be reminded about.
      AND sba.status IN ('scheduled', 'claimed', 'floated_in')
      AND sb.voided_at IS NULL
      AND sb.block_start_at >= p_from
      AND sb.block_start_at < p_to
    WINDOW w AS (PARTITION BY sba.user_id, sb.house_id ORDER BY sb.block_start_at)
  ),
  grouped AS (
    SELECT
      seats.*,
      sum(is_run_start) OVER (
        PARTITION BY user_id, house_id ORDER BY block_start_at
        ROWS UNBOUNDED PRECEDING
      ) AS run_id
    FROM seats
  )
  SELECT
    g.user_id,
    g.house_id,
    h.name,
    (array_agg(g.assignment_id ORDER BY g.block_start_at))[1],
    min(g.block_start_at),
    max(g.block_start_at) + interval '30 minutes',
    count(*)::integer
  FROM grouped g
  JOIN houses h ON h.id = g.house_id
  GROUP BY g.user_id, g.house_id, h.name, g.run_id;
$$;

REVOKE ALL ON FUNCTION worker_shift_runs(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION worker_shift_runs(timestamptz, timestamptz) TO service_role;

COMMENT ON FUNCTION worker_shift_runs(timestamptz, timestamptz) IS
  'Each worker''s contiguous same-house shifts in a window, coalesced from the per-block '
  'rows. Contiguity is instant arithmetic, so a run across a DST transition stays one run.';

-- ---------------------------------------------------------------------------
-- 4. The producer.
-- ---------------------------------------------------------------------------
-- Enqueues, it does not send. Each reminder is inserted with `scheduled_for = run start
-- minus the lead time`, and the existing deliver_pending_notifications cron fires it when
-- that moment arrives. So this can run on a slow schedule (hourly) and still deliver a
-- 30-minute reminder on time, and a worker who changes their lead times keeps the ones
-- already queued for shifts they still hold.
--
-- The lookahead is deliberately generous: enqueueing early costs one row, while
-- enqueueing late means the reminder never fires at all.
CREATE OR REPLACE FUNCTION enqueue_shift_reminders(
  p_now timestamptz DEFAULT NULL,
  p_lookahead interval DEFAULT interval '8 days'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now      timestamptz := COALESCE(p_now, app_now());
  v_inserted integer;
BEGIN
  WITH runs AS (
    SELECT * FROM worker_shift_runs(v_now, v_now + p_lookahead)
  ),
  wanted AS (
    SELECT
      r.*,
      o.offset_minutes,
      r.run_start_at - make_interval(mins => o.offset_minutes) AS fire_at
    FROM runs r
    CROSS JOIN LATERAL unnest(worker_shift_reminder_offsets(r.user_id)) AS o(offset_minutes)
    -- Skip a lead time that has already passed for this shift. Enqueueing it would fire
    -- an immediate "your shift starts in 2 hours" for a shift starting in 20 minutes.
    WHERE r.run_start_at - make_interval(mins => o.offset_minutes) > v_now
  ),
  recorded AS (
    INSERT INTO shift_reminder_sends (user_id, first_assignment_id, offset_minutes, shift_start_at)
    SELECT w.user_id, w.first_assignment_id, w.offset_minutes, w.run_start_at
    FROM wanted w
    ON CONFLICT (user_id, first_assignment_id, offset_minutes) DO NOTHING
    RETURNING user_id, first_assignment_id, offset_minutes, notification_id
  ),
  queued AS (
    INSERT INTO notifications (notification_id, recipient_user_id, type, scheduled_for, payload)
    SELECT
      rec.notification_id,
      w.user_id,
      'shift_reminder'::notification_type,
      w.fire_at,
      jsonb_build_object(
        'kind', 'shift_reminder',
        'assignment_id', w.first_assignment_id,
        'house_id', w.house_id,
        'shift_start_at', w.run_start_at,
        'shift_end_at', w.run_end_at,
        'offset_minutes', w.offset_minutes,
        'title',
          CASE
            WHEN w.offset_minutes >= 60
              THEN 'Your shift starts in ' || (w.offset_minutes / 60) || ' hour'
                   || CASE WHEN w.offset_minutes >= 120 THEN 's' ELSE '' END
            ELSE 'Your shift starts in ' || w.offset_minutes || ' minutes'
          END,
        'body',
          w.house_name || ', '
          || to_char(w.run_start_at AT TIME ZONE 'America/New_York', 'HH24:MI')
          || ' to '
          || to_char(w.run_end_at AT TIME ZONE 'America/New_York', 'HH24:MI')
          || '.'
      )
    FROM recorded rec
    JOIN wanted w
      ON w.user_id = rec.user_id
     AND w.first_assignment_id = rec.first_assignment_id
     AND w.offset_minutes = rec.offset_minutes
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_inserted FROM queued;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION enqueue_shift_reminders(timestamptz, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION enqueue_shift_reminders(timestamptz, interval) TO service_role;

COMMENT ON FUNCTION enqueue_shift_reminders(timestamptz, interval) IS
  'Queue one shift reminder per (contiguous shift, chosen lead time), scheduled_for the '
  'moment it should fire. Idempotent via shift_reminder_sends. Enqueue-only: '
  'deliver_pending_notifications sends it, and re-checks that the worker still holds the '
  'shift at that moment.';

-- ---------------------------------------------------------------------------
-- 5. Do not remind someone about a shift they no longer have.
-- ---------------------------------------------------------------------------
-- A reminder is queued up to eight days ahead; in between, the worker may drop the shift,
-- swap it away, or have it cancelled by a config change. The queue is re-checked at send
-- time for exactly the same reason ack reminders are (BSpec §7.1): the queued row is a
-- statement about the past, and only a live check reflects the present.
--
-- Everything else about this function is the 20260726000004 body verbatim.
CREATE OR REPLACE FUNCTION pending_notification_deliveries(p_now timestamptz)
RETURNS SETOF notifications
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT notifications.*
  FROM notifications
  WHERE notifications.delivered_at IS NULL
    AND notifications.suppressed_at IS NULL
    AND notifications.dead_lettered_at IS NULL
    AND (notifications.scheduled_for IS NULL OR notifications.scheduled_for <= p_now)
    AND (
      notifications.last_attempt_at IS NULL
      OR notifications.last_attempt_at
         + notification_retry_backoff(notifications.delivery_attempts) <= p_now
    )
    -- §7.1: an ack reminder whose float is no longer pending must not be sent.
    AND NOT (
      notifications.type = 'ack_reminder'::notification_type
      AND notifications.payload ->> 'kind' = 'float_ack_reminder'
      AND NOT EXISTS (
        SELECT 1
        FROM float_assignments
        WHERE float_assignments.float_id::text = notifications.payload ->> 'float_id'
          AND float_assignments.status = 'pending'
          AND float_assignments.acknowledged_at IS NULL
          AND float_assignments.declined_at IS NULL
      )
    )
    -- A shift reminder whose shift the worker no longer holds must not be sent.
    AND NOT (
      notifications.type = 'shift_reminder'::notification_type
      AND NOT EXISTS (
        SELECT 1
        FROM shift_block_assignments sba
        WHERE sba.assignment_id::text = notifications.payload ->> 'assignment_id'
          AND sba.user_id = notifications.recipient_user_id
          AND sba.status IN ('scheduled', 'claimed', 'floated_in')
      )
    )
  ORDER BY notifications.scheduled_for NULLS FIRST, notifications.notification_id;
$$;

REVOKE ALL ON FUNCTION pending_notification_deliveries(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pending_notification_deliveries(timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. The worker-facing write, widened.
-- ---------------------------------------------------------------------------
-- Replaces the 2-argument form from 20260728000001. NULL offsets means "leave them as
-- they are", which lets the open-shift toggles be saved without the caller having to
-- resend the reminder set (and vice versa). An EMPTY array is a real value: no reminders.
DROP FUNCTION IF EXISTS set_notification_preferences(boolean, boolean);

CREATE OR REPLACE FUNCTION set_notification_preferences(
  p_open_shifts_home_house boolean,
  p_open_shifts_other_houses boolean,
  p_shift_reminder_offsets integer[] DEFAULT NULL
)
RETURNS notification_preferences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     notification_preferences;
  v_offsets integer[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  -- Normalise before the CHECK sees it: sort and de-duplicate, so a client sending
  -- {60,60,30} stores {30,60} instead of failing. Reject anything outside the offered set
  -- loudly rather than silently dropping it, since a value we do not offer means the
  -- caller believes in a lead time that does not exist.
  IF p_shift_reminder_offsets IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM unnest(p_shift_reminder_offsets) o WHERE o NOT IN (120, 60, 30)) THEN
      RAISE EXCEPTION 'unsupported_shift_reminder_offset' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT o ORDER BY o), ARRAY[]::integer[])
      INTO v_offsets
      FROM unnest(p_shift_reminder_offsets) o;
  END IF;

  INSERT INTO notification_preferences AS np (
    user_id, open_shifts_home_house, open_shifts_other_houses, shift_reminder_offsets, updated_at
  )
  VALUES (
    auth.uid(),
    COALESCE(p_open_shifts_home_house, true),
    COALESCE(p_open_shifts_other_houses, false),
    COALESCE(v_offsets, ARRAY[60]),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET open_shifts_home_house   = EXCLUDED.open_shifts_home_house,
      open_shifts_other_houses = EXCLUDED.open_shifts_other_houses,
      -- NULL in means "unchanged", which is why this reads from v_offsets, not EXCLUDED.
      shift_reminder_offsets   = COALESCE(v_offsets, np.shift_reminder_offsets),
      updated_at               = EXCLUDED.updated_at
  RETURNING np.* INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION set_notification_preferences(boolean, boolean, integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_notification_preferences(boolean, boolean, integer[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Schedule it, and make it verifiable.
-- ---------------------------------------------------------------------------
-- Hourly. The producer only queues; the once-a-minute delivery cron does the timing, so
-- an hourly enqueue still fires a 30-minute reminder to the minute.
DO $$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE NOTICE 'pg_cron absent: shift-reminders not scheduled. Run verify_scheduled_jobs().';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'shift-reminders') THEN
    PERFORM cron.unschedule('shift-reminders');
  END IF;

  PERFORM cron.schedule(
    'shift-reminders',
    '5 * * * *',
    $sql$SELECT enqueue_shift_reminders()$sql$
  );
END;
$$;

-- Fold the new job into the health check from 20260727000001, so a missing shift-reminder
-- cron is reported the same way every other missing job is instead of being invisible.
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
        INTO v_actual, v_active USING v_name;

      IF v_actual IS NULL THEN
        RETURN QUERY SELECT 'job: ' || v_name, 'MISSING', 'not registered';
      ELSIF v_actual <> v_schedule THEN
        RETURN QUERY SELECT 'job: ' || v_name, 'DRIFT',
                            'schedule is ' || v_actual || ', expected ' || v_schedule;
      ELSIF NOT v_active THEN
        RETURN QUERY SELECT 'job: ' || v_name, 'INACTIVE', 'registered but disabled';
      ELSE
        RETURN QUERY SELECT 'job: ' || v_name, 'ok', v_actual;
      END IF;
    END LOOP;
  END IF;

  FOR v_name IN SELECT unnest(ARRAY['app.supabase_url', 'app.service_role_key']) LOOP
    IF COALESCE(current_setting(v_name, true), '') = '' THEN
      RETURN QUERY SELECT 'setting: ' || v_name, 'MISSING',
                          'unset -- cron jobs that call an Edge Function will fail';
    ELSE
      RETURN QUERY SELECT 'setting: ' || v_name, 'ok', 'set';
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION verify_scheduled_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_scheduled_jobs() TO service_role;

-- rollback:
--   SELECT cron.unschedule('shift-reminders');
--   DROP FUNCTION IF EXISTS enqueue_shift_reminders(timestamptz, interval);
--   DROP FUNCTION IF EXISTS worker_shift_runs(timestamptz, timestamptz);
--   DROP FUNCTION IF EXISTS worker_shift_reminder_offsets(uuid);
--   DROP TABLE IF EXISTS shift_reminder_sends;
--   ALTER TABLE notification_preferences DROP COLUMN shift_reminder_offsets;
--   restore the 20260726000004 pending_notification_deliveries and the
--   20260728000001 set_notification_preferences(boolean, boolean).
