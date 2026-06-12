-- pgTAP: house_closure(house_id, on_date) read-model signal (migration 20260611000005).
-- BSpec §3.4 (Closed Houses) / §11.3 (closed-house display).
--
-- Self-contained: creates its own profiles + operating_calendar dates + staffing_patterns
-- inside BEGIN…ROLLBACK, so it is robust to whatever else is (or isn't) seeded. Uses a
-- distinct test profile name and a test house id so it never collides with seed rows.
--
-- Closure model under test: a house is closed for a date when the date's operating
-- profile has NO positive-headcount staffing_patterns row for that house + NY day_type
-- (mirrors generate_blocks_for_date). Canonical case: winter break -> only Harnwell open.
-- Invariant #6: dates are NY calendar dates; day_type derives from EXTRACT(DOW).
BEGIN;
SELECT plan(11);

-- ---- Profiles (a winter-break-style "only one house open" profile + a regular one) ----
INSERT INTO operating_profiles (
  profile_name, shift_start_bound, shift_end_bound, default_hours_cap,
  default_cap_enforcement, scheduling_mode, float_enabled, escalation_chain,
  claim_phase_open_offset, claim_phase_alert_offset, claim_phase_close_offset
) VALUES
  ('hc_winter','08:00','00:00',40,'hard','claim_based',false,'[]'::jsonb,
   interval '-14 days', interval '-3 days', interval '-1 day'),
  ('hc_regular','08:00','00:00',20,'soft','sm_built',true,'[]'::jsonb,
   NULL, NULL, NULL);

-- ---- Houses under test ----
INSERT INTO houses (id, name) VALUES
  ('hc-open-house','HC Open House'),
  ('hc-closed-house','HC Closed House')
ON CONFLICT (id) DO NOTHING;

-- ---- Calendar: two winter-break dates (a weekday + a weekend) and one regular date ----
-- 2026-12-21 is a Monday (weekday); 2026-12-20 is a Sunday (weekend); 2026-09-14 is a Monday.
INSERT INTO operating_calendar (date, profile_name) VALUES
  ('2026-12-21','hc_winter'),
  ('2026-12-20','hc_winter'),
  ('2026-09-14','hc_regular');
-- 2026-12-25 is intentionally LEFT OUT of operating_calendar (non-operating date).

-- ---- Staffing: in hc_winter ONLY hc-open-house operates; hc-closed-house has NO ROW.
-- In hc_regular both houses operate. ----
INSERT INTO staffing_patterns (profile_name, house_id, day_type, block_headcounts) VALUES
  ('hc_winter','hc-open-house','weekday','[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('hc_winter','hc-open-house','weekend','[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('hc_regular','hc-open-house','weekday','[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('hc_regular','hc-closed-house','weekday','[{"block_start":"08:00","block_end":"00:00","headcount":1}]');

-- ===== Closed: non-operating house during the closure period (canonical §3.4) =====
SELECT is(house_closure('hc-closed-house', DATE '2026-12-21'), true,
  'house with NO winter staffing row is CLOSED on a winter-break weekday (§3.4)');
SELECT is(house_closure('hc-closed-house', DATE '2026-12-20'), true,
  'house with NO winter staffing row is CLOSED on a winter-break weekend');

-- ===== Open: the operational house during the same closure period =====
SELECT is(house_closure('hc-open-house', DATE '2026-12-21'), false,
  'the one open house (Harnwell-analog) is NOT closed on a winter-break weekday');
SELECT is(house_closure('hc-open-house', DATE '2026-12-20'), false,
  'the one open house is NOT closed on a winter-break weekend (day_type resolved)');

-- ===== Open: regular-school-year operating house/date =====
SELECT is(house_closure('hc-open-house', DATE '2026-09-14'), false,
  'an operating house on a regular school-year date is NOT closed');

-- ===== Closed: same house, but the date is non-operating (no calendar row) =====
SELECT is(house_closure('hc-open-house', DATE '2026-12-25'), true,
  'a date with no operating_calendar row is CLOSED for every house (§11.3 closure date)');

-- ===== Closed: regular profile assigns no row for hc-closed-house on a WEEKEND =====
-- hc_regular has only a weekday row for hc-closed-house; 2026-09-13 is a Sunday but is
-- not in the calendar, so it is also a non-operating date -> closed. Add a weekend
-- calendar entry to isolate the day_type-without-staffing path.
INSERT INTO operating_calendar (date, profile_name) VALUES ('2026-09-13','hc_regular');
SELECT is(house_closure('hc-closed-house', DATE '2026-09-13'), true,
  'house with a weekday-only staffing row is CLOSED on a weekend operating date (day_type miss)');
SELECT is(house_closure('hc-closed-house', DATE '2026-09-14'), false,
  'same house IS open on the weekday it has a staffing row');

-- ===== Zero-headcount band counts as closed (no positive-headcount band) =====
INSERT INTO staffing_patterns (profile_name, house_id, day_type, block_headcounts) VALUES
  ('hc_winter','hc-closed-house','weekday','[{"block_start":"08:00","block_end":"00:00","headcount":0}]');
SELECT is(house_closure('hc-closed-house', DATE '2026-12-21'), true,
  'a staffing row with only a 0-headcount band is still CLOSED (matches generator headcount>0)');

-- ===== Authenticated worker can EXECUTE the function (read-model is RLS-safe) =====
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','c0000000-0000-4000-8000-000000000001',
   'authenticated','authenticated','hc.sw@example.test','x', now(), now(), now(),
   '{}'::jsonb, '{}'::jsonb, '', '', '', '');
INSERT INTO users (user_id, name, email, home_house_id, is_active) VALUES
  ('c0000000-0000-4000-8000-000000000001','HC SW','hc.sw@example.test','hc-open-house',true);
INSERT INTO user_roles (user_id, role, scope_house_id) VALUES
  ('c0000000-0000-4000-8000-000000000001','sw',NULL);

DO $$
DECLARE v_closed boolean; v_open boolean;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  -- A worker cannot SELECT operating_calendar / staffing_patterns directly, but the
  -- SECURITY DEFINER function derives the closed flag for it.
  SELECT public.house_closure('hc-closed-house', DATE '2026-12-21') INTO v_closed;
  SELECT public.house_closure('hc-open-house',   DATE '2026-12-21') INTO v_open;
  RESET ROLE;
  PERFORM set_config('test.hc.closed', v_closed::text, true);
  PERFORM set_config('test.hc.open',   v_open::text,   true);
END $$;

SELECT is(current_setting('test.hc.closed')::boolean, true,
  'authenticated worker gets CLOSED=true for the closed house (SECURITY DEFINER read)');
SELECT is(current_setting('test.hc.open')::boolean, false,
  'authenticated worker gets CLOSED=false for the open house');

SELECT finish();
ROLLBACK;
