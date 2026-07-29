-- Swap live-updates, mandatory swap notifications, and the two configurable
-- notification channels.
--
-- Four problems this closes, all reported from the pilot build (2026-07-28):
--
-- 1. A swap request never reached the counterparty's Swaps tab on its own.
--    `swap_requests` was NOT in the `supabase_realtime` publication, so the only
--    live channel the worker app holds (`shift_block_assignments`) delivered
--    nothing for a swap, and the client's swap producers only re-read on the
--    viewing worker's OWN action. An incoming request became visible when some
--    unrelated seat change happened to force a re-read, which is the "much
--    later" the report describes.
--
-- 2. Declining (or accepting, cancelling, expiring) a swap never reached the
--    OTHER party for the same reason: the status flip is an UPDATE on
--    `swap_requests`, which nothing was listening to.
--
-- 3. A swap request produced NO notification at all. The only `swap_request`
--    notification in the system is the manager-facing corrected-float alert
--    inside `accept_swap`; the two workers involved were never told anything.
--    BSpec §10.1 makes a swap request mandatory-notify: a request you are not
--    told about is a request you cannot answer before it expires.
--
-- 4. The live calendars (mobile House grid, web house calendar) rendered a seat
--    tied up in a pending swap exactly like any other seat, so a manager looking
--    at coverage could not see that two shifts are mid-exchange, who proposed it,
--    or who still owes an answer.
--
-- Notification policy (BSpec §10.1, amended 2026-07-28). Mandatory channels are
-- not user-configurable, because each one is either time-critical or requires an
-- answer: float assignments, swap requests and their resolutions, break sign-up
-- opening, preference-window events, shift reminders, schedule published.
-- Exactly TWO channels are configurable, and they are both "a shift opened up":
-- openings at the worker's OWN house (on by default) and openings at OTHER
-- houses (off by default, opt-in). `notification_preferences` stores those two
-- and nothing else, so adding a mandatory notification can never accidentally
-- become opt-out-able.

-- ---------------------------------------------------------------------------
-- 1. Realtime on swap_requests.
-- ---------------------------------------------------------------------------
-- REPLICA IDENTITY FULL is required, not optional: Realtime RLS-checks each
-- change against the row it ships, and on an UPDATE (pending -> rejected) the
-- default identity carries only the PK, so neither party's own-row policy would
-- match and the decline would be dropped on the floor. `notifications` and
-- `shift_block_assignments` are already FULL for the same reason.
ALTER TABLE swap_requests REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'swap_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE swap_requests;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Human-readable span for a swap side.
-- ---------------------------------------------------------------------------
-- Blocks are 30 minutes (invariant #5), so a side's end is max(start) + 30 min.
-- NY-local by construction (invariant #6) and formatted for notification copy.
-- No em/en dashes: this string is surfaced text.
CREATE OR REPLACE FUNCTION format_swap_span(p_assignment_ids uuid[])
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN min(sb.block_start_at) IS NULL THEN NULL
    ELSE to_char(min(sb.block_start_at) AT TIME ZONE 'America/New_York', 'Dy, Mon FMDD, HH24:MI')
         || ' to '
         || to_char(
              (max(sb.block_start_at) + interval '30 minutes') AT TIME ZONE 'America/New_York',
              'HH24:MI'
            )
  END
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sba.assignment_id = ANY (COALESCE(p_assignment_ids, ARRAY[]::uuid[]));
$$;

REVOKE ALL ON FUNCTION format_swap_span(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION format_swap_span(uuid[]) TO service_role;

COMMENT ON FUNCTION format_swap_span(uuid[]) IS
  'NY-local "Sat, Jun 20, 14:00 to 18:00" label for one side of a swap, for '
  'notification copy. NULL when the side is empty (a one-way hand-off).';

-- ---------------------------------------------------------------------------
-- 3. Mandatory swap notifications, as a trigger.
-- ---------------------------------------------------------------------------
-- A TRIGGER, not per-Edge-Function inserts, and deliberately so: the four write
-- paths that move a swap through its lifecycle are `create-swap`, `accept-swap`
-- (via the accept_swap / apply_permanent_swap RPCs), `reject-swap`, `void-swap`,
-- plus the expiry cron and `void_pending_swaps_for_vacated_seat` (a drop that
-- frees a seat under a pending swap). Six callers, one rule. The DB trigger is
-- authoritative here in the same way the broadcast_subscribed guard is.
--
-- The actor is auth.uid() when a party acted through their own client; it is
-- NULL under the expiry cron and under a service-role cascade, which is exactly
-- the distinction the 'voided' branch needs (a party cancelled vs the system
-- withdrew it because the underlying seat went away).
CREATE OR REPLACE FUNCTION notify_swap_request_parties()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_initiator_name    text;
  v_counterparty_name text;
  v_actor             uuid := auth.uid();
  v_give              text;
  v_get               text;
  v_now               timestamptz := now();
  v_handoff           boolean;
  v_kind_word         text;
BEGIN
  SELECT name INTO v_initiator_name FROM users WHERE user_id = NEW.initiator_user_id;
  SELECT name INTO v_counterparty_name FROM users WHERE user_id = NEW.counterparty_user_id;
  v_initiator_name := COALESCE(v_initiator_name, 'A housemate');
  v_counterparty_name := COALESCE(v_counterparty_name, 'A housemate');

  v_handoff := NEW.swap_type::text = 'handoff';
  v_kind_word := CASE WHEN v_handoff THEN 'hand-off' ELSE 'swap' END;

  -- "give" is what the INITIATOR offers, "get" is what they asked for.
  v_give := format_swap_span(NEW.initiator_assignment_ids);
  v_get := format_swap_span(NEW.counterparty_assignment_ids);

  -- --- A new request: tell the counterparty. Mandatory, never configurable. ---
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
      VALUES (
        NEW.counterparty_user_id,
        'swap_request'::notification_type,
        v_now,
        jsonb_build_object(
          'kind', 'swap_requested',
          'swap_id', NEW.swap_id,
          'swap_type', NEW.swap_type::text,
          'initiator_user_id', NEW.initiator_user_id,
          'counterparty_user_id', NEW.counterparty_user_id,
          'title', v_initiator_name || ' sent you a ' || v_kind_word || ' request',
          'body',
            CASE
              -- They want to take hours off you and give nothing back.
              WHEN v_give IS NULL AND v_get IS NOT NULL THEN
                v_initiator_name || ' wants to take your shift on ' || v_get || '.'
              -- They want to give you hours and take nothing back.
              WHEN v_get IS NULL AND v_give IS NOT NULL THEN
                v_initiator_name || ' wants to give you their shift on ' || v_give || '.'
              WHEN v_give IS NOT NULL AND v_get IS NOT NULL THEN
                v_initiator_name || ' wants your ' || v_get || ' shift and offers ' || v_give || '.'
              ELSE
                v_initiator_name || ' sent you a ' || v_kind_word || ' request.'
            END
            || ' Respond by '
            || to_char(NEW.expires_at AT TIME ZONE 'America/New_York', 'Dy, Mon FMDD, HH24:MI')
            || '.'
        )
      );
    END IF;
    RETURN NEW;
  END IF;

  -- --- A resolution: tell whoever did NOT cause it. ---
  IF OLD.status = 'pending' AND NEW.status <> OLD.status THEN
    IF NEW.status = 'accepted' THEN
      INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
      VALUES (
        NEW.initiator_user_id,
        'swap_request'::notification_type,
        v_now,
        jsonb_build_object(
          'kind', 'swap_accepted',
          'swap_id', NEW.swap_id,
          'swap_type', NEW.swap_type::text,
          'title', v_counterparty_name || ' accepted your ' || v_kind_word,
          'body',
            'Your ' || v_kind_word || ' with ' || v_counterparty_name
            || ' is done. Your calendar has been updated.'
        )
      );

    ELSIF NEW.status = 'rejected' THEN
      INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
      VALUES (
        NEW.initiator_user_id,
        'swap_request'::notification_type,
        v_now,
        jsonb_build_object(
          'kind', 'swap_declined',
          'swap_id', NEW.swap_id,
          'swap_type', NEW.swap_type::text,
          'title', v_counterparty_name || ' declined your ' || v_kind_word,
          'body',
            COALESCE(
              'Your ' || v_give || ' shift is yours again.',
              'Your ' || v_kind_word || ' request was declined.'
            )
            || ' You can propose another one.'
        )
      );

    ELSIF NEW.status = 'expired' THEN
      -- Nobody acted, so both parties need to know it lapsed.
      INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
      SELECT
        r.recipient,
        'swap_request'::notification_type,
        v_now,
        jsonb_build_object(
          'kind', 'swap_expired',
          'swap_id', NEW.swap_id,
          'swap_type', NEW.swap_type::text,
          'title', 'Your ' || v_kind_word || ' request expired',
          'body',
            'The ' || v_kind_word || ' between ' || v_initiator_name || ' and '
            || v_counterparty_name || ' was not answered in time, so nothing changed.'
        )
      FROM (VALUES (NEW.initiator_user_id), (NEW.counterparty_user_id)) AS r(recipient);

    ELSIF NEW.status = 'voided' THEN
      -- Either party may void. Tell the one who did not; when the system voided
      -- it (drop cascade, expiry sweep, admin action) tell both.
      INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
      SELECT
        r.recipient,
        'swap_request'::notification_type,
        v_now,
        jsonb_build_object(
          'kind', 'swap_cancelled',
          'swap_id', NEW.swap_id,
          'swap_type', NEW.swap_type::text,
          'title', 'A ' || v_kind_word || ' request was cancelled',
          'body',
            CASE
              WHEN v_actor = NEW.initiator_user_id THEN
                v_initiator_name || ' cancelled the ' || v_kind_word || ' request.'
              WHEN v_actor = NEW.counterparty_user_id THEN
                v_counterparty_name || ' cancelled the ' || v_kind_word || ' request.'
              ELSE
                'The ' || v_kind_word || ' request is no longer valid, so nothing changed.'
            END
        )
      FROM (VALUES (NEW.initiator_user_id), (NEW.counterparty_user_id)) AS r(recipient)
      WHERE v_actor IS NULL OR r.recipient <> v_actor;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS swap_requests_notify_parties ON swap_requests;
CREATE TRIGGER swap_requests_notify_parties
AFTER INSERT OR UPDATE OF status ON swap_requests
FOR EACH ROW
EXECUTE FUNCTION notify_swap_request_parties();

COMMENT ON FUNCTION notify_swap_request_parties() IS
  'BSpec §10.1 mandatory swap notifications. Fires for every lifecycle change on '
  'swap_requests regardless of which Edge Function, RPC or cron caused it, so no '
  'write path can forget to notify. Never consults notification_preferences: a '
  'swap request requires an answer, so it is not an opt-out channel.';

-- ---------------------------------------------------------------------------
-- 4. notification_preferences: the two configurable channels.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id                  uuid PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  -- "A shift opened up at my house." ON by default: this is the worker's own
  -- desk, and it is the notification the coverage chain depends on being seen.
  open_shifts_home_house   boolean     NOT NULL DEFAULT true,
  -- "A shift opened up somewhere else I can pick up." OFF by default: a worker
  -- opts in to being told about other houses, they do not opt out of it.
  open_shifts_other_houses boolean     NOT NULL DEFAULT false,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service-role bypass" ON notification_preferences;
CREATE POLICY "service-role bypass" ON notification_preferences
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "users can select own notification preferences" ON notification_preferences;
CREATE POLICY "users can select own notification preferences" ON notification_preferences
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users can insert own notification preferences" ON notification_preferences;
CREATE POLICY "users can insert own notification preferences" ON notification_preferences
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "users can update own notification preferences" ON notification_preferences;
CREATE POLICY "users can update own notification preferences" ON notification_preferences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON notification_preferences TO authenticated;
GRANT ALL ON notification_preferences TO service_role;

COMMENT ON TABLE notification_preferences IS
  'BSpec §10.1 / §14 -- the ONLY user-configurable notification channels, both of '
  'them "a shift opened up". Every other notification (float, swap request and '
  'its resolution, break sign-up opening, preference window, shift reminder, '
  'schedule published) is mandatory and has no row here on purpose.';

-- A worker with no row wants the defaults. Read this, never the raw table, so
-- "never opened Settings" and "explicitly kept the defaults" behave identically.
CREATE OR REPLACE FUNCTION wants_open_shift_notification(
  p_user_id uuid,
  p_house_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN u.home_house_id = p_house_id
      THEN COALESCE(np.open_shifts_home_house, true)
    ELSE COALESCE(np.open_shifts_other_houses, false)
  END
  FROM users u
  LEFT JOIN notification_preferences np ON np.user_id = u.user_id
  WHERE u.user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION wants_open_shift_notification(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wants_open_shift_notification(uuid, text) TO service_role;

COMMENT ON FUNCTION wants_open_shift_notification(uuid, text) IS
  'Does this worker want to hear that a seat opened at this house? Defaults '
  'apply when they have no notification_preferences row (home house yes, other '
  'houses no). SECURITY DEFINER so the orchestrator can ask on any worker.';

-- The worker-facing upsert. There is no authenticated UPDATE policy on `users`,
-- and the same reasoning applies here: keep one blessed write path so the
-- defaults and the row shape stay in one place.
CREATE OR REPLACE FUNCTION set_notification_preferences(
  p_open_shifts_home_house boolean,
  p_open_shifts_other_houses boolean
)
RETURNS notification_preferences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row notification_preferences;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  INSERT INTO notification_preferences AS np (
    user_id, open_shifts_home_house, open_shifts_other_houses, updated_at
  )
  VALUES (
    auth.uid(),
    COALESCE(p_open_shifts_home_house, true),
    COALESCE(p_open_shifts_other_houses, false),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET open_shifts_home_house   = EXCLUDED.open_shifts_home_house,
      open_shifts_other_houses = EXCLUDED.open_shifts_other_houses,
      updated_at               = EXCLUDED.updated_at
  RETURNING np.* INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION set_notification_preferences(boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_notification_preferences(boolean, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION set_notification_preferences(boolean, boolean) IS
  'Worker-facing upsert of the two configurable notification channels. Writes '
  'auth.uid()''s own row only; the parameters carry no user_id on purpose.';

-- ---------------------------------------------------------------------------
-- 5. The open-shift broadcast honours the preference, and reaches other houses.
-- ---------------------------------------------------------------------------
-- Previously this notified home-house workers with `users.broadcast_subscribed`,
-- a flag that defaults to FALSE and is presented in Settings as "General updates
-- / house-wide broadcasts". So the shift-opened notification, which every worker
-- should get by default, was in practice off for everyone and shared a switch
-- with an unrelated channel.
--
-- Now: home-house workers get it unless they turned it off, and workers at OTHER
-- houses get it if they opted in. `broadcast_subscribed` keeps its own, separate
-- meaning (house-wide announcements) and is no longer consulted here.
--
-- The recipient set mirrors `worker_open_shifts`' eligibility exactly, because a
-- notification about a seat the worker cannot claim is worse than no
-- notification: active, holds sw/sm/hm, is not a bm, and the Harnwell training
-- invariant (#1) -- only home-Harnwell workers ever hear about a Harnwell seat.
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
        'block_start_at', p_block_start_at,
        'home_house',     (u.home_house_id = p_house_id),
        'title',          'A shift just opened up',
        'body',
          h.name || ' needs cover on '
          || to_char(p_block_start_at AT TIME ZONE 'America/New_York', 'Dy, Mon FMDD, HH24:MI')
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

REVOKE ALL ON FUNCTION process_broadcast_step(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION process_broadcast_step(uuid, text, timestamptz, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Pending swaps on the live calendars.
-- ---------------------------------------------------------------------------
-- One row per SEAT that is currently tied up in a pending swap, carrying both
-- parties and both sides' spans, so a grid can label the seat with who proposed
-- the exchange and who still owes an answer. Both sides of a swap appear,
-- because both seats resolve through `unnest`.
--
-- Owner-rights on purpose (mirrors house_schedule_grid_any): the grid already
-- shows every occupant's name to any authenticated worker, and a swap mark
-- names the same two people. It exposes no assignment the caller could not
-- already see on the grid.
CREATE OR REPLACE VIEW pending_swap_seat_marks AS
SELECT
  seat.assignment_id::text  AS assignment_id,
  sr.swap_id,
  sr.swap_type::text        AS swap_type,
  sr.status::text           AS status,
  sr.created_at,
  sr.expires_at,
  sr.initiator_user_id,
  ini.name                  AS initiator_name,
  sr.counterparty_user_id,
  cpy.name                  AS counterparty_name,
  seat.side,
  -- Who still owes an answer. Always the counterparty while pending, which is
  -- the whole point of showing this on a coverage grid.
  sr.counterparty_user_id   AS awaiting_user_id,
  cpy.name                  AS awaiting_name,
  format_swap_span(sr.initiator_assignment_ids)    AS initiator_span,
  format_swap_span(sr.counterparty_assignment_ids) AS counterparty_span
FROM swap_requests sr
JOIN LATERAL (
  SELECT unnest(sr.initiator_assignment_ids) AS assignment_id, 'initiator'::text AS side
  UNION ALL
  SELECT unnest(COALESCE(sr.counterparty_assignment_ids, ARRAY[]::uuid[])), 'counterparty'::text
) seat ON true
LEFT JOIN users ini ON ini.user_id = sr.initiator_user_id
LEFT JOIN users cpy ON cpy.user_id = sr.counterparty_user_id
WHERE sr.status = 'pending'
  AND sr.expires_at > now();

REVOKE ALL ON pending_swap_seat_marks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON pending_swap_seat_marks TO authenticated, service_role;

COMMENT ON VIEW pending_swap_seat_marks IS
  'BSpec §11.4 -- one row per seat currently held in a pending swap, for the live '
  'calendars on web and mobile. Carries both parties, both spans, and which side '
  'this seat is, so BOTH shifts in an exchange can be labelled with who proposed '
  'it and who still owes an answer.';

-- rollback:
--   DROP VIEW IF EXISTS pending_swap_seat_marks;
--   DROP FUNCTION IF EXISTS set_notification_preferences(boolean, boolean);
--   DROP FUNCTION IF EXISTS wants_open_shift_notification(uuid, text);
--   DROP TABLE IF EXISTS notification_preferences;
--   DROP TRIGGER IF EXISTS swap_requests_notify_parties ON swap_requests;
--   DROP FUNCTION IF EXISTS notify_swap_request_parties();
--   DROP FUNCTION IF EXISTS format_swap_span(uuid[]);
--   ALTER PUBLICATION supabase_realtime DROP TABLE swap_requests;
--   restore the 20260528000006 process_broadcast_step body.
