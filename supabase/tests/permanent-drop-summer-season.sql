-- pgTAP: a recurring slot inside a SUMMER SEASON is permanently droppable.
--
-- Regression for the 2026-07-29 defect. `permanent_drop_slot` resolved its boundary with
-- `profile_name = 'regular_school_year'` and filtered occurrences the same way, both
-- written when `scheduling_periods` only ever held school-year terms. 20260702000006
-- widened that column to admit compiled `s_%` season profiles (summer is SM-built and
-- needs a period row), but the drop was never updated -- so inside a summer season it
-- raised `semester_boundary_not_found` for a date sitting INSIDE the current period, the
-- worker's seats stayed assigned, and the shift reached nobody. Fixed by
-- 20260729000003: the boundary is the current-or-upcoming period whatever its profile,
-- and the occurrence filter is stated as `operating_profiles.scheduling_mode =
-- 'sm_built'`.
--
-- The mode filter is the load-bearing half. Deleting the profile predicate outright
-- passes THIS suite but regresses phase-10-bulk-ops test 14 (an embedded break day must
-- stay excluded, BSpec §8.4.1), so section C below pins that too -- inside a season, not
-- inside a semester, which is the case phase-10 cannot reach.
--
-- Spec: BEHAVIORAL_SPECIFICATION.md §8.4.1 ("Summer seasons are in scope"),
--       ARCHITECTURE.md §7.1 (period-boundary resolution + the sm_built occurrence
--       filter), §2.10 (scheduling_periods.profile_name is any SM-built profile).
-- Run with: supabase test db

BEGIN;

SELECT plan(8);

-- ============================================================
-- 0. Fixtures. Anchor: Sunday 2028-07-02 09:00 America/New_York (EDT).
--    2028 is clear of the seed's Summer 2026 period and phase-10's Fall 2027 one,
--    which matters because scheduling_periods carries a no-overlap exclusion.
--    09:00 local keeps each block's UTC-slice date equal to its NY calendar date.
-- ============================================================

SELECT set_config(
  'test.pdss.anchor',
  ('2028-07-02 09:00'::timestamp AT TIME ZONE 'America/New_York')::text,
  false
);

-- Guard the fixture's own premise: the anchor really is a Sunday (DOW 0).
SELECT is(
  EXTRACT(DOW FROM current_setting('test.pdss.anchor')::timestamptz
                     AT TIME ZONE 'America/New_York')::integer,
  0,
  'fixture: the anchor is a Sunday, so day_of_week = 0 identifies the slot'
);

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('0d000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'pdss-dropper@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES ('0d000001-0000-0000-0000-000000000001', 'Summer Dropper', 'pdss-dropper@test.local',
        'harrison', true);

-- A compiled season profile (sm_built, like every `s_%` phase the season compiler
-- emits) plus a claim-based break profile for section C.
INSERT INTO public.operating_profiles
  (profile_name, shift_start_bound, shift_end_bound, default_hours_cap,
   default_cap_enforcement, scheduling_mode, float_enabled, escalation_chain,
   claim_phase_open_offset, claim_phase_alert_offset, claim_phase_close_offset)
VALUES
  ('s_test2028_20280601', '08:00', '00:00', 20, 'soft', 'sm_built', true, '[]'::jsonb,
   NULL, NULL, NULL),
  ('pdss_break', '08:00', '00:00', 40, 'hard', 'claim_based', false, '[]'::jsonb,
   '-14 days'::interval, '-3 days'::interval, '-1 day'::interval)
ON CONFLICT (profile_name) DO NOTHING;

-- Season calendar, with ONE claim-based day embedded (anchor+14d).
INSERT INTO public.operating_calendar (date, profile_name)
SELECT g::date, 's_test2028_20280601'
FROM generate_series(
  ((current_setting('test.pdss.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date - 40)::timestamp,
  ((current_setting('test.pdss.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date + 50)::timestamp,
  interval '1 day'
) AS g
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

INSERT INTO public.operating_calendar (date, profile_name)
VALUES (((current_setting('test.pdss.anchor')::timestamptz + interval '14 days')
          AT TIME ZONE 'America/New_York')::date, 'pdss_break')
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

-- The season's period row. end_date = anchor+28d, so anchor+35d falls beyond it.
-- NOTE the profile_name: this is the row the pre-fix boundary lookup could not see.
INSERT INTO public.scheduling_periods (period_name, profile_name, start_date, end_date)
VALUES (
  'Summer 2028', 's_test2028_20280601',
  ((current_setting('test.pdss.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date - 31),
  ((current_setting('test.pdss.anchor')::timestamptz + interval '28 days')
    AT TIME ZONE 'America/New_York')::date
);

-- The recurring slot: harrison, Sundays, 09:00.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('0d000002-0000-0000-0000-0000000000a0', 'harrison',
   current_setting('test.pdss.anchor')::timestamptz - interval '7 days',  1),  -- past
  ('0d000002-0000-0000-0000-0000000000a1', 'harrison',
   current_setting('test.pdss.anchor')::timestamptz + interval '7 days',  1),  -- AFFECTED
  ('0d000002-0000-0000-0000-0000000000a2', 'harrison',
   current_setting('test.pdss.anchor')::timestamptz + interval '14 days', 1),  -- claim-based day
  ('0d000002-0000-0000-0000-0000000000a3', 'harrison',
   current_setting('test.pdss.anchor')::timestamptz + interval '21 days', 1),  -- AFFECTED
  ('0d000002-0000-0000-0000-0000000000a4', 'harrison',
   current_setting('test.pdss.anchor')::timestamptz + interval '35 days', 1);  -- beyond period

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES
  ('0d000003-0000-0000-0000-0000000000a0', '0d000002-0000-0000-0000-0000000000a0',
   '0d000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),
  ('0d000003-0000-0000-0000-0000000000a1', '0d000002-0000-0000-0000-0000000000a1',
   '0d000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),
  ('0d000003-0000-0000-0000-0000000000a2', '0d000002-0000-0000-0000-0000000000a2',
   '0d000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),
  ('0d000003-0000-0000-0000-0000000000a3', '0d000002-0000-0000-0000-0000000000a3',
   '0d000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),
  ('0d000003-0000-0000-0000-0000000000a4', '0d000002-0000-0000-0000-0000000000a4',
   '0d000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL);

-- ============================================================
-- A. THE REGRESSION. The drop must COMPLETE, not raise. Pre-fix this call raised
--    P0001 semester_boundary_not_found and nothing was vacated.
-- ============================================================

SELECT lives_ok(
  $$ SELECT public.permanent_drop_slot(
       '0d000001-0000-0000-0000-000000000001'::uuid,
       'harrison',
       0,
       ARRAY['09:00'],
       current_setting('test.pdss.anchor')::timestamptz,
       NULL) $$,
  'drop: a recurring SUMMER-season slot drops instead of raising semester_boundary_not_found'
);

-- ============================================================
-- B. SCOPE. Exactly the two in-season future occurrences are vacated, bounded by the
--    season's end_date (not a school-year term's).
-- ============================================================

SELECT is(
  (SELECT (public.permanent_drop_slot(
     '0d000001-0000-0000-0000-000000000001'::uuid, 'harrison', 0, ARRAY['09:00'],
     current_setting('test.pdss.anchor')::timestamptz, NULL) ->> 'semester_end_date')::date),
  ((current_setting('test.pdss.anchor')::timestamptz + interval '28 days')
    AT TIME ZONE 'America/New_York')::date,
  'drop: the boundary resolves to the SEASON end_date'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
    WHERE assignment_id = '0d000003-0000-0000-0000-0000000000a1'),
  'vacant',
  'drop: the in-season occurrence one week out is vacated'
);

SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments
    WHERE assignment_id = '0d000003-0000-0000-0000-0000000000a1'),
  'permanent_drop',
  'drop: the vacated seat is flagged permanent_drop (so the feeds can identify it)'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
    WHERE assignment_id = '0d000003-0000-0000-0000-0000000000a3'),
  'vacant',
  'drop: the in-season occurrence three weeks out is vacated'
);

-- ============================================================
-- C. EXCLUSIONS still hold inside a season (BSpec §8.4.1). This is what makes the
--    `scheduling_mode = 'sm_built'` restatement necessary rather than just deleting
--    the old profile predicate.
-- ============================================================

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
    WHERE assignment_id = '0d000003-0000-0000-0000-0000000000a2'),
  'scheduled',
  'drop: an embedded CLAIM-BASED day inside the season is excluded (scheduling_mode filter)'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
    WHERE assignment_id = '0d000003-0000-0000-0000-0000000000a4'),
  'scheduled',
  'drop: an occurrence beyond the season end_date is excluded (no unbounded vacate)'
);

SELECT * FROM finish();
ROLLBACK;
