-- Migration: HMOD duty-week boundary moves from Monday 08:00 to Friday 08:00
--
-- The HMOD duty week now runs Friday 08:00 (inclusive) through the following
-- Friday 08:00 (exclusive), instead of Monday 08:00 → next Monday 07:59.
-- This places the weekend continuous interval (Fri 17:00 → Mon 08:00) — the
-- heaviest HMOD duty — at the START of a rotor week rather than split across
-- the old Monday handoff, so one HMOD owns a weekend plus the following four
-- weekday evenings without a mid-weekend rotation.
--
-- The HMOD on-duty HOURS are unchanged (weekday 17:00→midnight; weekend
-- Fri 17:00 → Mon 08:00). Only the rotor ROTATION cadence and the meaning of
-- hmod_rotor.week_start_date (now a Friday) change.
--
-- Supersedes the date_trunc('week') (Monday) lookup in
-- 20260528000004_phase_07_no_ack_rpc_fixes.sql. Resolves audit finding
-- F-07-001 (C1) and F-01-015 (E7, rotor half).

-- hmod_rotor.week_start_date is now the Friday 08:00 of the duty week.
COMMENT ON COLUMN hmod_rotor.week_start_date IS
  'the Friday 08:00 of the HMOD duty week (Fri 08:00 inclusive -> next Fri 08:00 exclusive)';

-- Pin rotor rows to Fridays (isodow 5). weekly_cap_overrides keeps its
-- Monday anchor — that is the hours/cap week, unrelated to HMOD duty.
ALTER TABLE hmod_rotor
  ADD CONSTRAINT hmod_rotor_week_start_friday_check
  CHECK (extract(isodow FROM week_start_date) = 5);

-- Resolve the on-duty HMOD via hmod_rotor for the Friday-anchored duty week
-- containing the given moment, walking hm_leave on the rotor's HMOD if
-- applicable.
CREATE OR REPLACE FUNCTION resolve_hmod_on_duty(p_at timestamptz)
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_shifted_date    date;
  v_week_start_date date;
  v_hmod_user_id    uuid;
BEGIN
  -- Subtract 8h so the 08:00 boundary lands at midnight, then snap back to
  -- the most recent Friday (isodow 5). A moment Fri 00:00-07:59 maps to the
  -- previous Friday's rotor row; Fri 08:00 onward maps to the new week.
  v_shifted_date := (
    (p_at AT TIME ZONE 'America/New_York') - interval '8 hours'
  )::date;

  v_week_start_date := v_shifted_date
    - (((extract(isodow FROM v_shifted_date)::int + 2) % 7));

  SELECT hmod_user_id
    INTO v_hmod_user_id
  FROM hmod_rotor
  WHERE week_start_date = v_week_start_date;

  IF v_hmod_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN resolve_hm_for_user(v_hmod_user_id, p_at);
END;
$$;

-- rollback:
-- ALTER TABLE hmod_rotor DROP CONSTRAINT IF EXISTS hmod_rotor_week_start_friday_check;
-- (resolve_hmod_on_duty would need its Monday-anchored body restored from
--  20260528000004_phase_07_no_ack_rpc_fixes.sql)
