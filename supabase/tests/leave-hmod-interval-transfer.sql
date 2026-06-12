-- pgTAP: §2.6 #136-138 — HMOD on-duty interval TRANSFER on HM/BM leave.
--
-- PINNING test: the transfer was already wired (resolve_hmod_on_duty passes
-- hmod_interval_start_date(p_at) into resolve_hm_for_user, so the on-duty HMOD
-- resolves through hm_leave anchored to the interval's START date). This test
-- locks that behavior so a future refactor cannot silently drop it.
--
-- Rules under test (§2.6 #136-138):
--   • Start-date-based: an HMOD on-duty interval whose START moment falls on a
--     leave date transfers to the replacement.
--   • Weekend continuous interval (Fri 17:00 -> Mon 08:00) belongs to Friday: if
--     Friday is a leave date the WHOLE weekend transfers; if Friday is NOT a leave
--     date the weekend stays with the original HMOD even when some weekend days are
--     leave dates.
--   • Weekday overnight interval (Tue 17:00 -> Wed 08:00) belongs to Tuesday: a
--     Wednesday-only leave does NOT transfer the Tuesday-evening interval.
--
-- Anchor week: Friday 2099-01-02 is the duty-week start (isodow 5). The HMOD of the
-- week is HMOD_ORIG; the leave replacement is HMOD_REPL.

BEGIN;

SELECT plan(6);

-- Fixtures: two HM/BMs eligible to be HMOD, in distinct houses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('c1000006-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hmod-orig@test.local'),
  ('c1000006-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hmod-repl@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('c1000006-0000-0000-0000-0000000000a1','HMOD Orig','hmod-orig@test.local','quad',true),
  ('c1000006-0000-0000-0000-0000000000b1','HMOD Repl','hmod-repl@test.local','house-03',true);

INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('c1000006-0000-0000-0000-0000000000a1','hm','quad'),
  ('c1000006-0000-0000-0000-0000000000b1','hm','house-03');

-- Rotor: HMOD_ORIG owns the duty week starting Friday 2099-01-02 (isodow 5).
INSERT INTO public.hmod_rotor (week_start_date, hmod_user_id)
VALUES (DATE '2099-01-02', 'c1000006-0000-0000-0000-0000000000a1')
ON CONFLICT (week_start_date) DO UPDATE SET hmod_user_id = EXCLUDED.hmod_user_id;

-- ===========================================================================
-- A. No leave: the on-duty HMOD at a weekend moment is HMOD_ORIG.
--    Saturday 2099-01-03 20:00 NY — inside the weekend continuous interval.
-- ===========================================================================
SELECT is(
  resolve_hmod_on_duty(timestamptz '2099-01-03 20:00:00-05'),
  'c1000006-0000-0000-0000-0000000000a1'::uuid,
  'baseline: weekend HMOD resolves to the rotor HMOD when no leave');

-- ===========================================================================
-- B. Leave covering the FRIDAY (2099-01-02) anchoring the weekend interval ->
--    the entire weekend (incl. Saturday) transfers to HMOD_REPL.
-- ===========================================================================
INSERT INTO public.hm_leave (leave_id, user_id, start_date, end_date, replacement_user_id, status)
VALUES ('c1100006-0000-0000-0000-000000000001',
        'c1000006-0000-0000-0000-0000000000a1', DATE '2099-01-02', DATE '2099-01-02',
        'c1000006-0000-0000-0000-0000000000b1', 'active');

SELECT is(
  resolve_hmod_on_duty(timestamptz '2099-01-02 20:00:00-05'),
  'c1000006-0000-0000-0000-0000000000b1'::uuid,
  'Friday-evening interval transfers to the replacement when Friday is a leave date (#136)');

SELECT is(
  resolve_hmod_on_duty(timestamptz '2099-01-03 20:00:00-05'),
  'c1000006-0000-0000-0000-0000000000b1'::uuid,
  'the whole weekend (Saturday) transfers because the Fri-anchored interval belongs to Friday (#136)');

-- Cleanup B.
DELETE FROM public.hm_leave WHERE leave_id = 'c1100006-0000-0000-0000-000000000001';

-- ===========================================================================
-- C. Leave covering only SUNDAY (2099-01-04), NOT the Friday -> the weekend
--    interval stays with HMOD_ORIG (it belongs to Friday, not the leave date).
-- ===========================================================================
INSERT INTO public.hm_leave (leave_id, user_id, start_date, end_date, replacement_user_id, status)
VALUES ('c1100006-0000-0000-0000-000000000002',
        'c1000006-0000-0000-0000-0000000000a1', DATE '2099-01-04', DATE '2099-01-04',
        'c1000006-0000-0000-0000-0000000000b1', 'active');

SELECT is(
  resolve_hmod_on_duty(timestamptz '2099-01-04 02:00:00-05'),
  'c1000006-0000-0000-0000-0000000000a1'::uuid,
  'Sunday-only leave does NOT transfer the weekend interval (it belongs to Friday) (#136)');

-- Cleanup C.
DELETE FROM public.hm_leave WHERE leave_id = 'c1100006-0000-0000-0000-000000000002';

-- ===========================================================================
-- D. Weekday overnight: Tue 2099-01-06 17:00 -> Wed 08:00 belongs to Tuesday.
--    A WEDNESDAY-only leave must NOT transfer the Tuesday-evening interval;
--    a TUESDAY leave DOES transfer it. We sample Wed 02:00 (still inside the
--    Tuesday-anchored overnight interval) for both.
-- ===========================================================================
-- D1: Wednesday-only leave -> interval stays with original.
INSERT INTO public.hm_leave (leave_id, user_id, start_date, end_date, replacement_user_id, status)
VALUES ('c1100006-0000-0000-0000-000000000003',
        'c1000006-0000-0000-0000-0000000000a1', DATE '2099-01-07', DATE '2099-01-07',
        'c1000006-0000-0000-0000-0000000000b1', 'active');

SELECT is(
  resolve_hmod_on_duty(timestamptz '2099-01-07 02:00:00-05'),
  'c1000006-0000-0000-0000-0000000000a1'::uuid,
  'Wednesday-only leave does NOT transfer the Tuesday-anchored overnight interval (#136)');

DELETE FROM public.hm_leave WHERE leave_id = 'c1100006-0000-0000-0000-000000000003';

-- D2: Tuesday leave -> the same overnight interval (sampled Wed 02:00) transfers.
INSERT INTO public.hm_leave (leave_id, user_id, start_date, end_date, replacement_user_id, status)
VALUES ('c1100006-0000-0000-0000-000000000004',
        'c1000006-0000-0000-0000-0000000000a1', DATE '2099-01-06', DATE '2099-01-06',
        'c1000006-0000-0000-0000-0000000000b1', 'active');

SELECT is(
  resolve_hmod_on_duty(timestamptz '2099-01-07 02:00:00-05'),
  'c1000006-0000-0000-0000-0000000000b1'::uuid,
  'Tuesday leave transfers the Tuesday-anchored overnight interval (sampled in Wed early-morning) (#136)');

SELECT finish();
ROLLBACK;
