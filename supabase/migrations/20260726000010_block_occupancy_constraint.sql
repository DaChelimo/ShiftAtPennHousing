-- Migration: a worker may hold at most ONE seat of a 30-minute block, enforced by the
-- DATABASE (concurrency audit 2026-07-26, finding F7).
--
-- WHY THIS EXISTS. Hard invariant #5 (block atomicity, AGENTS.md) says a seat in a block
-- is held by at most one worker and a worker occupies at most one seat of a block. Until
-- now NOTHING in the schema enforced the second half: shift_block_assignments carried no
-- UNIQUE and no EXCLUDE constraint, and enforce_block_occupied_headcount only compares an
-- occupied COUNT against required_headcount -- which two seats held by the SAME worker on
-- a headcount-2 block satisfy perfectly.
--
-- That is exactly how the permanent_pickup_slot double-seat bug (fixed 2026-07-24 in
-- 20260724000005) reached a running database and had to be found by hand-reproducing it:
-- the write was wrong, and the database had no opinion. Every finding in the 2026-07-26
-- concurrency audit shares that property -- they all fail SILENT, with the losing session
-- receiving HTTP 200. This index is the backstop that turns the next one loud.
--
-- Verified before adding: zero rows in the local database violate it.
--
-- WHAT IT DOES NOT DO. It does not fix the ownership-overwrite races (those are
-- 20260726000009) -- a stolen seat keeps exactly one occupant, so no unique constraint
-- can see it. It catches DUPLICATION, not substitution.
--
-- Three call sites gain an explicit "worker does not already occupy this block" filter,
-- so a legitimate flow degrades to assigning one fewer seat instead of failing the whole
-- operation with a raw 23505. claim_open_shift and claim_break_blocks need no such guard:
-- their existing time-conflict checks already reject a second seat at the same
-- block_start_at, which necessarily includes the same block.

-- ---------------------------------------------------------------------------
-- 1. The constraint. Partial: only OCCUPIED seats, and only rows with a worker.
--    Vacant seats have user_id NULL (many per block, by design) and the terminal
--    statuses (cancelled_config, floated_out, ...) are history, not occupancy.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS shift_block_assignments_one_seat_per_worker
  ON shift_block_assignments (block_id, user_id)
  WHERE user_id IS NOT NULL
    AND status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in');

COMMENT ON INDEX shift_block_assignments_one_seat_per_worker IS
  'Hard invariant #5: a worker occupies at most ONE seat of a 30-minute block. The '
  'occupied-status set matches enforce_block_occupied_headcount and the escalation '
  'present-set. Added by the 2026-07-26 concurrency audit (F7) as the loud backstop the '
  'permanent_pickup_slot double-seat bug did not have.';

-- -------------------------------------------------------------------------
-- 2. enforce_block_occupied_headcount: count the siblings under lock.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_block_occupied_headcount()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_required integer;
  v_others   integer;
  v_occupied text[] := ARRAY['scheduled', 'claimed', 'floated_in', 'pending_float_in'];
BEGIN
  -- Only writes that OCCUPY the seat can over-staff a block.
  IF NEW.status <> ALL (v_occupied::shift_status_enum[]) THEN
    RETURN NEW;
  END IF;

  -- Grandfathering: an UPDATE that keeps an already-occupied seat occupied ON THE
  -- SAME block does not increase the block's occupied count. Skip the check so a
  -- swap / no-op on a block whose required_headcount was later reduced still works.
  IF TG_OP = 'UPDATE'
     AND OLD.status = ANY (v_occupied::shift_status_enum[])
     AND OLD.block_id = NEW.block_id THEN
    RETURN NEW;
  END IF;

  SELECT required_headcount INTO v_required
  FROM shift_blocks
  WHERE block_id = NEW.block_id;

  IF v_required IS NULL THEN
    RETURN NEW;  -- no parent block (should be impossible via FK); don't second-guess.
  END IF;

  -- Audit F7: this count was an UNLOCKED read, which makes it a non-serialisable
  -- constraint -- two transactions each flipping a DIFFERENT seat of the same block to
  -- an occupied status cannot see each other's uncommitted row, so both computed the
  -- same v_others and both passed. Locking the sibling rows we count makes the
  -- update-update case correct: the second writer blocks, then re-counts against the
  -- first one's committed result.
  --
  -- Residual, deliberately not closed here: two concurrent INSERTs of occupied rows on
  -- one block are a phantom no row lock can prevent (there is no row yet to lock).
  -- That would need a block-level lock, which inverts against apply_compiled_season's
  -- bulk shift_blocks writes and buys nothing today -- every runtime occupy is an
  -- UPDATE of an existing seat row, and the only paths that INSERT occupied rows are
  -- the publish_schedule family, which already serialise on scheduling_periods
  -- FOR UPDATE. Revisit if a new path ever INSERTs an occupied seat outside publish.
  SELECT count(*) INTO v_others
  FROM (
    SELECT 1
    FROM shift_block_assignments
    WHERE block_id = NEW.block_id
      AND assignment_id <> NEW.assignment_id
      AND status = ANY (v_occupied::shift_status_enum[])
    FOR UPDATE
  ) siblings;

  IF v_others + 1 > v_required THEN
    RAISE EXCEPTION
      'block_over_capacity: block % already has % occupied seat(s); house headcount is %',
      NEW.block_id, v_others, v_required
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- -------------------------------------------------------------------------
-- 3. admin_assign_worker: never assign a worker a second seat on one block.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_assign_worker(p_operator_user_id uuid, p_block_ids uuid[], p_user_id uuid, p_scope text, p_override_advisories boolean, p_now timestamp with time zone, p_incumbent_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_block_house_id text;
  v_distinct_houses integer;
  v_worker record;
  v_cap record;
  v_target_block_ids uuid[];
  v_day_of_week integer;
  v_block_start_locals text[];
  v_incumbent_user_id uuid;
  v_has_started boolean;
  v_has_float boolean;
  v_has_unassignable boolean;
  v_has_cannot boolean;
  v_advisories jsonb := '[]'::jsonb;
  v_assigned_count integer := 0;
BEGIN
  IF p_block_ids IS NULL OR array_length(p_block_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'empty_block_set';
  END IF;

  IF p_scope NOT IN ('this_week', 'permanent') THEN
    RAISE EXCEPTION 'invalid_scope';
  END IF;

  -- The clicked seats must all belong to ONE house (the per-house calendar).
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

  -- Authz (D7): operator holds sm/hm/bm scoped to the block's house.
  IF NOT user_can_build_schedule(p_operator_user_id, v_block_house_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Target worker.
  SELECT user_id, home_house_id, is_active
    INTO v_worker
  FROM users
  WHERE user_id = p_user_id;

  IF NOT FOUND OR v_worker.is_active = false THEN
    RAISE EXCEPTION 'user_inactive';
  END IF;

  -- Same-house override only (S1 OUT — cross-house = pickup/float semantics).
  IF v_worker.home_house_id <> v_block_house_id THEN
    RAISE EXCEPTION 'cross_house_not_supported';
  END IF;

  -- Resolve the seat set for the scope.
  IF p_scope = 'this_week' THEN
    v_target_block_ids := p_block_ids;
  ELSE
    -- permanent (D5): derive the slot (house, NY-DOW, NY local time-of-day) from
    -- the clicked blocks; act on every occurrence with block_start_at > now,
    -- <= semester end_date, profile_name='regular_school_year'.
    SELECT
      EXTRACT(DOW FROM MIN(sb.block_start_at) AT TIME ZONE 'America/New_York')::integer,
      array_agg(DISTINCT TO_CHAR(sb.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI'))
      INTO v_day_of_week, v_block_start_locals
    FROM shift_blocks sb
    WHERE sb.block_id = ANY (p_block_ids);

    SELECT array_agg(sb.block_id)
      INTO v_target_block_ids
    FROM shift_blocks sb
    JOIN scheduling_periods sp
      ON (sb.block_start_at AT TIME ZONE 'America/New_York')::date
         BETWEEN sp.start_date AND sp.end_date
     AND sp.profile_name = 'regular_school_year'
    JOIN operating_calendar oc
      ON oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
     AND oc.profile_name = 'regular_school_year'
    WHERE sb.house_id = v_block_house_id
      AND EXTRACT(DOW FROM sb.block_start_at AT TIME ZONE 'America/New_York') = v_day_of_week
      AND TO_CHAR(sb.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI') = ANY (v_block_start_locals)
      AND sb.block_start_at > p_now;

    IF v_target_block_ids IS NULL THEN
      RAISE EXCEPTION 'block_started'; -- no future in-semester occurrences remain
    END IF;
  END IF;

  -- ---- Hard-block evaluation over the clicked occurrence's seats ----------
  -- These per-seat checks apply to the THIS_WEEK target seat. For PERMANENT the
  -- clicked block is only the slot descriptor (D5): the current/started occurrence
  -- is expected and simply skipped, future occurrences are filtered into
  -- v_target_block_ids (+ permanent_pickup_slot/permanent_drop_slot only touch
  -- vacant/permanent_drop and skip floats), and the no-future-occurrence case
  -- already raised block_started above.
  IF p_scope = 'this_week' THEN

  -- block_started: any clicked seat at/after its start (D1 — edits never run after start).
  SELECT bool_or(sb.block_start_at <= p_now)
    INTO v_has_started
  FROM shift_blocks sb
  WHERE sb.block_id = ANY (p_block_ids);
  IF COALESCE(v_has_started, false) THEN
    RAISE EXCEPTION 'block_started';
  END IF;

  -- float_committed: any clicked seat in a float-committed status (S1 OUT).
  SELECT bool_or(sba.status IN ('floated_in', 'floated_out', 'pending_float_in', 'pending_float_out'))
    INTO v_has_float
  FROM shift_block_assignments sba
  WHERE sba.block_id = ANY (p_block_ids);
  IF COALESCE(v_has_float, false) THEN
    RAISE EXCEPTION 'float_committed';
  END IF;

  -- When REPLACE targets a specific incumbent, every clicked block must actually
  -- hold a removable (scheduled / claimed) seat for that worker — otherwise the
  -- operator is acting on a stale card.
  IF p_incumbent_user_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM (SELECT DISTINCT sb.block_id FROM shift_blocks sb WHERE sb.block_id = ANY (p_block_ids)) clicked
      WHERE NOT EXISTS (
        SELECT 1
        FROM shift_block_assignments sba
        WHERE sba.block_id = clicked.block_id
          AND sba.user_id = p_incumbent_user_id
          AND sba.status IN ('scheduled', 'claimed')
      )
    ) THEN
      RAISE EXCEPTION 'not_occupied_by_worker';
    END IF;
  ELSE
    -- seat_not_assignable: every clicked seat must be fillable (vacant) or a
    -- reassignable occupied non-float seat (scheduled / claimed). A block with no
    -- assignable seat (e.g. fully allied, or no vacant/occupied-non-float row) blocks.
    SELECT bool_or(blk.assignable_seats = 0)
      INTO v_has_unassignable
    FROM (
      SELECT
        sb.block_id,
        COUNT(*) FILTER (
          WHERE sba.status IN ('vacant', 'scheduled', 'claimed')
        ) AS assignable_seats
      FROM shift_blocks sb
      LEFT JOIN shift_block_assignments sba ON sba.block_id = sb.block_id
      WHERE sb.block_id = ANY (p_block_ids)
      GROUP BY sb.block_id
    ) blk;
    IF COALESCE(v_has_unassignable, false) THEN
      RAISE EXCEPTION 'seat_not_assignable';
    END IF;
  END IF;

  END IF; -- this_week per-clicked-seat checks

  -- hard cap (D2/D9): absolute, NOT overridable even with p_override_advisories.
  SELECT * INTO v_cap FROM admin_override_cap_assessment(p_user_id, v_target_block_ids);
  IF v_cap.over_hard THEN
    RAISE EXCEPTION 'hard_cap_exceeded';
  END IF;

  -- ---- Soft advisories (overridable via 2-step confirm) -------------------
  -- cannot: the worker marked 'cannot' on a clicked block in the current period.
  SELECT bool_or(true)
    INTO v_has_cannot
  FROM preferences pref
  JOIN scheduling_periods sp ON sp.period_id = pref.period_id
  JOIN shift_blocks sb ON sb.block_id = pref.block_id
  WHERE pref.user_id = p_user_id
    AND pref.block_id = ANY (p_block_ids)
    AND pref.status = 'cannot'
    AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN sp.start_date AND sp.end_date;
  IF COALESCE(v_has_cannot, false) THEN
    v_advisories := v_advisories || jsonb_build_array(jsonb_build_object('kind', 'cannot'));
  END IF;

  -- opted_out: period_targets.opted_out for the worker in the clicked occurrence's period.
  IF EXISTS (
    SELECT 1
    FROM period_targets pt
    JOIN scheduling_periods sp ON sp.period_id = pt.period_id
    JOIN shift_blocks sb ON sb.block_id = ANY (p_block_ids)
    WHERE pt.user_id = p_user_id
      AND pt.opted_out = true
      AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN sp.start_date AND sp.end_date
  ) THEN
    v_advisories := v_advisories || jsonb_build_array(jsonb_build_object('kind', 'opted_out'));
  END IF;

  -- soft_cap.
  IF v_cap.over_soft THEN
    v_advisories := v_advisories || jsonb_build_array(jsonb_build_object('kind', 'soft_cap'));
  END IF;

  -- over_target: projected hours beyond the worker's submitted target.
  IF EXISTS (
    SELECT 1
    FROM period_targets pt
    JOIN scheduling_periods sp ON sp.period_id = pt.period_id
    JOIN shift_blocks sb ON sb.block_id = ANY (p_block_ids)
    WHERE pt.user_id = p_user_id
      AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN sp.start_date AND sp.end_date
      AND (
        (
          SELECT COUNT(*)::numeric * 0.5
          FROM shift_block_assignments ex
          JOIN shift_blocks exb USING (block_id)
          WHERE ex.user_id = p_user_id
            AND ex.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
            AND date_trunc('week', exb.block_start_at AT TIME ZONE 'America/New_York')::date
                = date_trunc('week', sb.block_start_at AT TIME ZONE 'America/New_York')::date
            AND NOT (ex.block_id = ANY (p_block_ids))
        )
        + (array_length(p_block_ids, 1)::numeric * 0.5)
      ) > pt.target_hours
  ) THEN
    v_advisories := v_advisories || jsonb_build_array(jsonb_build_object('kind', 'over_target'));
  END IF;

  -- Soft-confirm gate: advisories present + flag not set ⇒ NO write, signal confirm.
  IF jsonb_array_length(v_advisories) > 0 AND p_override_advisories = false THEN
    RETURN jsonb_build_object('needs_confirm', true, 'advisories', v_advisories);
  END IF;

  -- ---- Write -------------------------------------------------------------
  IF p_scope = 'this_week' THEN
    -- Fill each seat with one row per block. When an incumbent is named (REPLACE),
    -- overwrite THAT worker's seat; otherwise prefer a vacant seat, else the first
    -- reassignable occupied non-float seat.
    -- Concurrency (audit F3). The seat pick used to be an UNLOCKED DISTINCT ON and
    -- the UPDATE re-checked nothing, so two admins assigning different workers to the
    -- same block both selected the same lowest assignment_id and the second silently
    -- overwrote the first -- while both were told assigned_count = 1. The same window
    -- let an admin write land on top of a worker's just-committed claim, leaving the
    -- worker with a 200 OK and a seat that is no longer theirs.
    --
    -- DISTINCT ON cannot carry a lock ("FOR UPDATE is not allowed with DISTINCT
    -- clause"), so this is the LATERAL LIMIT 1 pattern already used by
    -- permanent_pickup_slot (20260724000005) and claim_open_shift.
    --
    -- SKIP LOCKED, not plain FOR UPDATE. Plain FOR UPDATE does NOT fix the two-admin
    -- collision: the blocked session wakes, re-checks the row, finds it now 'claimed'
    -- (still inside this predicate, because reassigning an occupied seat is exactly
    -- what admin override is for) and overwrites the other admin's worker anyway.
    -- SKIP LOCKED makes the second admin step over the seat the first is holding and
    -- take the block's OTHER free seat, so on a multi-staff desk both assignments land.
    -- When there is genuinely no seat left, `chosen` comes up short and the assertion
    -- below raises seat_not_assignable, which is the honest answer: the admin lost the
    -- race and must look again, rather than silently erasing whoever won it.
    WITH candidate_blocks AS MATERIALIZED (
      SELECT DISTINCT sb.block_id
      FROM shift_blocks sb
      WHERE sb.block_id = ANY (v_target_block_ids)
    ),
    chosen AS MATERIALIZED (
      SELECT seat.assignment_id
      FROM candidate_blocks cb
      CROSS JOIN LATERAL (
        SELECT a.assignment_id
        FROM shift_block_assignments a
        WHERE a.block_id = cb.block_id
          AND (
            (p_incumbent_user_id IS NOT NULL
               AND a.user_id = p_incumbent_user_id
               AND a.status IN ('scheduled', 'claimed'))
            OR
            (p_incumbent_user_id IS NULL
               AND a.status IN ('vacant', 'scheduled', 'claimed'))
          )
          -- Invariant #5 (audit F7): never give the target worker a SECOND seat on a
          -- block they already occupy. On a multi-staff desk (Harnwell 2, Quad 3) the
          -- pick could otherwise land on the free seat of a block where they are
          -- already scheduled. The new partial unique index would reject that with a
          -- raw 23505 and fail the whole admin action, so filter it out here and let
          -- the seat simply not be assigned.
          AND NOT EXISTS (
            SELECT 1
            FROM shift_block_assignments held
            WHERE held.block_id = cb.block_id
              AND held.user_id = p_user_id
              AND held.assignment_id <> a.assignment_id
              AND held.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
          )
        ORDER BY
          CASE WHEN a.status = 'vacant' THEN 0 ELSE 1 END,
          a.assignment_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ) seat
    )
    UPDATE shift_block_assignments sba
    SET status = 'claimed',
        user_id = p_user_id,
        vacancy_origin = 'none',
        is_float = false,
        is_cross_house_pickup = false,
        source_house_id = NULL,
        parent_float_id = NULL
    FROM chosen
    WHERE sba.assignment_id = chosen.assignment_id
      -- Re-assert under the lock. A seat that became float-committed between the
      -- float_committed hard-block check and this write drops out here instead of
      -- being overwritten (S1 OUT: admin override never touches a float seat).
      AND sba.status IN ('vacant', 'scheduled', 'claimed');

    GET DIAGNOSTICS v_assigned_count = ROW_COUNT;

    -- Every clicked block passed seat_not_assignable / not_occupied_by_worker above.
    -- A shortfall here means a competing write took a seat under us; surface it with
    -- the existing vocabulary rather than reporting a partial success as a success.
    IF v_assigned_count <> (
      SELECT count(DISTINCT sb.block_id)
      FROM shift_blocks sb
      WHERE sb.block_id = ANY (v_target_block_ids)
    ) THEN
      RAISE EXCEPTION 'seat_not_assignable';
    END IF;
  ELSE
    -- permanent: if the clicked occurrence is occupied, permanently drop the
    -- incumbent first (vacates future occurrences → permanent_drop, writes the
    -- people alerts), then pick up the slot for the new worker. Prefer the named
    -- incumbent (REPLACE); else detect the occupied seat.
    IF p_incumbent_user_id IS NOT NULL THEN
      v_incumbent_user_id := p_incumbent_user_id;
    ELSE
      SELECT sba.user_id
        INTO v_incumbent_user_id
      FROM shift_block_assignments sba
      WHERE sba.block_id = ANY (p_block_ids)
        AND sba.user_id IS NOT NULL
        AND sba.status IN ('scheduled', 'claimed')
      LIMIT 1;
    END IF;

    IF v_incumbent_user_id IS NOT NULL AND v_incumbent_user_id <> p_user_id THEN
      PERFORM permanent_drop_slot(
        v_incumbent_user_id,
        v_block_house_id,
        v_day_of_week,
        v_block_start_locals,
        p_now,
        p_operator_user_id
      );
    END IF;

    -- Fill every future in-semester occurrence that currently has a vacant seat.
    -- Bug fix: this used to delegate to permanent_pickup_slot, whose WHERE clause
    -- requires vacancy_origin = 'permanent_drop' (the worker permanent-pickup feed
    -- semantics, §8.4.3). That silently assigned ZERO seats when the future
    -- occurrences were plain 'never_assigned' opens (a generated open shift that
    -- was never permanently dropped) — exactly the common admin action of placing
    -- a worker on a recurring open slot. Admin override (D5) fills ANY vacant seat
    -- on the future occurrences, regardless of vacancy_origin. permanent_drop seats
    -- (e.g. those just vacated by the incumbent permanent_drop_slot above) are a
    -- subset of 'vacant' and are still covered. Harnwell training is enforced
    -- earlier via the same-house guard (worker.home_house_id = block house).
    -- Same LATERAL LIMIT 1 FOR UPDATE treatment as the this_week branch (audit F3).
    -- SKIP LOCKED here, not plain FOR UPDATE: the permanent branch spans an entire
    -- semester of occurrences, and partial success is already its contract (it fills
    -- whatever future weeks are vacant), so stepping over a seat another writer holds
    -- is correct and blocking on it would serialise a long multi-week write behind an
    -- unrelated single-block claim.
    WITH candidate_blocks AS MATERIALIZED (
      SELECT DISTINCT sba.block_id
      FROM shift_block_assignments sba
      WHERE sba.block_id = ANY (v_target_block_ids)
        AND sba.status = 'vacant'
    ),
    chosen AS MATERIALIZED (
      SELECT seat.assignment_id
      FROM candidate_blocks cb
      CROSS JOIN LATERAL (
        SELECT a.assignment_id
        FROM shift_block_assignments a
        WHERE a.block_id = cb.block_id
          AND a.status = 'vacant'
          -- Invariant #5 (audit F7), same guard as the this_week branch. This one
          -- matters more: the permanent scope spans a whole semester of occurrences,
          -- so without it a single already-held week would 23505 the entire multi-week
          -- assignment.
          AND NOT EXISTS (
            SELECT 1
            FROM shift_block_assignments held
            WHERE held.block_id = cb.block_id
              AND held.user_id = p_user_id
              AND held.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
          )
        ORDER BY
          CASE WHEN a.vacancy_origin = 'permanent_drop' THEN 0 ELSE 1 END,
          a.assignment_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ) seat
    )
    UPDATE shift_block_assignments sba
    SET status = 'claimed',
        user_id = p_user_id,
        vacancy_origin = 'none',
        is_float = false,
        is_cross_house_pickup = false,
        source_house_id = NULL,
        parent_float_id = NULL
    FROM chosen
    WHERE sba.assignment_id = chosen.assignment_id
      AND sba.status = 'vacant';

    GET DIAGNOSTICS v_assigned_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'needs_confirm', false,
    'assigned_count', COALESCE(v_assigned_count, 0),
    'scope', p_scope,
    'advisories', v_advisories
  );
END;
$function$;

-- -------------------------------------------------------------------------
-- 4. permanent_pickup_slot: same guard on the multi-week pickup.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.permanent_pickup_slot(p_picking_user_id uuid, p_assigned_block_ids uuid[], p_skipped_block_ids uuid[] DEFAULT ARRAY[]::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_home_house_id text;
  v_assigned_count integer;
  v_skipped_count integer;
BEGIN
  SELECT home_house_id
    INTO v_home_house_id
  FROM users
  WHERE user_id = p_picking_user_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_inactive';
  END IF;

  -- Harnwell training invariant (AGENTS #1) guards every block this call
  -- touches — both the seats being claimed and the seats being re-flagged.
  IF EXISTS (
    SELECT 1
    FROM shift_blocks sb
    WHERE sb.block_id = ANY (
        COALESCE(p_assigned_block_ids, ARRAY[]::uuid[])
        || COALESCE(p_skipped_block_ids, ARRAY[]::uuid[])
      )
      AND sb.house_id = 'harnwell'
      AND v_home_house_id <> 'harnwell'
  ) THEN
    RAISE EXCEPTION 'harnwell_training_required';
  END IF;

  -- Assigned weeks: claim ONE seat per block. Invariant #5 — a worker occupies at most one
  -- seat of a 30-minute block, so a block with two permanent-drop vacancies yields one seat
  -- here and leaves the other in the permanent feed for the next picker.
  --
  -- Race-safe on two levels (ARCH §7.2 step 6, §10.9): SKIP LOCKED steps over a seat a
  -- concurrent pickup/claim already holds uncommitted, and the status/vacancy_origin
  -- predicates (re-checked when the lock is taken, and again by the outer UPDATE) drop a
  -- seat that a committed transaction has since taken. Either way the loser of the race
  -- gets a smaller assigned_count, never someone else's seat.
  WITH candidate_blocks AS MATERIALIZED (
    SELECT DISTINCT sba.block_id
    FROM shift_block_assignments sba
    WHERE sba.block_id = ANY (COALESCE(p_assigned_block_ids, ARRAY[]::uuid[]))
      AND sba.status = 'vacant'
      AND sba.vacancy_origin = 'permanent_drop'
      -- Invariant #5 (audit F7). The time-conflict check for permanent pickup lives in
      -- the Edge Function's evaluator, an unlocked read one HTTP round trip earlier, so
      -- a week the picker acquired in between would land them on two seats of one
      -- block. That now hits the partial unique index and 23505s the whole multi-week
      -- pickup; skipping the block instead preserves the documented partial-success
      -- contract (§8.4.3) and just lowers assigned_count by one.
      AND NOT EXISTS (
        SELECT 1
        FROM shift_block_assignments held
        WHERE held.block_id = sba.block_id
          AND held.user_id = p_picking_user_id
          AND held.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
      )
  ),
  chosen AS MATERIALIZED (
    SELECT seat.assignment_id
    FROM candidate_blocks cb
    CROSS JOIN LATERAL (
      SELECT a.assignment_id
      FROM shift_block_assignments a
      WHERE a.block_id = cb.block_id
        AND a.status = 'vacant'
        AND a.vacancy_origin = 'permanent_drop'
      ORDER BY a.assignment_id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ) seat
  )
  UPDATE shift_block_assignments sba
  SET
    user_id = p_picking_user_id,
    status = 'claimed',
    vacancy_origin = 'none',
    is_cross_house_pickup = (sb.house_id <> v_home_house_id),
    source_house_id = CASE
      WHEN sb.house_id <> v_home_house_id THEN v_home_house_id
      ELSE NULL
    END
  FROM chosen, shift_blocks sb
  WHERE sba.assignment_id = chosen.assignment_id
    AND sb.block_id = sba.block_id
    AND sba.status = 'vacant'
    AND sba.vacancy_origin = 'permanent_drop';

  GET DIAGNOSTICS v_assigned_count = ROW_COUNT;

  -- Skipped weeks (hours-cap / time-conflict): re-flag ONE seat per block OFF
  -- permanent_drop in the SAME transaction. It stays vacant (so weekly_open_shifts_feed
  -- still surfaces it within the 30-day horizon and it undergoes standard weekly
  -- escalation), but it leaves permanent_openings_feed (which filters
  -- vacancy_origin = 'permanent_drop') and can no longer be permanently re-picked-up. This
  -- is the §8.4.3 / ARCH §7.2-step-8 guarantee: after any pickup the slot leaves the
  -- permanent feed regardless of completeness, and "partial pickups are final." One seat
  -- per block scopes that retirement to the slot actually being picked up — a co-tenant's
  -- independent permanent drop on the same block stays in the permanent feed. Same
  -- SKIP LOCKED + predicate race guards as the assigned pass.
  WITH candidate_blocks AS MATERIALIZED (
    SELECT DISTINCT sba.block_id
    FROM shift_block_assignments sba
    WHERE sba.block_id = ANY (COALESCE(p_skipped_block_ids, ARRAY[]::uuid[]))
      AND sba.status = 'vacant'
      AND sba.vacancy_origin = 'permanent_drop'
  ),
  chosen AS MATERIALIZED (
    SELECT seat.assignment_id
    FROM candidate_blocks cb
    CROSS JOIN LATERAL (
      SELECT a.assignment_id
      FROM shift_block_assignments a
      WHERE a.block_id = cb.block_id
        AND a.status = 'vacant'
        AND a.vacancy_origin = 'permanent_drop'
      ORDER BY a.assignment_id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ) seat
  )
  UPDATE shift_block_assignments sba
  SET vacancy_origin = 'temporary_drop'
  FROM chosen
  WHERE sba.assignment_id = chosen.assignment_id
    AND sba.status = 'vacant'
    AND sba.vacancy_origin = 'permanent_drop';

  GET DIAGNOSTICS v_skipped_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'assigned_count', v_assigned_count,
    'skipped_count', v_skipped_count
  );
END;
$function$;


-- rollback:
-- DROP INDEX IF EXISTS shift_block_assignments_one_seat_per_worker;
-- (restore enforce_block_occupied_headcount from 20260702000005, admin_assign_worker
--  from 20260726000009, and permanent_pickup_slot from 20260724000005)
