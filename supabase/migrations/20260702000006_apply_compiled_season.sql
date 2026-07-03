-- Migration: Operating Seasons — apply / reconcile RPC (P6).
--
-- apply_compiled_season(caller, season_id, payload, dry_run) materializes a compiled
-- season (packages/core/src/operating-seasons) into the runtime config tables and
-- reconciles FUTURE blocks against the new configuration. It is the single write
-- path for seasons. dry_run = true runs the identical logic inside a subtransaction
-- that is rolled back, returning the same impact summary the apply would produce —
-- so preview and apply can never drift (docs/operating-seasons/PLAN.md §8–§9).
--
-- Prospective-only: only blocks with block_start_at > app_now() are ever touched.
-- Past / in-progress blocks are immutable history. Config rows are written for the
-- whole season range (harmless for past dates; the orchestrator never revisits them).

-- ============================================================
-- Relax scheduling_periods.profile_name — a summer season is SM-built (§16.1) and
-- needs a scheduling_periods row, so the check (added 20260528000015 to pin periods
-- to regular_school_year) must also admit compiled season profiles (s_<slug>_...).
-- The builder reads staffing per-date via operating_calendar, not the period profile,
-- so this widening changes no school-year behavior.
-- ============================================================
ALTER TABLE scheduling_periods DROP CONSTRAINT IF EXISTS scheduling_periods_profile_check;
ALTER TABLE scheduling_periods ADD CONSTRAINT scheduling_periods_profile_check
  CHECK (profile_name = 'regular_school_year' OR profile_name LIKE 's\_%');

-- ============================================================
-- Helper: the target headcount for one house at one block start, per the CURRENT
-- staffing_patterns + operating_calendar. Returns 0 when the house is closed for
-- that date (no pattern row) or the block falls outside every band → the block
-- should be voided. Mirrors generate_blocks_for_date's band math (00:00 end = 1440).
-- ============================================================
CREATE OR REPLACE FUNCTION season_target_headcount(
  p_house_id text,
  p_block_start_at timestamptz
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS (
    SELECT (p_block_start_at AT TIME ZONE 'America/New_York')::date AS the_date,
           extract(hour   from p_block_start_at AT TIME ZONE 'America/New_York')::int * 60
         + extract(minute from p_block_start_at AT TIME ZONE 'America/New_York')::int AS minute_of_day
  ),
  prof AS (
    SELECT oc.profile_name
    FROM operating_calendar oc, d
    WHERE oc.date = d.the_date
  ),
  bands AS (
    SELECT
      (split_part(band.block_start, ':', 1)::int * 60 + split_part(band.block_start, ':', 2)::int) AS start_min,
      CASE WHEN (split_part(band.block_end, ':', 1)::int * 60 + split_part(band.block_end, ':', 2)::int) = 0
           THEN 1440
           ELSE (split_part(band.block_end, ':', 1)::int * 60 + split_part(band.block_end, ':', 2)::int)
      END AS end_min,
      band.headcount
    FROM prof
    JOIN d ON true
    JOIN staffing_patterns sp
      ON sp.profile_name = prof.profile_name
     AND sp.house_id = p_house_id
     AND sp.day_type = (CASE WHEN extract(dow from d.the_date) IN (0, 6) THEN 'weekend' ELSE 'weekday' END)::day_type_enum
    CROSS JOIN LATERAL jsonb_to_recordset(sp.block_headcounts)
      AS band(block_start text, block_end text, headcount integer)
  )
  SELECT COALESCE(max(headcount), 0)::int
  FROM bands, d
  WHERE d.minute_of_day >= bands.start_min
    AND d.minute_of_day <  bands.end_min;
$$;

-- ============================================================
-- The apply / reconcile RPC.
-- ============================================================
CREATE OR REPLACE FUNCTION apply_compiled_season(
  p_calling_user_id uuid,
  p_season_id uuid,
  p_payload jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now         timestamptz := app_now();
  v_slug        text := p_payload ->> 'slug';
  v_start       date := (p_payload -> 'period' ->> 'startDate')::date;
  v_end         date := (p_payload -> 'period' ->> 'endDate')::date;
  v_phase       jsonb;
  v_house       jsonb;
  v_route       jsonb;
  v_profile     text;
  v_blk         record;
  v_target      integer;
  v_current     integer;
  v_seat_gap    integer;
  v_vacant_removable integer;
  v_occupied_now integer;
  v_gen         record;
  -- impact counters (survive the dry-run rollback: plpgsql vars are non-transactional)
  c_profiles    integer := 0;
  c_blocks_generated integer := 0;
  c_blocks_voided integer := 0;
  c_seats_added integer := 0;
  c_seats_removed integer := 0;
  c_assignments_cancelled integer := 0;
  c_floats_voided integer := 0;
  c_blocks_grandfathered integer := 0;
  -- Skimmable impact detail: WHO loses a shift/float, grouped by house in the UI.
  -- Collect up to a cap (the scalar counts above hold the true totals); a big
  -- closure lists a bounded sample, never thousands of rows.
  c_affected jsonb := '[]'::jsonb;
  c_affected_cap constant integer := 60;
  v_occupied text[] := ARRAY['scheduled', 'claimed', 'floated_in', 'pending_float_in'];
BEGIN
  -- Authorization: admin only.
  IF NOT user_is_admin(p_calling_user_id) THEN
    RAISE EXCEPTION 'apply_compiled_season: caller % is not an administrator', p_calling_user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_slug IS NULL OR v_start IS NULL OR v_end IS NULL THEN
    RAISE EXCEPTION 'apply_compiled_season: payload missing slug/period';
  END IF;

  -- Calendar-collision guard: never clobber school-year (or another season's)
  -- calendar. Any date in range already mapped to a profile NOT owned by THIS
  -- season blocks the apply. Re-applying this season (its own s_<slug>_% rows) is
  -- fine — those are replaced below.
  IF EXISTS (
    SELECT 1 FROM operating_calendar
    WHERE date BETWEEN v_start AND v_end
      AND profile_name NOT LIKE ('s_' || v_slug || '_%')
  ) THEN
    RAISE EXCEPTION 'apply_compiled_season: season range overlaps existing non-season operating_calendar dates'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ----- reconciliation runs inside a rollback-able subtransaction for dry-run -----
  BEGIN
    -- 1. Config rows. Profiles first (FK target for scheduling_periods + patterns).
    FOR v_phase IN SELECT * FROM jsonb_array_elements(p_payload -> 'phases')
    LOOP
      v_profile := v_phase ->> 'profileName';
      c_profiles := c_profiles + 1;

      INSERT INTO operating_profiles (
        profile_name, shift_start_bound, shift_end_bound, default_hours_cap,
        default_cap_enforcement, scheduling_mode, float_enabled, escalation_chain,
        claim_phase_open_offset, claim_phase_alert_offset, claim_phase_close_offset
      )
      VALUES (
        v_profile,
        (v_phase ->> 'shiftStartBound')::time,
        (v_phase ->> 'shiftEndBound')::time,
        (v_phase ->> 'hoursCap')::int,
        (v_phase ->> 'capEnforcement')::cap_enforcement_enum,
        (v_phase ->> 'schedulingMode')::scheduling_mode_enum,
        (v_phase ->> 'floatEnabled')::boolean,
        v_phase -> 'escalationChain',
        NULL, NULL, NULL
      )
      ON CONFLICT (profile_name) DO UPDATE SET
        shift_start_bound = EXCLUDED.shift_start_bound,
        shift_end_bound = EXCLUDED.shift_end_bound,
        default_hours_cap = EXCLUDED.default_hours_cap,
        default_cap_enforcement = EXCLUDED.default_cap_enforcement,
        scheduling_mode = EXCLUDED.scheduling_mode,
        float_enabled = EXCLUDED.float_enabled,
        escalation_chain = EXCLUDED.escalation_chain;

      -- Staffing patterns: replace this profile's rows (both day types, same bands).
      DELETE FROM staffing_patterns WHERE profile_name = v_profile;
      FOR v_house IN SELECT * FROM jsonb_array_elements(v_phase -> 'houses')
      LOOP
        -- Per-day-type bands: a house with an empty band array for a day type is
        -- closed that day type (e.g. weekdays-only => no weekend row => no weekend
        -- blocks generated). Omit the row when the array is empty.
        IF jsonb_array_length(COALESCE(v_house -> 'weekdayBands', '[]'::jsonb)) > 0 THEN
          INSERT INTO staffing_patterns (profile_name, house_id, day_type, block_headcounts)
          VALUES (v_profile, v_house ->> 'houseId', 'weekday', v_house -> 'weekdayBands');
        END IF;
        IF jsonb_array_length(COALESCE(v_house -> 'weekendBands', '[]'::jsonb)) > 0 THEN
          INSERT INTO staffing_patterns (profile_name, house_id, day_type, block_headcounts)
          VALUES (v_profile, v_house ->> 'houseId', 'weekend', v_house -> 'weekendBands');
        END IF;
      END LOOP;

      -- Float routing: replace this profile's rows.
      DELETE FROM float_routing WHERE profile_name = v_profile;
      FOR v_route IN SELECT * FROM jsonb_array_elements(v_phase -> 'floatRouting')
      LOOP
        INSERT INTO float_routing (profile_name, source_house_id, destination_house_id, precedence_order)
        VALUES (
          v_profile,
          v_route ->> 'sourceHouseId',
          v_route ->> 'destinationHouseId',
          (v_route ->> 'precedenceOrder')::int
        );
      END LOOP;
    END LOOP;

    -- 2. scheduling_periods (one row, anchored on the first phase profile).
    INSERT INTO scheduling_periods (period_id, period_name, profile_name, start_date, end_date, preference_deadline, published_at)
    VALUES (
      p_season_id,
      p_payload -> 'period' ->> 'periodName',
      p_payload -> 'period' ->> 'profileName',
      v_start, v_end, NULL, NULL
    )
    ON CONFLICT (period_id) DO UPDATE SET
      period_name = EXCLUDED.period_name,
      profile_name = EXCLUDED.profile_name,
      start_date = EXCLUDED.start_date,
      end_date = EXCLUDED.end_date;

    -- 3. operating_calendar: rewrite this season's date range.
    DELETE FROM operating_calendar WHERE date BETWEEN v_start AND v_end;
    FOR v_phase IN SELECT * FROM jsonb_array_elements(p_payload -> 'phases')
    LOOP
      INSERT INTO operating_calendar (date, profile_name)
      SELECT gs::date, v_phase ->> 'profileName'
      FROM generate_series((v_phase ->> 'startDate')::date, (v_phase ->> 'endDate')::date, interval '1 day') AS gs
      ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;
    END LOOP;

    -- 4. Generate any missing blocks for newly-open houses/dates (idempotent; skips
    -- existing blocks). Only counts blocks whose start is in the future.
    -- Existing (past) blocks already exist, so on a season spanning `now` this
    -- inserts only the genuinely-missing (future / newly-open) blocks.
    SELECT * INTO v_gen FROM generate_blocks_for_range(v_start, v_end);
    c_blocks_generated := COALESCE(v_gen.blocks_inserted, 0);

    -- 5. Reconcile EXISTING future blocks in range against the new config.
    FOR v_blk IN
      SELECT sb.block_id, sb.house_id, sb.block_start_at, sb.required_headcount, sb.voided_at
      FROM shift_blocks sb
      WHERE sb.block_start_at > v_now
        AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN v_start AND v_end
    LOOP
      v_target := season_target_headcount(v_blk.house_id, v_blk.block_start_at);

      IF v_target = 0 THEN
        -- House closed (or block now outside desk hours) → VOID this future block.
        IF v_blk.voided_at IS NULL THEN
          -- Notify + cancel occupied seats.
          INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
          SELECT a.user_id, 'personal_shift', v_now,
                 jsonb_build_object(
                   'kind', 'shift_cancelled_config',
                   'house_id', v_blk.house_id,
                   'block_start_at', v_blk.block_start_at
                 )
          FROM shift_block_assignments a
          WHERE a.block_id = v_blk.block_id
            AND a.user_id IS NOT NULL
            AND a.status = ANY (v_occupied::shift_status_enum[]);

          GET DIAGNOSTICS v_seat_gap = ROW_COUNT;
          c_assignments_cancelled := c_assignments_cancelled + v_seat_gap;

          -- Capture a capped sample of WHO loses a shift (name + house + when) for
          -- the skimmable impact list; the count above holds the true total.
          IF v_seat_gap > 0 AND jsonb_array_length(c_affected) < c_affected_cap THEN
            c_affected := c_affected || COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'house', h.name,
                       'worker', u.name,
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

          -- Void inbound floats whose destination lands on this block. Capture the
          -- affected floaters for the impact list first (before the status flip).
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
        -- House open this date. Un-void if it was voided by an earlier apply.
        IF v_blk.voided_at IS NOT NULL THEN
          UPDATE shift_blocks SET voided_at = NULL, required_headcount = v_target
          WHERE block_id = v_blk.block_id;
          v_current := 0;
        ELSE
          v_current := v_blk.required_headcount;
        END IF;

        IF v_target > v_current THEN
          UPDATE shift_blocks SET required_headcount = v_target WHERE block_id = v_blk.block_id;
          -- Add vacant seats so the live block reaches the new headcount. Count
          -- existing NON-cancelled seat rows to avoid double-adding on re-apply.
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
          -- Trim excess VACANT never-assigned seats (occupied seats grandfathered).
          SELECT count(*) INTO v_occupied_now
          FROM shift_block_assignments
          WHERE block_id = v_blk.block_id AND status = ANY (v_occupied::shift_status_enum[]);

          v_vacant_removable := GREATEST(0,
            (SELECT count(*) FROM shift_block_assignments
             WHERE block_id = v_blk.block_id AND status = 'vacant')
          );
          -- Remove down to max(target - occupied, 0) remaining vacant seats.
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

          IF v_occupied_now > v_target THEN
            c_blocks_grandfathered := c_blocks_grandfathered + 1;
          END IF;
        END IF;
      END IF;
    END LOOP;

    -- Audit row (only persists on a real apply; rolled back with the rest on dry-run).
    INSERT INTO operating_config_audit (season_id, action, applied_by, payload, impact)
    VALUES (
      p_season_id,
      CASE WHEN p_dry_run THEN 'preview' ELSE 'apply' END,
      p_calling_user_id,
      p_payload,
      jsonb_build_object(
        'profiles', c_profiles,
        'blocks_generated', c_blocks_generated,
        'blocks_voided', c_blocks_voided,
        'seats_added', c_seats_added,
        'seats_removed', c_seats_removed,
        'assignments_cancelled', c_assignments_cancelled,
        'floats_voided', c_floats_voided,
        'blocks_grandfathered', c_blocks_grandfathered
      )
    );

    -- On the season header, stamp last_applied_at for a real apply.
    IF NOT p_dry_run THEN
      UPDATE operating_seasons SET last_applied_at = v_now WHERE season_id = p_season_id;
    END IF;

    IF p_dry_run THEN
      -- Roll the whole subtransaction back but keep the counters.
      RAISE EXCEPTION 'DRY_RUN' USING ERRCODE = 'PT001';
    END IF;

  EXCEPTION
    WHEN SQLSTATE 'PT001' THEN
      -- dry-run sentinel: swallow; DB changes rolled back, counters retained.
      NULL;
  END;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'season_id', p_season_id,
    'profiles', c_profiles,
    'blocks_generated', c_blocks_generated,
    'blocks_voided', c_blocks_voided,
    'seats_added', c_seats_added,
    'seats_removed', c_seats_removed,
    'assignments_cancelled', c_assignments_cancelled,
    'floats_voided', c_floats_voided,
    'blocks_grandfathered', c_blocks_grandfathered,
    -- Capped sample of affected workers (name / house / when / kind) for a
    -- skimmable "who is impacted" list; totals above are authoritative.
    'affected_workers', c_affected
  );
END;
$$;

REVOKE ALL ON FUNCTION apply_compiled_season(uuid, uuid, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_compiled_season(uuid, uuid, jsonb, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION season_target_headcount(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION season_target_headcount(text, timestamptz) TO authenticated, service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS apply_compiled_season(uuid, uuid, jsonb, boolean);
-- DROP FUNCTION IF EXISTS season_target_headcount(text, timestamptz);
