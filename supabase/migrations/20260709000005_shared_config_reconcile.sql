-- Migration: dedupe the block generate/reconcile engine.
--
-- apply_compiled_season (20260702000006, updated by 20260709000003) and the break
-- apply path (20260709000004) each carried a ~150-line copy of the same generate +
-- reconcile + cancel-excess logic. 20260709000004 factored that into
-- reconcile_config_blocks(start, end). This redefines apply_compiled_season to CALL
-- that shared helper instead of its inline copy, so the two apply paths reconcile
-- blocks through one implementation. Pure refactor: behavior is identical to
-- 20260709000003 (config materialization unchanged; reconcile/cancel-excess semantics
-- unchanged — they now live in reconcile_config_blocks). The season's own bits
-- (s_<slug> collision guard, scheduling_periods upsert, operating_config_audit,
-- last_applied_at) stay inline here.

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
  v_now      timestamptz := app_now();
  v_slug     text := p_payload ->> 'slug';
  v_start    date := (p_payload -> 'period' ->> 'startDate')::date;
  v_end      date := (p_payload -> 'period' ->> 'endDate')::date;
  v_phase    jsonb;
  v_house    jsonb;
  v_route    jsonb;
  v_profile  text;
  v_recon    jsonb := '{}'::jsonb;
  c_profiles integer := 0;
BEGIN
  -- Authorization: admin only.
  IF NOT user_is_admin(p_calling_user_id) THEN
    RAISE EXCEPTION 'apply_compiled_season: caller % is not an administrator', p_calling_user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_slug IS NULL OR v_start IS NULL OR v_end IS NULL THEN
    RAISE EXCEPTION 'apply_compiled_season: payload missing slug/period';
  END IF;

  -- Calendar-collision guard: never clobber school-year (or another season's) calendar.
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

      DELETE FROM staffing_patterns WHERE profile_name = v_profile;
      FOR v_house IN SELECT * FROM jsonb_array_elements(v_phase -> 'houses')
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

    -- 4. Generate + reconcile future blocks against the new config via the SHARED
    --    engine (identical logic to the break apply path).
    v_recon := reconcile_config_blocks(v_start, v_end);

    -- 5. Audit row (persists on real apply; rolled back with the rest on dry-run).
    INSERT INTO operating_config_audit (season_id, action, applied_by, payload, impact)
    VALUES (
      p_season_id,
      CASE WHEN p_dry_run THEN 'preview' ELSE 'apply' END,
      p_calling_user_id,
      p_payload,
      jsonb_build_object('profiles', c_profiles) || (v_recon - 'affected_workers')
    );

    IF NOT p_dry_run THEN
      UPDATE operating_seasons SET last_applied_at = v_now WHERE season_id = p_season_id;
    END IF;

    IF p_dry_run THEN
      RAISE EXCEPTION 'DRY_RUN' USING ERRCODE = 'PT001';
    END IF;

  EXCEPTION
    WHEN SQLSTATE 'PT001' THEN
      NULL;  -- dry-run sentinel: swallow; DB changes rolled back, counters retained.
  END;

  RETURN jsonb_build_object('dry_run', p_dry_run, 'season_id', p_season_id, 'profiles', c_profiles)
         || v_recon;
END;
$$;

-- rollback:
-- (restore the inline-reconcile body from 20260709000003.)
