-- pgTAP: break_periods worker-facing SELECT policy (migration 20260611000002).
-- Self-contained: creates its own actor + operating_profile + break_period inside
-- BEGIN…ROLLBACK, so it is robust to whatever else is (or isn't) seeded. Verifies an
-- authenticated worker can read the active break period (name + window) and that the
-- policy grants READ ONLY — no write path opens to authenticated.
-- Auth context follows phase-04-rls.sql: a DO block sets request.jwt.claims.sub +
-- SET LOCAL ROLE authenticated, runs the probe, captures the result via set_config,
-- RESET ROLE, and the assertion runs outside as the (superuser) test role.
BEGIN;
SELECT plan(8);

-- ---- Actor (one harnwell SW) ----
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-4000-8000-000000000001',
   'authenticated','authenticated','bp.sw@example.test','x', now(), now(), now(),
   '{}'::jsonb, '{}'::jsonb, '', '', '', '');

INSERT INTO users (user_id, name, email, home_house_id, is_active) VALUES
  ('b0000000-0000-4000-8000-000000000001','BP SW','bp.sw@example.test','harnwell',true);

INSERT INTO user_roles (user_id, role, scope_house_id) VALUES
  ('b0000000-0000-4000-8000-000000000001','sw',NULL);

-- ---- Operating profile + two break periods (a winter break and a short break) ----
INSERT INTO operating_profiles (
  profile_name, shift_start_bound, shift_end_bound, default_hours_cap,
  default_cap_enforcement, scheduling_mode, float_enabled, escalation_chain,
  claim_phase_open_offset, claim_phase_alert_offset, claim_phase_close_offset
) VALUES
  ('bp_test_profile','08:00','00:00',40,'hard','claim_based',false,
   '[]'::jsonb, interval '-14 days', interval '-3 days', interval '-1 day');

INSERT INTO break_periods (break_id, break_name, break_type, start_date, end_date, profile_name) VALUES
  ('b0000000-0000-4000-c000-000000000001','Winter Break 2026','winter_break','2026-12-20','2027-01-04','bp_test_profile'),
  ('b0000000-0000-4000-c000-000000000002','Thanksgiving 2026','thanksgiving','2026-11-25','2026-11-29','bp_test_profile');

-- ===== Authenticated worker: SELECT (name + window) =====
DO $$
DECLARE
  v_count int; v_name text; v_type text; v_start date; v_end date;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO v_count FROM public.break_periods
    WHERE break_id IN ('b0000000-0000-4000-c000-000000000001','b0000000-0000-4000-c000-000000000002');
  SELECT break_name, break_type::text, start_date, end_date
    INTO v_name, v_type, v_start, v_end
    FROM public.break_periods WHERE break_id='b0000000-0000-4000-c000-000000000001';
  RESET ROLE;
  PERFORM set_config('test.bp.count', v_count::text, true);
  PERFORM set_config('test.bp.name', v_name, true);
  PERFORM set_config('test.bp.type', v_type, true);
  PERFORM set_config('test.bp.start', v_start::text, true);
  PERFORM set_config('test.bp.end', v_end::text, true);
END $$;

SELECT is(current_setting('test.bp.count')::int, 2,
  'worker sees both fixture break periods (authenticated SELECT policy grants read)');
SELECT is(current_setting('test.bp.name'), 'Winter Break 2026', 'worker reads the break NAME');
SELECT is(current_setting('test.bp.type'), 'winter_break',
  'worker reads break_type (drives the "only Harnwell open" copy)');
SELECT is(current_setting('test.bp.start')::date, DATE '2026-12-20', 'worker reads the window start_date');
SELECT is(current_setting('test.bp.end')::date, DATE '2027-01-04', 'worker reads the window end_date');

-- ===== Authenticated worker: NO write path (read-only policy) =====
-- INSERT is blocked by RLS → error 42501; UPDATE/DELETE under a read-only policy match
-- zero rows (RLS filters the target set silently rather than raising).
DO $$
DECLARE v_ins text; v_upd int; v_del int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO public.break_periods (break_id, break_name, break_type, start_date, end_date, profile_name)
    VALUES ('b0000000-0000-4000-c000-000000000099','Hacked','other','2027-03-01','2027-03-05','bp_test_profile');
    v_ins := 'allowed';
  EXCEPTION WHEN insufficient_privilege THEN v_ins := 'blocked';
  END;

  WITH u AS (
    UPDATE public.break_periods SET break_name='tampered'
    WHERE break_id='b0000000-0000-4000-c000-000000000001' RETURNING 1)
  SELECT count(*)::int INTO v_upd FROM u;

  WITH d AS (
    DELETE FROM public.break_periods
    WHERE break_id='b0000000-0000-4000-c000-000000000002' RETURNING 1)
  SELECT count(*)::int INTO v_del FROM d;

  RESET ROLE;
  PERFORM set_config('test.bp.ins', v_ins, true);
  PERFORM set_config('test.bp.upd', v_upd::text, true);
  PERFORM set_config('test.bp.del', v_del::text, true);
END $$;

SELECT is(current_setting('test.bp.ins'), 'blocked',
  'authenticated worker CANNOT INSERT a break period (no write policy → 42501)');
SELECT is(current_setting('test.bp.upd')::int, 0,
  'authenticated worker UPDATE affects 0 rows (no write policy — RLS filters target)');
SELECT is(current_setting('test.bp.del')::int, 0,
  'authenticated worker DELETE affects 0 rows (no write policy — RLS filters target)');

SELECT finish();
ROLLBACK;
