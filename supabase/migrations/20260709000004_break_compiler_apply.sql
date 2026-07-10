-- Migration: per-house BREAK authoring — compile/apply/reconcile (supersedes the
-- pick-a-profile author_break_period path for the UI).
--
-- A break is now authored per-house like a summer operating season: the admin sets
-- open/closed + headcount + weekday/weekend hours per house + a global floating
-- switch, the pure `compileBreak` (@shift/core) derives a per-break claim-based
-- operating profile (`b_<slug>_<startdate>`) with universal float routing, and this
-- RPC materializes it into the runtime config tables and GENERATES + RECONCILES the
-- window's blocks — reusing the season reconcile engine (grandfather occupied seats,
-- void closed-house seats, trim/add vacant to match headcount). Mirrors
-- apply_compiled_season (20260702000006) but with break semantics: claim-phase
-- offsets on the profile, break-type hours cap, a break_periods row, and NO
-- scheduling_periods row. Admin-gated via auth.uid() (confused-deputy-safe).

-- ============================================================
-- Shared reconcile engine: (re)generate + reconcile FUTURE blocks in a date range
-- against the CURRENT operating_calendar + staffing_patterns. Extracted so both the
-- break apply and break removal converge blocks to the live config. Returns an
-- impact summary (counts + a capped "who is affected" sample). Service-role only:
-- it is only ever invoked from the admin-gated SECURITY DEFINER RPCs below (the
-- definer has execute rights regardless of the caller's grant).
-- ============================================================
CREATE OR REPLACE FUNCTION reconcile_config_blocks(p_start date, p_end date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now         timestamptz := app_now();
  v_blk         record;
  v_target      integer;
  v_current     integer;
  v_seat_gap    integer;
  v_vacant_removable integer;
  v_occupied_now integer;
  v_victim_ids  uuid[];
  v_gen         record;
  c_blocks_generated integer := 0;
  c_blocks_voided integer := 0;
  c_seats_added integer := 0;
  c_seats_removed integer := 0;
  c_assignments_cancelled integer := 0;
  c_floats_voided integer := 0;
  c_affected jsonb := '[]'::jsonb;
  c_affected_cap constant integer := 60;
  v_occupied text[] := ARRAY['scheduled', 'claimed', 'floated_in', 'pending_float_in'];
BEGIN
  -- Generate any missing blocks for newly-open houses/dates (idempotent; future-only count).
  SELECT * INTO v_gen FROM generate_blocks_for_range(p_start, p_end);
  c_blocks_generated := COALESCE(v_gen.blocks_inserted, 0);

  -- Reconcile EXISTING future blocks in range against the new config.
  FOR v_blk IN
    SELECT sb.block_id, sb.house_id, sb.block_start_at, sb.required_headcount, sb.voided_at
    FROM shift_blocks sb
    WHERE sb.block_start_at > v_now
      AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN p_start AND p_end
  LOOP
    v_target := season_target_headcount(v_blk.house_id, v_blk.block_start_at);

    IF v_target = 0 THEN
      -- House closed (or block now outside desk hours) → VOID this future block.
      IF v_blk.voided_at IS NULL THEN
        INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
        SELECT a.user_id, 'personal_shift', v_now,
               jsonb_build_object('kind', 'shift_cancelled_config',
                                  'house_id', v_blk.house_id, 'block_start_at', v_blk.block_start_at)
        FROM shift_block_assignments a
        WHERE a.block_id = v_blk.block_id
          AND a.user_id IS NOT NULL
          AND a.status = ANY (v_occupied::shift_status_enum[]);
        GET DIAGNOSTICS v_seat_gap = ROW_COUNT;
        c_assignments_cancelled := c_assignments_cancelled + v_seat_gap;

        IF v_seat_gap > 0 AND jsonb_array_length(c_affected) < c_affected_cap THEN
          c_affected := c_affected || COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                     'house', h.name, 'worker', u.name,
                     'when', to_char(v_blk.block_start_at AT TIME ZONE 'America/New_York', 'Mon DD, HH24:MI'),
                     'kind', 'shift'))
            FROM shift_block_assignments a
            JOIN users u  ON u.user_id = a.user_id
            JOIN houses h ON h.id = v_blk.house_id
            WHERE a.block_id = v_blk.block_id
              AND a.user_id IS NOT NULL
              AND a.status = ANY (v_occupied::shift_status_enum[])
          ), '[]'::jsonb);
        END IF;

        IF jsonb_array_length(c_affected) < c_affected_cap THEN
          c_affected := c_affected || COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                     'house', h.name, 'worker', u.name,
                     'when', to_char(v_blk.block_start_at AT TIME ZONE 'America/New_York', 'Mon DD, HH24:MI'),
                     'kind', 'float'))
            FROM float_assignments f
            JOIN users u  ON u.user_id = f.user_id
            JOIN houses h ON h.id = v_blk.house_id
            WHERE f.status IN ('pending', 'acknowledged')
              AND f.destination_assignment_ids && (
                SELECT array_agg(assignment_id) FROM shift_block_assignments WHERE block_id = v_blk.block_id
              )
          ), '[]'::jsonb);
        END IF;

        WITH blk_assignments AS (
          SELECT array_agg(assignment_id) AS ids
          FROM shift_block_assignments WHERE block_id = v_blk.block_id
        ),
        voided AS (
          UPDATE float_assignments f
          SET status = 'voided'
          FROM blk_assignments b
          WHERE f.status IN ('pending', 'acknowledged')
            AND f.destination_assignment_ids && b.ids
          RETURNING f.user_id
        ),
        notif AS (
          INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
          SELECT user_id, 'personal_shift', v_now,
                 jsonb_build_object('kind', 'float_cancelled_config', 'house_id', v_blk.house_id)
          FROM voided
          RETURNING 1
        )
        SELECT count(*) INTO v_seat_gap FROM voided;
        c_floats_voided := c_floats_voided + v_seat_gap;

        UPDATE shift_block_assignments
        SET status = 'cancelled_config', vacancy_origin = 'none'
        WHERE block_id = v_blk.block_id
          AND status = ANY (v_occupied::shift_status_enum[]);

        DELETE FROM shift_block_assignments
        WHERE block_id = v_blk.block_id AND status = 'vacant';

        UPDATE shift_blocks SET voided_at = v_now WHERE block_id = v_blk.block_id;
        c_blocks_voided := c_blocks_voided + 1;
      END IF;

    ELSE
      -- House open this date. Un-void if a prior apply voided it.
      IF v_blk.voided_at IS NOT NULL THEN
        UPDATE shift_blocks SET voided_at = NULL, required_headcount = v_target
        WHERE block_id = v_blk.block_id;
        v_current := 0;
      ELSE
        v_current := v_blk.required_headcount;
      END IF;

      IF v_target > v_current THEN
        UPDATE shift_blocks SET required_headcount = v_target WHERE block_id = v_blk.block_id;
        SELECT count(*) INTO v_occupied_now
        FROM shift_block_assignments
        WHERE block_id = v_blk.block_id AND status <> 'cancelled_config';
        v_seat_gap := v_target - v_occupied_now;
        IF v_seat_gap > 0 THEN
          INSERT INTO shift_block_assignments (block_id, status, vacancy_origin)
          SELECT v_blk.block_id, 'vacant', 'never_assigned'
          FROM generate_series(1, v_seat_gap);
          c_seats_added := c_seats_added + v_seat_gap;
        END IF;

      ELSIF v_target < v_current THEN
        UPDATE shift_blocks SET required_headcount = v_target WHERE block_id = v_blk.block_id;

        SELECT count(*) INTO v_occupied_now
        FROM shift_block_assignments
        WHERE block_id = v_blk.block_id AND status = ANY (v_occupied::shift_status_enum[]);

        IF v_occupied_now > v_target THEN
          -- More workers hold this now-smaller block than it has seats: cancel the
          -- excess by the cut order (floater -> shorter shift -> assignment_id).
          -- Mirrors apply_compiled_season (20260709000003): config downsize CANCELS
          -- excess, never grandfathers, so no seat is double-booked.
          SELECT array_agg(assignment_id) INTO v_victim_ids
          FROM (
            SELECT a.assignment_id
            FROM shift_block_assignments a
            WHERE a.block_id = v_blk.block_id
              AND a.status = ANY (v_occupied::shift_status_enum[])
            ORDER BY
              (a.status IN ('pending_float_in', 'floated_in')) DESC,
              (SELECT count(*)
                 FROM shift_block_assignments a2
                 JOIN shift_blocks b2 ON b2.block_id = a2.block_id
                WHERE a2.user_id = a.user_id
                  AND b2.house_id = v_blk.house_id
                  AND (b2.block_start_at AT TIME ZONE 'America/New_York')::date
                      = (v_blk.block_start_at AT TIME ZONE 'America/New_York')::date
                  AND a2.status = ANY (v_occupied::shift_status_enum[])) ASC,
              a.assignment_id
            LIMIT (v_occupied_now - v_target)
          ) picked;

          INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
          SELECT a.user_id, 'personal_shift', v_now,
                 jsonb_build_object('kind', 'shift_cancelled_config',
                                    'house_id', v_blk.house_id, 'block_start_at', v_blk.block_start_at)
          FROM shift_block_assignments a
          WHERE a.assignment_id = ANY (v_victim_ids) AND a.user_id IS NOT NULL;
          GET DIAGNOSTICS v_seat_gap = ROW_COUNT;
          c_assignments_cancelled := c_assignments_cancelled + v_seat_gap;

          IF v_seat_gap > 0 AND jsonb_array_length(c_affected) < c_affected_cap THEN
            c_affected := c_affected || COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'house', h.name, 'worker', u.name,
                       'when', to_char(v_blk.block_start_at AT TIME ZONE 'America/New_York', 'Mon DD, HH24:MI'),
                       'kind', 'shift'))
              FROM shift_block_assignments a
              JOIN users u  ON u.user_id = a.user_id
              JOIN houses h ON h.id = v_blk.house_id
              WHERE a.assignment_id = ANY (v_victim_ids) AND a.user_id IS NOT NULL
            ), '[]'::jsonb);
          END IF;

          IF jsonb_array_length(c_affected) < c_affected_cap THEN
            c_affected := c_affected || COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'house', h.name, 'worker', u.name,
                       'when', to_char(v_blk.block_start_at AT TIME ZONE 'America/New_York', 'Mon DD, HH24:MI'),
                       'kind', 'float'))
              FROM float_assignments f
              JOIN users u  ON u.user_id = f.user_id
              JOIN houses h ON h.id = v_blk.house_id
              WHERE f.status IN ('pending', 'acknowledged')
                AND f.destination_assignment_ids && v_victim_ids
            ), '[]'::jsonb);
          END IF;

          WITH voided AS (
            UPDATE float_assignments f
            SET status = 'voided'
            WHERE f.status IN ('pending', 'acknowledged')
              AND f.destination_assignment_ids && v_victim_ids
            RETURNING f.user_id
          ),
          notif AS (
            INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
            SELECT user_id, 'personal_shift', v_now,
                   jsonb_build_object('kind', 'float_cancelled_config', 'house_id', v_blk.house_id)
            FROM voided
            RETURNING 1
          )
          SELECT count(*) INTO v_seat_gap FROM voided;
          c_floats_voided := c_floats_voided + v_seat_gap;

          UPDATE shift_block_assignments
          SET status = 'cancelled_config', vacancy_origin = 'none'
          WHERE assignment_id = ANY (v_victim_ids);

          DELETE FROM shift_block_assignments
          WHERE block_id = v_blk.block_id AND status = 'vacant';
          GET DIAGNOSTICS v_seat_gap = ROW_COUNT;
          c_seats_removed := c_seats_removed + v_seat_gap;

        ELSE
          -- Occupied already fits: trim excess vacant seats down to (target - occupied).
          v_vacant_removable := GREATEST(0,
            (SELECT count(*) FROM shift_block_assignments
             WHERE block_id = v_blk.block_id AND status = 'vacant'));
          v_seat_gap := v_vacant_removable - GREATEST(v_target - v_occupied_now, 0);
          IF v_seat_gap > 0 THEN
            DELETE FROM shift_block_assignments
            WHERE ctid IN (
              SELECT ctid FROM shift_block_assignments
              WHERE block_id = v_blk.block_id AND status = 'vacant'
              LIMIT v_seat_gap
            );
            c_seats_removed := c_seats_removed + v_seat_gap;
          END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'blocks_generated', c_blocks_generated,
    'blocks_voided', c_blocks_voided,
    'seats_added', c_seats_added,
    'seats_removed', c_seats_removed,
    'assignments_cancelled', c_assignments_cancelled,
    'floats_voided', c_floats_voided,
    'affected_workers', c_affected
  );
END;
$$;

-- ============================================================
-- apply_compiled_break: materialize a compiled break + reconcile its window.
-- Payload is the serialized CompiledBreak (@shift/core break-authoring).
-- ============================================================
CREATE OR REPLACE FUNCTION apply_compiled_break(
  p_calling_user_id uuid,
  p_payload jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_break_id uuid := (p_payload ->> 'breakId')::uuid;
  v_slug     text := p_payload ->> 'slug';
  v_profile  text := p_payload ->> 'profileName';
  v_start    date := (p_payload ->> 'startDate')::date;
  v_end      date := (p_payload ->> 'endDate')::date;
  v_old_start date;
  v_old_end   date;
  v_old_profile text;
  v_house    jsonb;
  v_route    jsonb;
  v_recon    jsonb := '{}'::jsonb;
BEGIN
  -- Authz: project admin, the REAL caller (auth.uid()); param only trusted for
  -- service/test contexts. Avoids the confused-deputy privesc.
  IF NOT user_is_admin(COALESCE(auth.uid(), p_calling_user_id)) THEN
    RAISE EXCEPTION 'apply_compiled_break: not authorized'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_slug IS NULL OR v_profile IS NULL OR v_start IS NULL OR v_end IS NULL OR v_break_id IS NULL THEN
    RAISE EXCEPTION 'apply_compiled_break: payload missing required fields';
  END IF;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'apply_compiled_break: end date before start date'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Collision guard: a break may only overlay regular_school_year dates (or its own
  -- profile on re-apply). Never clobber a summer season (s_%) or ANOTHER break (b_%),
  -- which also keeps remove/shrink's restore-to-school-year correct.
  IF EXISTS (
    SELECT 1 FROM operating_calendar
    WHERE date BETWEEN v_start AND v_end
      AND profile_name <> 'regular_school_year'
      AND profile_name <> v_profile
  ) THEN
    RAISE EXCEPTION 'apply_compiled_break: break range overlaps a season or another break'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Old window (for edit-shrink restore).
  SELECT start_date, end_date, profile_name
    INTO v_old_start, v_old_end, v_old_profile
    FROM break_periods WHERE break_id = v_break_id;

  BEGIN
    -- 1. The per-break operating profile (claim-based, with claim offsets + cap).
    INSERT INTO operating_profiles (
      profile_name, shift_start_bound, shift_end_bound, default_hours_cap,
      default_cap_enforcement, scheduling_mode, float_enabled, escalation_chain,
      claim_phase_open_offset, claim_phase_alert_offset, claim_phase_close_offset
    )
    VALUES (
      v_profile,
      (p_payload ->> 'shiftStartBound')::time,
      (p_payload ->> 'shiftEndBound')::time,
      (p_payload ->> 'hoursCap')::int,
      (p_payload ->> 'capEnforcement')::cap_enforcement_enum,
      'claim_based',
      (p_payload ->> 'floatEnabled')::boolean,
      p_payload -> 'escalationChain',
      (p_payload ->> 'claimOpenOffset')::interval,
      (p_payload ->> 'claimAlertOffset')::interval,
      (p_payload ->> 'claimCloseOffset')::interval
    )
    ON CONFLICT (profile_name) DO UPDATE SET
      shift_start_bound = EXCLUDED.shift_start_bound,
      shift_end_bound = EXCLUDED.shift_end_bound,
      default_hours_cap = EXCLUDED.default_hours_cap,
      default_cap_enforcement = EXCLUDED.default_cap_enforcement,
      scheduling_mode = EXCLUDED.scheduling_mode,
      float_enabled = EXCLUDED.float_enabled,
      escalation_chain = EXCLUDED.escalation_chain,
      claim_phase_open_offset = EXCLUDED.claim_phase_open_offset,
      claim_phase_alert_offset = EXCLUDED.claim_phase_alert_offset,
      claim_phase_close_offset = EXCLUDED.claim_phase_close_offset;

    -- 2. Staffing patterns (replace; omit closed day types).
    DELETE FROM staffing_patterns WHERE profile_name = v_profile;
    FOR v_house IN SELECT * FROM jsonb_array_elements(p_payload -> 'houses')
    LOOP
      IF jsonb_array_length(COALESCE(v_house -> 'weekdayBands', '[]'::jsonb)) > 0 THEN
        INSERT INTO staffing_patterns (profile_name, house_id, day_type, block_headcounts)
        VALUES (v_profile, v_house ->> 'houseId', 'weekday', v_house -> 'weekdayBands');
      END IF;
      IF jsonb_array_length(COALESCE(v_house -> 'weekendBands', '[]'::jsonb)) > 0 THEN
        INSERT INTO staffing_patterns (profile_name, house_id, day_type, block_headcounts)
        VALUES (v_profile, v_house ->> 'houseId', 'weekend', v_house -> 'weekendBands');
      END IF;
    END LOOP;

    -- 3. Float routing (replace; legality trigger backstops Harnwell-never-dest).
    DELETE FROM float_routing WHERE profile_name = v_profile;
    FOR v_route IN SELECT * FROM jsonb_array_elements(p_payload -> 'floatRouting')
    LOOP
      INSERT INTO float_routing (profile_name, source_house_id, destination_house_id, precedence_order)
      VALUES (v_profile, v_route ->> 'sourceHouseId', v_route ->> 'destinationHouseId',
              (v_route ->> 'precedenceOrder')::int);
    END LOOP;

    -- 4. The break period row.
    INSERT INTO break_periods (break_id, break_name, break_type, start_date, end_date, profile_name)
    VALUES (v_break_id, p_payload ->> 'breakName', (p_payload ->> 'breakType')::break_type_enum,
            v_start, v_end, v_profile)
    ON CONFLICT (break_id) DO UPDATE SET
      break_name = EXCLUDED.break_name, break_type = EXCLUDED.break_type,
      start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
      profile_name = EXCLUDED.profile_name;

    -- 5. Edit-shrink: restore old-window dates now outside the range (still ours).
    IF v_old_start IS NOT NULL THEN
      UPDATE operating_calendar SET profile_name = 'regular_school_year'
      WHERE date BETWEEN v_old_start AND v_old_end
        AND date NOT BETWEEN v_start AND v_end
        AND profile_name = v_old_profile;
    END IF;

    -- 6. Retarget the new range to this break's profile.
    INSERT INTO operating_calendar (date, profile_name)
    SELECT gs::date, v_profile
    FROM generate_series(v_start, v_end, interval '1 day') AS gs
    ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

    -- 7. Generate + reconcile blocks over the union of the new and old windows
    --    (so restored old-range dates converge back to the school year too).
    v_recon := reconcile_config_blocks(
      LEAST(v_start, COALESCE(v_old_start, v_start)),
      GREATEST(v_end, COALESCE(v_old_end, v_end))
    );

    IF p_dry_run THEN
      RAISE EXCEPTION 'DRY_RUN' USING ERRCODE = 'PT001';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'PT001' THEN
      NULL; -- dry-run: rolled back, counters (v_recon) retained
  END;

  RETURN jsonb_build_object('dry_run', p_dry_run, 'break_id', v_break_id, 'profile', v_profile)
         || COALESCE(v_recon, '{}'::jsonb);
END;
$$;

-- ============================================================
-- remove_break_period (rewritten): restore the calendar, drop the per-break profile,
-- and reconcile blocks back to the school year. Returns an impact summary.
-- ============================================================
DROP FUNCTION IF EXISTS remove_break_period(uuid, uuid);
CREATE OR REPLACE FUNCTION remove_break_period(
  p_actor_user_id uuid,
  p_break_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start   date;
  v_end     date;
  v_profile text;
  v_recon   jsonb := '{}'::jsonb;
BEGIN
  IF NOT user_is_admin(COALESCE(auth.uid(), p_actor_user_id)) THEN
    RAISE EXCEPTION 'remove_break_period: not authorized'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT start_date, end_date, profile_name
    INTO v_start, v_end, v_profile
    FROM break_periods WHERE break_id = p_break_id;
  IF v_start IS NULL THEN
    RETURN jsonb_build_object('removed', false);
  END IF;

  -- Restore this break's calendar dates to the school-year base.
  UPDATE operating_calendar SET profile_name = 'regular_school_year'
  WHERE date BETWEEN v_start AND v_end AND profile_name = v_profile;

  DELETE FROM break_periods WHERE break_id = p_break_id;

  -- Drop the per-break profile + its config (never a shared profile like short_break).
  IF v_profile LIKE 'b\_%' THEN
    DELETE FROM float_routing WHERE profile_name = v_profile;
    DELETE FROM staffing_patterns WHERE profile_name = v_profile;
    DELETE FROM operating_profiles WHERE profile_name = v_profile;
  END IF;

  -- Reconcile blocks back to the restored school-year config.
  v_recon := reconcile_config_blocks(v_start, v_end);

  RETURN jsonb_build_object('removed', true) || COALESCE(v_recon, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION reconcile_config_blocks(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reconcile_config_blocks(date, date) TO service_role;
REVOKE ALL ON FUNCTION apply_compiled_break(uuid, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_compiled_break(uuid, jsonb, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION remove_break_period(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remove_break_period(uuid, uuid) TO authenticated, service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS apply_compiled_break(uuid, jsonb, boolean);
-- DROP FUNCTION IF EXISTS reconcile_config_blocks(date, date);
-- (remove_break_period revert: restore the integer-returning version from 20260709000001)
