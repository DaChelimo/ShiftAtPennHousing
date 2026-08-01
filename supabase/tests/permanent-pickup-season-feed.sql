-- pgTAP: a permanently-dropped SEASON slot is advertised as a permanent OPENING, so it
-- can be picked up as a whole recurrence rather than one week at a time.
--
-- Stakeholder decision 2026-07-29. A summer season runs ~10 weeks; gating the permanent
-- openings feed on `profile_name = 'regular_school_year'` meant a worker who wanted a
-- summer slot for the season had to claim it week by week, and a worker who wanted to
-- hand one over could not offer it as a recurrence at all. 20260729000011 widened both
-- feed predicates to `operating_profiles.scheduling_mode = 'sm_built'`.
--
-- THE SYMMETRY RULE (20260617000004) is what this suite really guards: the feed must
-- never advertise a recurrence the pickup cannot take. The permanent-pickup Edge
-- Function's candidateBlocks() was widened to the SAME `sm_built` rule in the same
-- commit, so `weeks_remaining` here must equal the number of occurrences that EF will
-- find. Sections B and C pin both halves of that equality.
--
-- Anchor is deliberately inside the feed's 26-week horizon (measured from the real
-- clock), which the 2028 anchor in permanent-drop-summer-season.sql is not -- that suite
-- tests the drop RPC, this one tests the read model, and the read model is time-bounded.
--
-- Spec: BEHAVIORAL_SPECIFICATION.md §5.1 (permanent openings feed), §8.4.3 (permanent
--       pickup); ARCHITECTURE.md §7.2.
-- Run with: supabase test db

BEGIN;

SELECT plan(7);

-- ============================================================
-- 0. Fixtures. Anchor: Sunday 2026-09-06 09:00 America/New_York.
--    A season starting after the seed's Summer 2026 ends (2026-08-20), so the
--    scheduling_periods_no_overlap exclusion is satisfied, and inside now()+26 weeks so
--    the permanent feed's horizon admits it. There are no operating_calendar rows past
--    2026-08-20, so these inserts clobber nothing.
-- ============================================================

SELECT set_config(
  'test.ppsf.anchor',
  ('2026-09-06 09:00'::timestamp AT TIME ZONE 'America/New_York')::text,
  false
);

SELECT is(
  EXTRACT(DOW FROM current_setting('test.ppsf.anchor')::timestamptz
                     AT TIME ZONE 'America/New_York')::integer,
  0,
  'fixture: the anchor is a Sunday'
);

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('0e000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'ppsf-owner@test.local'),
       ('0e000001-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'ppsf-picker@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES ('0e000001-0000-0000-0000-000000000001', 'Season Owner',  'ppsf-owner@test.local',  'harrison', true),
       ('0e000001-0000-0000-0000-000000000002', 'Season Picker', 'ppsf-picker@test.local', 'harrison', true);

-- The picker must be a candidate_user in worker_open_shifts (sw, active, not bm).
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('0e000001-0000-0000-0000-000000000002', 'sw', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO public.operating_profiles
  (profile_name, shift_start_bound, shift_end_bound, default_hours_cap,
   default_cap_enforcement, scheduling_mode, float_enabled, escalation_chain,
   claim_phase_open_offset, claim_phase_alert_offset, claim_phase_close_offset)
VALUES
  ('s_test2026_20260901', '08:00', '00:00', 20, 'soft', 'sm_built', true, '[]'::jsonb,
   NULL, NULL, NULL),
  ('ppsf_break', '08:00', '00:00', 40, 'hard', 'claim_based', false, '[]'::jsonb,
   '-14 days'::interval, '-3 days'::interval, '-1 day'::interval)
ON CONFLICT (profile_name) DO NOTHING;

INSERT INTO public.operating_calendar (date, profile_name)
SELECT g::date, 's_test2026_20260901'
FROM generate_series('2026-09-01'::timestamp, '2026-10-31'::timestamp, interval '1 day') AS g
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

-- One claim-based day embedded in the season (anchor+14d): no recurring slot there.
INSERT INTO public.operating_calendar (date, profile_name)
VALUES (((current_setting('test.ppsf.anchor')::timestamptz + interval '14 days')
          AT TIME ZONE 'America/New_York')::date, 'ppsf_break')
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

-- The season period. Ends anchor+28d, so the anchor+35d occurrence falls outside it.
INSERT INTO public.scheduling_periods (period_name, profile_name, start_date, end_date)
VALUES ('Test Season 2026', 's_test2026_20260901', '2026-09-01',
        ((current_setting('test.ppsf.anchor')::timestamptz + interval '28 days')
          AT TIME ZONE 'America/New_York')::date);

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('0e000002-0000-0000-0000-0000000000a1', 'harrison',
   current_setting('test.ppsf.anchor')::timestamptz + interval '7 days',  1),
  ('0e000002-0000-0000-0000-0000000000a2', 'harrison',
   current_setting('test.ppsf.anchor')::timestamptz + interval '14 days', 1),
  ('0e000002-0000-0000-0000-0000000000a3', 'harrison',
   current_setting('test.ppsf.anchor')::timestamptz + interval '21 days', 1),
  ('0e000002-0000-0000-0000-0000000000a4', 'harrison',
   current_setting('test.ppsf.anchor')::timestamptz + interval '35 days', 1);

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES
  ('0e000003-0000-0000-0000-0000000000a1', '0e000002-0000-0000-0000-0000000000a1',
   '0e000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),
  ('0e000003-0000-0000-0000-0000000000a2', '0e000002-0000-0000-0000-0000000000a2',
   '0e000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),
  ('0e000003-0000-0000-0000-0000000000a3', '0e000002-0000-0000-0000-0000000000a3',
   '0e000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),
  ('0e000003-0000-0000-0000-0000000000a4', '0e000002-0000-0000-0000-0000000000a4',
   '0e000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL);

-- The owner permanently drops the recurring season slot.
SELECT public.permanent_drop_slot(
  '0e000001-0000-0000-0000-000000000001'::uuid,
  'harrison', 0, ARRAY['09:00'],
  current_setting('test.ppsf.anchor')::timestamptz,
  NULL);

-- ============================================================
-- A. THE WIDENING. The season slot is advertised as a PERMANENT opening. Pre-fix the
--    permanent feed emitted nothing here (the days are not regular_school_year), so the
--    recurrence could only be taken one week at a time.
-- ============================================================

SELECT is(
  (SELECT count(*)::integer FROM worker_open_shifts
    WHERE eligible_user_id = '0e000001-0000-0000-0000-000000000002'
      AND feed = 'permanent_opening'
      AND id IN ('0e000003-0000-0000-0000-0000000000a1',
                 '0e000003-0000-0000-0000-0000000000a3')),
  2,
  'feed: both in-season occurrences are advertised as a permanent opening'
);

-- ============================================================
-- B. WEEKS REMAINING must equal what the pickup will actually hand over -- the same
--    sm_built rule candidateBlocks() applies (20260617000004 symmetry).
-- ============================================================

SELECT is(
  (SELECT DISTINCT weeks_remaining FROM worker_open_shifts
    WHERE eligible_user_id = '0e000001-0000-0000-0000-000000000002'
      AND feed = 'permanent_opening'
      AND id = '0e000003-0000-0000-0000-0000000000a1'),
  2,
  'feed: weeks_remaining counts exactly the two schedule-built occurrences'
);

-- ============================================================
-- C. EXCLUSIONS. A claim-based day carries no recurring slot, and an occurrence past
--    the season end was never vacated, so neither may be advertised.
-- ============================================================

SELECT is(
  (SELECT status::text FROM shift_block_assignments
    WHERE assignment_id = '0e000003-0000-0000-0000-0000000000a2'),
  'scheduled',
  'drop: the claim-based day inside the season is not vacated'
);

SELECT is(
  (SELECT count(*)::integer FROM worker_open_shifts
    WHERE id = '0e000003-0000-0000-0000-0000000000a2'),
  0,
  'feed: the claim-based occurrence is advertised in neither feed'
);

SELECT is(
  (SELECT count(*)::integer FROM worker_open_shifts
    WHERE id = '0e000003-0000-0000-0000-0000000000a4'
      AND feed = 'permanent_opening'),
  0,
  'feed: an occurrence beyond the season end is not advertised'
);

-- ============================================================
-- D. HARNWELL TRAINING INVARIANT (#1) is untouched by the widening: a non-Harnwell
--    worker is still never offered a Harnwell seat. Guards against the CROSS JOIN
--    eligibility clause being disturbed by the predicate rewrite.
-- ============================================================

SELECT is(
  (SELECT count(*)::integer FROM worker_open_shifts w
     JOIN users u ON u.user_id = w.eligible_user_id
    WHERE w.house_id = 'harnwell' AND u.home_house_id <> 'harnwell'),
  0,
  'feed: no non-Harnwell worker is offered a Harnwell seat (invariant #1)'
);

SELECT * FROM finish();
ROLLBACK;
