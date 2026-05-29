-- pgTAP routing edge cases (C6a): the deployed notification-routing logic is the
-- SQL primitives (is_hm_working_time, hmod_interval_start_date, resolve_*).
-- These port the boundary / leave-anchoring cases from the removed TS
-- notification-routing test onto the canonical SQL functions.

BEGIN;

SELECT plan(11);

-- A known Monday for constructing weekday/weekend moments (NY local).
SELECT set_config('test.re.mon', date_trunc('week', DATE '2031-09-15')::text, false);

-- helper: NY-local timestamptz at <mon + d days> <h>:00
-- (inlined per assertion below).

-- 1-4. is_hm_working_time boundaries (Mon-Fri [08:00,17:00)).
SELECT is(
  public.is_hm_working_time(((current_setting('test.re.mon')::date)::timestamp + interval '8 hours') AT TIME ZONE 'America/New_York'),
  true, 'Mon 08:00 is HM working time (inclusive start)');

SELECT is(
  public.is_hm_working_time(((current_setting('test.re.mon')::date)::timestamp + interval '17 hours') AT TIME ZONE 'America/New_York'),
  false, 'Mon 17:00 is NOT HM working time (exclusive end -> HMOD)');

SELECT is(
  public.is_hm_working_time(((current_setting('test.re.mon')::date)::timestamp + interval '12 hours') AT TIME ZONE 'America/New_York'),
  true, 'Mon 12:00 is HM working time');

SELECT is(
  public.is_hm_working_time(((current_setting('test.re.mon')::date)::timestamp + interval '5 days' + interval '12 hours') AT TIME ZONE 'America/New_York'),
  false, 'Saturday 12:00 is NOT HM working time (weekend -> HMOD)');

-- 5-7. hmod_interval_start_date attribution.
SELECT is(
  public.hmod_interval_start_date(((current_setting('test.re.mon')::date)::timestamp + interval '5 days' + interval '12 hours') AT TIME ZONE 'America/New_York'),
  (current_setting('test.re.mon')::date + 4),
  'weekend (Sat) interval is attributed to the Friday');

SELECT is(
  public.hmod_interval_start_date(((current_setting('test.re.mon')::date)::timestamp + interval '1 day' + interval '20 hours') AT TIME ZONE 'America/New_York'),
  (current_setting('test.re.mon')::date + 1),
  'weekday evening (Tue 20:00) interval is attributed to Tuesday');

SELECT is(
  public.hmod_interval_start_date(((current_setting('test.re.mon')::date)::timestamp + interval '2 days' + interval '2 hours') AT TIME ZONE 'America/New_York'),
  (current_setting('test.re.mon')::date + 1),
  'weekday early morning (Wed 02:00) belongs to the prior day''s 17:00 interval (Tuesday)');

-- 8-11. Leave anchoring via resolve_hmod_on_duty: a weekend moment resolves to
-- the rotor HMOD; if that HMOD is on leave on the interval-start (Friday), the
-- replacement is returned.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('e0000770-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','re-hmod@test.local'),
  ('e0000770-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','re-repl@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('e0000770-0000-0000-0000-000000000001','RE HMOD','re-hmod@test.local','harnwell',true),
  ('e0000770-0000-0000-0000-000000000002','RE Repl','re-repl@test.local','harnwell',true);
INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('e0000770-0000-0000-0000-000000000001','hm','harnwell'),
  ('e0000770-0000-0000-0000-000000000002','bm','harnwell');

-- Rotor: the Friday opening the week of the Saturday moment.
INSERT INTO public.hmod_rotor (week_start_date, hmod_user_id)
VALUES (current_setting('test.re.mon')::date + 4, 'e0000770-0000-0000-0000-000000000001');

-- A Saturday 03:00 moment (deep in the weekend interval).
SELECT set_config('test.re.sat',
  (((current_setting('test.re.mon')::date)::timestamp + interval '5 days' + interval '3 hours')
    AT TIME ZONE 'America/New_York')::text, false);

-- No leave yet: resolves to the rotor HMOD.
SELECT is(
  public.resolve_hmod_on_duty(current_setting('test.re.sat')::timestamptz),
  'e0000770-0000-0000-0000-000000000001'::uuid,
  'weekend resolves to the rotor HMOD');

-- HMOD on leave covering the Friday interval-start date -> replacement.
INSERT INTO public.hm_leave (user_id, start_date, end_date, replacement_user_id, status)
VALUES ('e0000770-0000-0000-0000-000000000001',
        current_setting('test.re.mon')::date + 4, current_setting('test.re.mon')::date + 6,
        'e0000770-0000-0000-0000-000000000002', 'active');

SELECT is(
  public.resolve_hmod_on_duty(current_setting('test.re.sat')::timestamptz),
  'e0000770-0000-0000-0000-000000000002'::uuid,
  'HMOD on leave on the interval-start Friday -> replacement (C2 anchoring)');

-- A Saturday-only leave (NOT covering the Friday interval start) does NOT
-- transfer the weekend interval (start-date-based attribution).
UPDATE public.hm_leave
SET start_date = current_setting('test.re.mon')::date + 5
WHERE user_id = 'e0000770-0000-0000-0000-000000000001';

SELECT is(
  public.resolve_hmod_on_duty(current_setting('test.re.sat')::timestamptz),
  'e0000770-0000-0000-0000-000000000001'::uuid,
  'Saturday-only leave does not transfer the weekend interval (anchored to Friday)');

-- is_hm_working_time at the Friday 08:00 rotor handoff is still HM time.
SELECT is(
  public.is_hm_working_time(((current_setting('test.re.mon')::date)::timestamp + interval '4 days' + interval '8 hours') AT TIME ZONE 'America/New_York'),
  true, 'Friday 08:00 is HM working time');

SELECT finish();
ROLLBACK;
