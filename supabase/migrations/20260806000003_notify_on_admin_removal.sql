-- Migration: a manager removing a worker from the web opens a seat SILENTLY.
--
-- THE GAP (found 2026-08-06, live on the Harnwell pilot). 20260729000013 wired
-- `notify_shift_opened` into both WORKER-initiated drop paths (`drop_shift` and
-- `permanent_drop_slot`) and explicitly scoped admin removal out. The result, seen
-- for real: an SM removed a worker from Harnwell 11:00-12:00 on the web, and the
-- only thing any worker ever heard was the escalation chain's per-block
-- `broadcast` step firing at T-1min -- two separate pushes, no span, and nothing
-- at all in the hours between the removal and T-3h. The seats were vacated with
-- `vacancy_origin = 'temporary_drop'` but `dropped_by_user_id` / `dropped_at`
-- NULL, which is the fingerprint of this path.
--
-- The `permanent` scope was never affected: it delegates to `permanent_drop_slot`,
-- which 20260729000013 already wired. Only the `this_week` branch is silent, and
-- that is what this migration fixes.
--
-- TWO differences from the worker drop path, both deliberate:
--
--   1. `drop_shift` enforces contiguity (`drop_not_contiguous`); `admin_remove_worker`
--      does NOT -- an operator clicks arbitrary seats on the grid, so the removed set
--      may be several disjoint runs. Emitting one MIN..MAX span would announce hours
--      that were never vacated, so the set is split into contiguous islands and one
--      notification is emitted per island.
--   2. TWO people are excluded, not one. `p_actor_user_id` excludes the OPERATOR
--      (they just did this). The removed WORKER is excluded too, via the new
--      exclusion list: telling someone "a shift just opened up, open the app to
--      claim it" about the shift you took off them thirty seconds ago is the worst
--      possible phrasing of that event. They are not left uninformed by this
--      migration -- they were already uninformed on this branch, which is a separate
--      gap (the `this_week` scope writes no `sw_*` alert the way `permanent` does)
--      and is deliberately NOT fixed here.

-- ---------------------------------------------------------------------------
-- 1. notify_shift_opened gains an explicit exclusion list.
-- ---------------------------------------------------------------------------
-- A NEW 8-argument signature rather than a default on the 7-argument one: a
-- defaulted 8th parameter would make every existing 7-argument call site
-- ambiguous between the two overloads. The 8-argument form takes no default, so
-- arity alone resolves it.
--
-- Body carried over VERBATIM from 20260729000013 (verified against the live
-- catalog definition before editing). The ONLY addition is the exclusion filter.
CREATE OR REPLACE FUNCTION notify_shift_opened(
  p_house_id         text,
  p_block_id         uuid,
  p_start_at         timestamptz,
  p_end_at           timestamptz,
  p_actor_user_id    uuid,
  p_now              timestamptz,
  p_recurring        boolean,
  p_exclude_user_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_house_name text;
  v_count      integer;
  v_title      text;
  v_body       text;
  v_when       text;
BEGIN
  SELECT name INTO v_house_name FROM houses WHERE id = p_house_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- No em/en dashes: this is surfaced copy (AGENTS conventions).
  IF p_recurring THEN
    v_title := 'A weekly shift just opened up';
    v_when  := 'every '
      || trim(to_char(p_start_at AT TIME ZONE 'America/New_York', 'Day'))
      || ', '
      || to_char(p_start_at AT TIME ZONE 'America/New_York', 'HH24:MI')
      || ' to '
      || to_char(p_end_at AT TIME ZONE 'America/New_York', 'HH24:MI')
      || ', for the rest of the semester';
  ELSE
    v_title := 'A shift just opened up';
    v_when  := 'on '
      || to_char(p_start_at AT TIME ZONE 'America/New_York', 'Dy, Mon FMDD')
      || ', '
      || to_char(p_start_at AT TIME ZONE 'America/New_York', 'HH24:MI')
      || ' to '
      || to_char(p_end_at AT TIME ZONE 'America/New_York', 'HH24:MI');
  END IF;

  v_body := v_house_name || ' needs cover ' || v_when || '. Open the app to claim it.';

  WITH inserted AS (
    INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
    SELECT
      u.user_id,
      'shift_opened'::notification_type,
      p_now,
      jsonb_build_object(
        'kind',           'open_shift',
        'block_id',       p_block_id,
        'house_id',       p_house_id,
        'block_start_at', p_start_at,
        'block_end_at',   p_end_at,
        'recurring',      p_recurring,
        'home_house',     (u.home_house_id = p_house_id),
        'title',          v_title,
        'body',           v_body
      )
    FROM users u
    WHERE u.is_active = true
      -- The dropper already knows. Notifying them is the wart the T-3h broadcast
      -- still has (it has no actor to exclude); do not reproduce it here.
      AND (p_actor_user_id IS NULL OR u.user_id <> p_actor_user_id)
      -- NEW (2026-08-06): additional recipients this particular event must not
      -- reach. Currently only the worker an admin just removed.
      AND NOT (u.user_id = ANY (COALESCE(p_exclude_user_ids, ARRAY[]::uuid[])))
      AND EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = u.user_id AND ur.role IN ('sw', 'sm', 'hm')
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = u.user_id AND ur.role = 'bm'
      )
      -- Hard invariant #1, enforced at every notification point.
      AND (p_house_id <> 'harnwell' OR u.home_house_id = 'harnwell')
      -- Own house is MANDATORY and short-circuits the preference lookup. Other
      -- houses fall through to `wants_open_shift_notification`, which for a
      -- non-home house returns `open_shifts_other_houses` (default false).
      AND (
        u.home_house_id = p_house_id
        OR wants_open_shift_notification(u.user_id, p_house_id)
      )
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM inserted;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION notify_shift_opened(text, uuid, timestamptz, timestamptz, uuid, timestamptz, boolean, uuid[])
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION notify_shift_opened(text, uuid, timestamptz, timestamptz, uuid, timestamptz, boolean, uuid[])
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION notify_shift_opened(text, uuid, timestamptz, timestamptz, uuid, timestamptz, boolean, uuid[])
  TO service_role;

-- The 7-argument form is now a thin delegate, so there is exactly ONE copy of the
-- recipient matrix to keep in step with `process_broadcast_step` and
-- `worker_open_shifts`. Its existing call sites (drop_shift, permanent_drop_slot)
-- are untouched and keep their exact behaviour: an empty exclusion list.
CREATE OR REPLACE FUNCTION notify_shift_opened(
  p_house_id      text,
  p_block_id      uuid,
  p_start_at      timestamptz,
  p_end_at        timestamptz,
  p_actor_user_id uuid,
  p_now           timestamptz,
  p_recurring     boolean DEFAULT false
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT notify_shift_opened(
    p_house_id, p_block_id, p_start_at, p_end_at,
    p_actor_user_id, p_now, p_recurring, ARRAY[]::uuid[]
  );
$$;

REVOKE ALL ON FUNCTION notify_shift_opened(text, uuid, timestamptz, timestamptz, uuid, timestamptz, boolean)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION notify_shift_opened(text, uuid, timestamptz, timestamptz, uuid, timestamptz, boolean)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION notify_shift_opened(text, uuid, timestamptz, timestamptz, uuid, timestamptz, boolean)
  TO service_role;

COMMENT ON FUNCTION notify_shift_opened(text, uuid, timestamptz, timestamptz, uuid, timestamptz, boolean, uuid[]) IS
  'BSpec §5.3 / §10.1 -- emit ONE `shift_opened` notification per opened span. '
  'Own house is mandatory; other houses honour `open_shifts_other_houses`. '
  'Excludes the actor plus any explicitly listed user. Mirrors worker_open_shifts '
  'eligibility, including the Harnwell training invariant. Called by drop_shift, '
  'permanent_drop_slot and admin_remove_worker, which are themselves SECURITY '
  'DEFINER, so no client holds EXECUTE.';

-- ---------------------------------------------------------------------------
-- 2. admin_remove_worker fires it on the `this_week` branch.
-- ---------------------------------------------------------------------------
-- Body carried over VERBATIM from the LIVE catalog definition, which is
-- 20260729000001_admin_override_past_edit.sql (the 5-argument form, with the
-- `block_started` guard removed). The ONLY addition is the island walk and the
-- notify calls after the vacate. Nothing in the authorization or validation path
-- moved.
CREATE OR REPLACE FUNCTION public.admin_remove_worker(p_operator_user_id uuid, p_block_ids uuid[], p_user_id uuid, p_scope text, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_block_house_id text;
  v_distinct_houses integer;
  v_has_float boolean;
  v_not_occupied boolean;
  v_day_of_week integer;
  v_block_start_locals text[];
  v_removed_count integer := 0;
  v_island record;
BEGIN
  IF p_block_ids IS NULL OR array_length(p_block_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'empty_block_set';
  END IF;

  IF p_scope NOT IN ('this_week', 'permanent') THEN
    RAISE EXCEPTION 'invalid_scope';
  END IF;

  SELECT COUNT(DISTINCT sb.house_id), MIN(sb.house_id)
    INTO v_distinct_houses, v_block_house_id
  FROM shift_blocks sb
  WHERE sb.block_id = ANY (p_block_ids);

  IF v_distinct_houses IS NULL OR v_distinct_houses = 0 THEN
    RAISE EXCEPTION 'block_not_found';
  END IF;
  IF v_distinct_houses <> 1 THEN
    RAISE EXCEPTION 'cross_house_not_supported';
  END IF;

  IF NOT user_can_build_schedule(p_operator_user_id, v_block_house_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- block_started removed 2026-07-29: a this_week seat of ANY age (past or
  -- future) is now removable by an authorized schedule admin. Only the
  -- operator authz gate above (user_can_build_schedule) still applies.

  -- float_committed: cannot directly override a float-committed seat (S1 OUT).
  SELECT bool_or(sba.status IN ('floated_in', 'floated_out', 'pending_float_in', 'pending_float_out'))
    INTO v_has_float
  FROM shift_block_assignments sba
  WHERE sba.block_id = ANY (p_block_ids)
    AND sba.user_id = p_user_id;
  IF COALESCE(v_has_float, false) THEN
    RAISE EXCEPTION 'float_committed';
  END IF;

  -- not_occupied_by_worker: every clicked block must hold a removable seat for
  -- the named worker (scheduled / claimed).
  SELECT bool_or(NOT EXISTS (
    SELECT 1
    FROM shift_block_assignments sba
    WHERE sba.block_id = clicked.block_id
      AND sba.user_id = p_user_id
      AND sba.status IN ('scheduled', 'claimed')
  ))
    INTO v_not_occupied
  FROM (SELECT DISTINCT sb.block_id FROM shift_blocks sb WHERE sb.block_id = ANY (p_block_ids)) clicked;
  IF COALESCE(v_not_occupied, true) THEN
    RAISE EXCEPTION 'not_occupied_by_worker';
  END IF;

  IF p_scope = 'this_week' THEN
    -- Vacate each clicked seat held by the worker → temporary_drop (mirror
    -- drop_shift). Writes NO block_step_status (D6).
    UPDATE shift_block_assignments sba
    SET status = 'vacant',
        vacancy_origin = 'temporary_drop',
        user_id = NULL,
        is_cross_house_pickup = false,
        source_house_id = NULL,
        parent_float_id = NULL
    WHERE sba.block_id = ANY (p_block_ids)
      AND sba.user_id = p_user_id
      AND sba.status IN ('scheduled', 'claimed');

    GET DIAGNOSTICS v_removed_count = ROW_COUNT;

    -- NEW (2026-08-06): tell everyone who could claim it, right now. One
    -- notification per CONTIGUOUS run of removed blocks, because an operator may
    -- click disjoint seats and a single MIN..MAX span would announce hours that
    -- are still staffed.
    --
    -- `coverage_locked_at` is the one suppression, exactly as in drop_shift: a
    -- block the orchestrator has already locked (BSpec §5.5) is NOT claimable, and
    -- the copy says "Open the app to claim it." Locked blocks are filtered out
    -- before islanding, so they neither trigger nor extend a span.
    --
    -- The `not_occupied_by_worker` guard above already proved every clicked block
    -- held a removable seat for this worker, so the clicked set IS the vacated set.
    IF v_removed_count > 0 THEN
      FOR v_island IN
        WITH vacated AS (
          SELECT DISTINCT sb.block_id, sb.block_start_at
          FROM shift_blocks sb
          WHERE sb.block_id = ANY (p_block_ids)
            AND sb.coverage_locked_at IS NULL
        ),
        islanded AS (
          SELECT
            block_id,
            block_start_at,
            block_start_at
              - (row_number() OVER (ORDER BY block_start_at)) * interval '30 minutes' AS island_key
          FROM vacated
        )
        SELECT
          (array_agg(block_id ORDER BY block_start_at))[1] AS first_block_id,
          MIN(block_start_at)                              AS first_start,
          MAX(block_start_at)                              AS last_start
        FROM islanded
        GROUP BY island_key
        ORDER BY MIN(block_start_at)
      LOOP
        PERFORM notify_shift_opened(
          v_block_house_id,
          v_island.first_block_id,
          v_island.first_start,
          v_island.last_start + interval '30 minutes',
          p_operator_user_id,
          now(),
          false,
          ARRAY[p_user_id]
        );
      END LOOP;
    END IF;
  ELSE
    -- permanent: reuse permanent_drop_slot(operator) — vacates future occurrences
    -- → permanent_drop, SKIPS floated_out/pending_float_out, and writes the
    -- sm_permanent_drop_alert + (operator≠worker) sw_permanent_removal_alert.
    -- permanent_drop_slot already emits its own recurring shift_opened
    -- (20260729000013), so this branch needs nothing here.
    SELECT
      EXTRACT(DOW FROM MIN(sb.block_start_at) AT TIME ZONE 'America/New_York')::integer,
      array_agg(DISTINCT TO_CHAR(sb.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI'))
      INTO v_day_of_week, v_block_start_locals
    FROM shift_blocks sb
    WHERE sb.block_id = ANY (p_block_ids);

    SELECT (permanent_drop_slot(
        p_user_id,
        v_block_house_id,
        v_day_of_week,
        v_block_start_locals,
        p_now,
        p_operator_user_id
      ) ->> 'affected_count')::integer
      INTO v_removed_count;
  END IF;

  RETURN jsonb_build_object(
    'removed_count', COALESCE(v_removed_count, 0),
    'scope', p_scope
  );
END;
$function$;

-- rollback: CREATE OR REPLACE admin_remove_worker from 20260729000001 and
-- notify_shift_opened(7 args) from 20260729000013, then DROP FUNCTION
-- notify_shift_opened(text, uuid, timestamptz, timestamptz, uuid, timestamptz, boolean, uuid[]).
