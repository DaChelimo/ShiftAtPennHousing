-- pgTAP tests for web-remediation session S1: admin override RPCs
-- `admin_assign_worker` / `admin_remove_worker` (audit #1).
--
-- Spec sources:
--   BEHAVIORAL_SPECIFICATION.md
--     §4.3 (Phase-3 post-publish override — an HM/SM may assign / reassign /
--       remove a worker on a PUBLISHED block, "same card UI"; this-week vs
--       permanent; soft-constraint confirm),
--     §11.1 (the live-calendar manager surface),
--     §1.2/§1.5 (Harnwell training + float-direction invariants — absolute),
--     §9.3 (the weekly hours cap: 20-soft overridable, 40-hard absolute),
--     §4.5 (people-management alerts the permanent remove writes);
--   ARCHITECTURE.md §7.1/§7.2 (permanent_drop_slot / permanent_pickup_slot the
--     permanent scope reuses; the vacancy_origin / cross-house field rules),
--     §9.3 (effective_weekly_cap soft vs hard);
--   AGENTS.md hard invariants #1 (Harnwell training — enforced at EVERY write
--     point, including admin override), #3 (no-takeback — float-committed seats
--     deferred, not broken), #4 (cap is soft on assign), #5 (30-min blocks),
--     #6 (NY timestamptz).
--   docs/web-remediation/sessions/S1/TEST_PLAN.md (the §4b behavior contract +
--     pinned decisions D1–D8). Run with: supabase test db
--
-- WHAT THIS SUITE COVERS (§4b)
-- ----------------------------
--   A. Function existence — both RPCs with the pinned signatures.
--   B. Assign — this_week happy path (assign a vacant seat; reassign an occupied
--      non-float seat atomically), with the D4 success shape.
--   C. Assign — permanent (every future in-semester occurrence; feed removal).
--   D. Assign — hard rejections (RAISE P0001 + the targeted row unchanged):
--      Harnwell training backstop (DB trigger fires even via service role),
--      inactive worker, hard cap (even with override), block_started,
--      float_committed, cross_house_not_supported.
--   E. Assign — soft confirm gating (no write + needs_confirm with override=false;
--      write with override=true).
--   F. Authz — non-(sm/hm/bm) rejected; admin of another house rejected.
--   G. Remove — this_week (vacant+temporary_drop, no block_step_status row).
--   H. Remove — permanent (all future in-semester → vacant+permanent_drop;
--      float-committed skipped; sw_permanent_removal_alert (the SM passive
--      sm_permanent_drop_alert was retired 2026-07-13); feed appearance).
--   I. Remove — rejections (block_started / float_committed / not-occupied).
--   J. Atomicity — a rejected op leaves every row untouched.
--
-- TDD-RED: the S1 migration (`admin_assign_worker` / `admin_remove_worker`) is not
-- yet written; this suite pins their contract and turns GREEN when the migration
-- lands — the same TDD discipline phase-09/10 used for their not-yet-existing RPCs.
-- The pure hard-block / advisory partition these RPCs re-check is the pure-function
-- surface tested in packages/core/tests/s1-admin-override/*.test.ts.

BEGIN;

SELECT plan(58);

-- ============================================================
-- 0. Fixtures.
--    Anchor: a FIXED Thursday-evening NY-local timestamp in July 2027 — chosen
--    DST-stable (EDT throughout July/August, so every weekly occurrence shares
--    the same UTC offset; AGENTS invariant #6). All block local times are <= 19:30
--    so each block's UTC-slice date equals its NY-local calendar date.
--
--    Houses: harrison (the override house), kings-court (cross-house target),
--    harnwell (training backstop). Workers all home harrison unless noted.
-- ============================================================

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  -- target SW (home harrison) — the worker assigned / removed
  ('51000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's1-target@test.local'),
  -- incumbent SW (home harrison) — reassigned away from
  ('51000001-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's1-incumbent@test.local'),
  -- SM of harrison — the operator who initiates the permanent removal
  ('51000001-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's1-sm05@test.local'),
  -- a cross-house worker (home kings-court)
  ('51000001-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's1-xhouse@test.local'),
  -- a non-admin worker (sw) — an unauthorized operator
  ('51000001-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's1-sw-operator@test.local'),
  -- an SM of a DIFFERENT house (kings-court) — admin, but not of harrison
  ('51000001-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's1-sm07@test.local'),
  -- a cap-loaded worker (home harrison) for the hard-cap fixture
  ('51000001-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's1-capped@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('51000001-0000-0000-0000-000000000001', 'Target (harrison)',    's1-target@test.local',    'harrison', true),
  ('51000001-0000-0000-0000-000000000002', 'Incumbent (harrison)', 's1-incumbent@test.local', 'harrison', true),
  ('51000001-0000-0000-0000-000000000003', 'SM (harrison)',        's1-sm05@test.local',      'harrison', true),
  ('51000001-0000-0000-0000-000000000004', 'XHouse (kings-court)',    's1-xhouse@test.local',    'kings-court', true),
  ('51000001-0000-0000-0000-000000000005', 'SW operator (h05)',    's1-sw-operator@test.local','harrison', true),
  ('51000001-0000-0000-0000-000000000006', 'SM (kings-court)',        's1-sm07@test.local',      'kings-court', true),
  ('51000001-0000-0000-0000-000000000007', 'Capped (harrison)',    's1-capped@test.local',    'harrison', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('51000001-0000-0000-0000-000000000001', 'sw', NULL),
  ('51000001-0000-0000-0000-000000000002', 'sw', NULL),
  ('51000001-0000-0000-0000-000000000003', 'sm', 'harrison'),   -- operator (authorized for harrison)
  ('51000001-0000-0000-0000-000000000004', 'sw', NULL),
  ('51000001-0000-0000-0000-000000000005', 'sw', NULL),         -- unauthorized operator
  ('51000001-0000-0000-0000-000000000006', 'sm', 'kings-court'),   -- admin of the WRONG house
  ('51000001-0000-0000-0000-000000000007', 'sw', NULL)
ON CONFLICT DO NOTHING;

-- Anchor: 2027-07-01 19:00 America/New_York (EDT). Stored as timestamptz.
-- (Was 2026-07-02; bumped +52 weeks — same Thursday, same EDT/DST-stable window —
-- to clear the seed's Jun–Aug 2026 "Summer 2026" e2e period, which overlaps this
-- suite's anchor-derived scheduling_periods row and would trip the no-overlap
-- exclusion. Everything else here is anchor-relative, so the suite just shifts.)
SELECT set_config(
  'test.s1.anchor',
  ('2027-07-01 19:00'::timestamp AT TIME ZONE 'America/New_York')::text,
  false
);

-- The NY Monday of the anchor week — the cap-override key (effective_weekly_cap
-- joins weekly_cap_overrides on week_start_date = the week's Monday).
SELECT set_config(
  'test.s1.anchor_monday',
  (((current_setting('test.s1.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date)
    - EXTRACT(ISODOW FROM current_setting('test.s1.anchor')::timestamptz
                            AT TIME ZONE 'America/New_York')::integer + 1)::text,
  false
);

-- Operating profiles (self-contained; no-op if seeded).
INSERT INTO public.operating_profiles
  (profile_name, shift_start_bound, shift_end_bound, default_hours_cap,
   default_cap_enforcement, scheduling_mode, float_enabled, escalation_chain,
   claim_phase_open_offset, claim_phase_alert_offset, claim_phase_close_offset)
VALUES
  ('regular_school_year', '08:00', '00:00', 20, 'soft', 'sm_built', true, '[]'::jsonb,
   NULL, NULL, NULL)
ON CONFLICT (profile_name) DO NOTHING;

-- Operating calendar: a generous regular_school_year window around the anchor.
INSERT INTO public.operating_calendar (date, profile_name)
SELECT g::date, 'regular_school_year'
FROM generate_series(
  ((current_setting('test.s1.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date - 14)::timestamp,
  ((current_setting('test.s1.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date + 60)::timestamp,
  interval '1 day'
) AS g
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

-- Scheduling period: end_date = anchor+38d so the anchor+35d week is in-semester
-- and the anchor+42d week is next semester (out of permanent scope).
INSERT INTO public.scheduling_periods (period_name, profile_name, start_date, end_date)
VALUES (
  'S1 Fall 2027', 'regular_school_year',
  ((current_setting('test.s1.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date - 14),
  ((current_setting('test.s1.anchor')::timestamptz + interval '38 days')
    AT TIME ZONE 'America/New_York')::date
);

-- ---- Blocks ----
-- The recurring slot: harrison, Thursdays, 19:00, occurrences at anchor + {0,7,
-- 14,35,42} days (now / +1w / +2w / +5w / +6w). The clicked occurrence is the
-- anchor's own block (b_now) for the permanent-scope derivation.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('51000002-0000-0000-0000-0000000019a0', 'harrison', current_setting('test.s1.anchor')::timestamptz,                      1), -- b_now (clicked; == anchor)
  ('51000002-0000-0000-0000-0000000019a1', 'harrison', current_setting('test.s1.anchor')::timestamptz + interval '7 days', 1), -- +1w
  ('51000002-0000-0000-0000-0000000019a2', 'harrison', current_setting('test.s1.anchor')::timestamptz + interval '14 days',1), -- +2w
  ('51000002-0000-0000-0000-0000000019a3', 'harrison', current_setting('test.s1.anchor')::timestamptz + interval '35 days',1), -- +5w (in-semester)
  ('51000002-0000-0000-0000-0000000019a4', 'harrison', current_setting('test.s1.anchor')::timestamptz + interval '42 days',1), -- +6w (next semester)
  -- A FUTURE vacant single seat for the this-week assign happy path (harrison 18:00, +1w).
  ('51000002-0000-0000-0000-000000001801', 'harrison',
   (current_setting('test.s1.anchor')::timestamptz + interval '7 days') - interval '1 hour', 1),
  -- A FUTURE occupied (incumbent) single seat for the this-week reassign path (harrison 17:00, +1w).
  ('51000002-0000-0000-0000-000000001701', 'harrison',
   (current_setting('test.s1.anchor')::timestamptz + interval '7 days') - interval '2 hours', 1),
  -- A FUTURE 2-seat block (harrison 17:30, +1w): seat 1 occupied by the incumbent,
  -- seat 2 VACANT. The phantom-seat fixture — a Replace targeting the incumbent must
  -- overwrite seat 1, NOT fill the sibling vacant seat (the old reassign bug).
  ('51000002-0000-0000-0000-000000001751', 'harrison',
   (current_setting('test.s1.anchor')::timestamptz + interval '7 days') - interval '90 minutes', 2),
  -- A PAST block for block_started (harrison 18:00, -1w).
  ('51000002-0000-0000-0000-000000001802', 'harrison',
   (current_setting('test.s1.anchor')::timestamptz - interval '7 days') - interval '1 hour', 1),
  -- A FUTURE float-committed seat (harrison 16:00, +1w) — pending_float_in.
  ('51000002-0000-0000-0000-000000001601', 'harrison',
   (current_setting('test.s1.anchor')::timestamptz + interval '7 days') - interval '3 hours', 1),
  -- A FUTURE Harnwell vacant seat for the training backstop (harnwell 15:00, +1w).
  ('51000002-0000-0000-0000-000000001501', 'harnwell',
   (current_setting('test.s1.anchor')::timestamptz + interval '7 days') - interval '4 hours', 1),
  -- A FUTURE kings-court vacant seat for the cross-house rejection (kings-court 18:00, +1w).
  ('51000002-0000-0000-0000-000000007801', 'kings-court',
   (current_setting('test.s1.anchor')::timestamptz + interval '7 days') - interval '1 hour', 1),
  -- A FUTURE vacant seat for the soft-confirm gating (harrison 14:00, +1w).
  ('51000002-0000-0000-0000-000000001401', 'harrison',
   (current_setting('test.s1.anchor')::timestamptz + interval '7 days') - interval '5 hours', 1),
  -- A FUTURE vacant seat for the hard-cap rejection (harrison, anchor-week Friday
  -- 16:00 — the SAME NY week as the 40h load + the 40-hard override, and future vs
  -- the anchor, so the projection (80 existing + 1) * 0.5 = 40.5 > 40 trips the hard cap).
  ('51000002-0000-0000-0000-000000001301', 'harrison',
   current_setting('test.s1.anchor')::timestamptz + interval '21 hours', 1);

-- ---- Assignment rows for the seats that need an existing row ----
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES
  -- recurring slot occurrences: all VACANT (never_assigned) so a permanent assign fills them.
  ('51000003-0000-0000-0000-0000000019a0', '51000002-0000-0000-0000-0000000019a0', NULL, 'vacant', 'never_assigned', false, NULL), -- b_now
  ('51000003-0000-0000-0000-0000000019a1', '51000002-0000-0000-0000-0000000019a1', NULL, 'vacant', 'permanent_drop', false, NULL), -- +1w (a permanent opening)
  ('51000003-0000-0000-0000-0000000019a2', '51000002-0000-0000-0000-0000000019a2', NULL, 'vacant', 'never_assigned', false, NULL), -- +2w: a PLAIN open seat (never permanently dropped) — admin permanent assign must still fill it (regression guard)
  ('51000003-0000-0000-0000-0000000019a3', '51000002-0000-0000-0000-0000000019a3', NULL, 'vacant', 'permanent_drop', false, NULL), -- +5w (a permanent opening)
  ('51000003-0000-0000-0000-0000000019a4', '51000002-0000-0000-0000-0000000019a4', NULL, 'vacant', 'never_assigned', false, NULL), -- +6w (next semester; never scheduled → NOT a current permanent opening, so the feed must not count it)
  -- this-week assign happy path: a vacant seat.
  ('51000003-0000-0000-0000-000000001801', '51000002-0000-0000-0000-000000001801', NULL, 'vacant', 'never_assigned', false, NULL),
  -- this-week reassign: an occupied (incumbent) non-float seat.
  ('51000003-0000-0000-0000-000000001701', '51000002-0000-0000-0000-000000001701',
   '51000001-0000-0000-0000-000000000002', 'scheduled', 'none', false, NULL),
  -- phantom-seat 2-seat block: seat 1 = incumbent (scheduled), seat 2 = VACANT.
  ('51000003-0000-0000-0000-000000001751', '51000002-0000-0000-0000-000000001751',
   '51000001-0000-0000-0000-000000000002', 'scheduled', 'none', false, NULL),
  ('51000003-0000-0000-0000-000000001752', '51000002-0000-0000-0000-000000001751',
   NULL, 'vacant', 'never_assigned', false, NULL),
  -- past block (block_started): a vacant seat.
  ('51000003-0000-0000-0000-000000001802', '51000002-0000-0000-0000-000000001802', NULL, 'vacant', 'never_assigned', false, NULL),
  -- float-committed seat: pending_float_in (a floater inbound), occupant = the incumbent.
  ('51000003-0000-0000-0000-000000001601', '51000002-0000-0000-0000-000000001601',
   '51000001-0000-0000-0000-000000000002', 'pending_float_in', 'none', false, 'kings-court'),
  -- Harnwell vacant seat.
  ('51000003-0000-0000-0000-000000001501', '51000002-0000-0000-0000-000000001501', NULL, 'vacant', 'never_assigned', false, NULL),
  -- kings-court vacant seat (cross-house).
  ('51000003-0000-0000-0000-000000007801', '51000002-0000-0000-0000-000000007801', NULL, 'vacant', 'never_assigned', false, NULL),
  -- soft-confirm vacant seat.
  ('51000003-0000-0000-0000-000000001401', '51000002-0000-0000-0000-000000001401', NULL, 'vacant', 'never_assigned', false, NULL),
  -- hard-cap vacant seat.
  ('51000003-0000-0000-0000-000000001301', '51000002-0000-0000-0000-000000001301', NULL, 'vacant', 'never_assigned', false, NULL);

-- ---- Cap fixture ----
-- Pin the anchor week to 40-HARD via weekly_cap_overrides, and load the capped
-- worker with exactly 40h (80 half-hour blocks) of scheduled time in that week,
-- in a private house (mayer) so it does not collide with the slot blocks.
-- Assigning ONE more 30-min seat (b13:00 above, in the same week) → 40.5h > 40.
INSERT INTO public.weekly_cap_overrides (week_start_date, hours_cap, cap_enforcement, modified_by)
VALUES (current_setting('test.s1.anchor_monday')::date, 40, 'hard',
        '51000001-0000-0000-0000-000000000003')
ON CONFLICT (week_start_date) DO UPDATE
  SET hours_cap = EXCLUDED.hours_cap, cap_enforcement = EXCLUDED.cap_enforcement;

-- 80 contiguous half-hour blocks for the capped worker, starting Monday 08:00 NY
-- of the anchor week (08:00..23:30 across days — all <= 19:30? no; spread across
-- days keeps each <= 19:30). Simpler: 16 blocks/day (08:00–16:00) over 5 weekdays
-- = 80 blocks = 40h, every start <= 15:30.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
SELECT
  ('51000002-0000-0000-0000-' || lpad((900000 + n)::text, 12, '0'))::uuid,
  'mayer',
  ((current_setting('test.s1.anchor_monday')::date + (n / 16))::timestamp
    + make_interval(mins => 480 + (n % 16) * 30)) AT TIME ZONE 'America/New_York',
  1
FROM generate_series(0, 79) AS n;

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
SELECT
  ('51000003-0000-0000-0000-' || lpad((900000 + n)::text, 12, '0'))::uuid,
  ('51000002-0000-0000-0000-' || lpad((900000 + n)::text, 12, '0'))::uuid,
  '51000001-0000-0000-0000-000000000007',
  'scheduled', 'none', false, NULL
FROM generate_series(0, 79) AS n;

-- ============================================================
-- A. FUNCTION EXISTENCE (§4b).
-- ============================================================

SELECT has_function(
  'public', 'admin_assign_worker',
  ARRAY['uuid', 'uuid[]', 'uuid', 'text', 'boolean', 'timestamptz', 'uuid'],
  'admin_assign_worker(operator, block_ids[], user, scope, override_advisories, now, incumbent) exists (TEST_PLAN §3)'
);
SELECT has_function(
  'public', 'admin_remove_worker',
  ARRAY['uuid', 'uuid[]', 'uuid', 'text', 'timestamptz'],
  'admin_remove_worker(operator, block_ids[], user, scope, now) exists (TEST_PLAN §3)'
);

-- ============================================================
-- B. ASSIGN — this_week happy path (§4b). D4 success shape.
-- ============================================================

SELECT lives_ok(
  $$ SELECT public.admin_assign_worker(
       '51000001-0000-0000-0000-000000000003'::uuid,                 -- operator (SM of harrison)
       ARRAY['51000002-0000-0000-0000-000000001801']::uuid[],        -- the vacant 18:00 seat
       '51000001-0000-0000-0000-000000000001'::uuid,                 -- target worker
       'this_week', false,
       current_setting('test.s1.anchor')::timestamptz) $$,
  'assign this_week: a vacant same-house seat is filled (no confirm needed for a clean worker)'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000001801'),
  'claimed',
  'assign this_week: status -> claimed (D4)'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000001801'),
  '51000001-0000-0000-0000-000000000001'::uuid,
  'assign this_week: user_id = the target worker (D4)'
);
SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000001801'),
  'none',
  'assign this_week: vacancy_origin -> none (D4)'
);
SELECT is(
  (SELECT is_cross_house_pickup FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000001801'),
  false,
  'assign this_week: same-house ⇒ is_cross_house_pickup = false (D4)'
);
SELECT is(
  (SELECT source_house_id FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000001801'),
  NULL,
  'assign this_week: same-house ⇒ source_house_id = NULL (D4)'
);

-- Reassign: replace the incumbent on an occupied non-float seat, atomically.
SELECT lives_ok(
  $$ SELECT public.admin_assign_worker(
       '51000001-0000-0000-0000-000000000003'::uuid,
       ARRAY['51000002-0000-0000-0000-000000001701']::uuid[],        -- the occupied 17:00 seat
       '51000001-0000-0000-0000-000000000001'::uuid,                 -- new worker (target)
       'this_week', false,
       current_setting('test.s1.anchor')::timestamptz) $$,
  'reassign this_week: an occupied non-float seat is reassigned in one call'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000001701'),
  '51000001-0000-0000-0000-000000000001'::uuid,
  'reassign: the seat now holds the new worker'
);
SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
   WHERE block_id = '51000002-0000-0000-0000-000000001701'
     AND user_id = '51000001-0000-0000-0000-000000000002'),
  0,
  'reassign: the incumbent no longer holds the seat (vacated atomically)'
);

-- Replace targeting a named incumbent on a 2-seat block: overwrite the incumbent's
-- seat, NOT the sibling vacant seat (the phantom-seat regression — migration
-- 20260614000003 p_incumbent_user_id). Without the incumbent arg the write prefers
-- the vacant seat and would leave the incumbent in place beside a new worker.
SELECT lives_ok(
  $$ SELECT public.admin_assign_worker(
       '51000001-0000-0000-0000-000000000003'::uuid,                 -- operator (SM of harrison)
       ARRAY['51000002-0000-0000-0000-000000001751']::uuid[],        -- the 2-seat block
       '51000001-0000-0000-0000-000000000001'::uuid,                 -- new worker (target)
       'this_week', false,
       current_setting('test.s1.anchor')::timestamptz,
       '51000001-0000-0000-0000-000000000002'::uuid) $$,             -- incumbent to replace
  'replace this_week: a 2-seat block with a named incumbent is reassigned in one call'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000001751'),
  '51000001-0000-0000-0000-000000000001'::uuid,
  'replace: the incumbent seat now holds the new worker'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000001752'),
  'vacant',
  'replace: the sibling vacant seat is untouched (no phantom fill)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
   WHERE block_id = '51000002-0000-0000-0000-000000001751'
     AND user_id = '51000001-0000-0000-0000-000000000002'),
  0,
  'replace: the incumbent no longer holds any seat on the block'
);

-- ============================================================
-- C. ASSIGN — permanent (§4b). Clicked occurrence = b_now; act on every future
--    in-semester occurrence of the (harrison, Thu, 19:00) slot.
-- ============================================================

SELECT set_config(
  'test.s1.perm_assign',
  (public.admin_assign_worker(
     '51000001-0000-0000-0000-000000000003'::uuid,
     ARRAY['51000002-0000-0000-0000-0000000019a0']::uuid[],          -- the clicked b_now block
     '51000001-0000-0000-0000-000000000001'::uuid,
     'permanent', false,
     current_setting('test.s1.anchor')::timestamptz
   ))::text,
  false
);

-- +1w, +2w, +5w are future in-semester ⇒ filled with the worker.
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-0000000019a1'),
  '51000001-0000-0000-0000-000000000001'::uuid,
  'permanent assign: the +1w occurrence is filled with the worker'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-0000000019a3'),
  'claimed',
  'permanent assign: the +5w (in-semester) occurrence is filled (status claimed)'
);
-- +2w is a PLAIN 'never_assigned' open seat (never permanently dropped). Admin
-- permanent assign must fill it too — regression guard for the bug where the
-- write delegated to permanent_pickup_slot (vacancy_origin='permanent_drop' only)
-- and silently assigned zero seats on ordinary recurring open shifts.
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-0000000019a2'),
  '51000001-0000-0000-0000-000000000001'::uuid,
  'permanent assign: a plain never_assigned future occurrence is filled (not just permanent_drop openings)'
);
-- b_now (== anchor, the clicked occurrence) is NOT strictly future ⇒ untouched.
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-0000000019a0'),
  NULL::uuid,
  'permanent assign: the clicked/started occurrence (b_now == now) is NOT filled (D5 strictly-future)'
);
-- +6w is next semester ⇒ untouched.
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-0000000019a4'),
  NULL::uuid,
  'permanent assign: the +6w (next-semester) occurrence is NOT filled (D5 semester bound)'
);
-- After the permanent assign over permanent_drop openings, the slot leaves the feed.
SELECT is(
  (SELECT count(*)::integer FROM public.permanent_openings_feed('harrison', current_setting('test.s1.anchor')::timestamptz)
   WHERE block_start_time = '19:00'),
  0,
  'permanent assign: the 19:00 slot no longer appears in permanent_openings_feed'
);

-- ============================================================
-- D. ASSIGN — hard rejections (RAISE P0001 + the targeted row unchanged) (§4b).
-- ============================================================

-- D1. Harnwell training backstop: a non-Harnwell-home worker onto a Harnwell
--     block. The DB trigger fires even via the service-role RPC (invariant #1).
SELECT throws_ok(
  $$ SELECT public.admin_assign_worker(
       '51000001-0000-0000-0000-000000000003'::uuid,
       ARRAY['51000002-0000-0000-0000-000000001501']::uuid[],        -- the Harnwell seat
       '51000001-0000-0000-0000-000000000001'::uuid,                 -- a harrison worker
       'this_week', true,                                            -- even with override
       current_setting('test.s1.anchor')::timestamptz) $$,
  'P0001', NULL,
  'assign Harnwell backstop: a non-Harnwell-home worker is rejected (DB trigger, invariant #1)'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000001501'),
  NULL::uuid,
  'assign Harnwell backstop: the Harnwell seat is untouched (no partial write)'
);

-- D2. Inactive worker.
UPDATE public.users SET is_active = false WHERE user_id = '51000001-0000-0000-0000-000000000001';
SELECT throws_ok(
  $$ SELECT public.admin_assign_worker(
       '51000001-0000-0000-0000-000000000003'::uuid,
       ARRAY['51000002-0000-0000-0000-000000001401']::uuid[],
       '51000001-0000-0000-0000-000000000001'::uuid,
       'this_week', false,
       current_setting('test.s1.anchor')::timestamptz) $$,
  'P0001', 'user_inactive',
  'assign: an inactive worker is rejected (user_inactive)'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000001401'),
  'vacant',
  'assign: the seat is untouched after the inactive-worker rejection'
);
UPDATE public.users SET is_active = true WHERE user_id = '51000001-0000-0000-0000-000000000001';

-- D3. Hard cap — rejected, AND still rejected with override=true (D2: hard cap absolute).
SELECT throws_ok(
  $$ SELECT public.admin_assign_worker(
       '51000001-0000-0000-0000-000000000003'::uuid,
       ARRAY['51000002-0000-0000-0000-000000001301']::uuid[],        -- the +1w 13:00 seat (same week as the 40h load)
       '51000001-0000-0000-0000-000000000007'::uuid,                 -- the capped worker (40h)
       'this_week', false,
       current_setting('test.s1.anchor')::timestamptz) $$,
  'P0001', 'hard_cap_exceeded',
  'assign: over the 40h hard cap is rejected (hard_cap_exceeded)'
);
SELECT throws_ok(
  $$ SELECT public.admin_assign_worker(
       '51000001-0000-0000-0000-000000000003'::uuid,
       ARRAY['51000002-0000-0000-0000-000000001301']::uuid[],
       '51000001-0000-0000-0000-000000000007'::uuid,
       'this_week', true,                                            -- override does NOT bypass a hard cap (D2)
       current_setting('test.s1.anchor')::timestamptz) $$,
  'P0001', 'hard_cap_exceeded',
  'assign: the hard cap is STILL rejected with p_override_advisories = true (D2)'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000001301'),
  NULL::uuid,
  'assign: the seat is untouched after the hard-cap rejection'
);

-- D4. Block already started.
SELECT throws_ok(
  $$ SELECT public.admin_assign_worker(
       '51000001-0000-0000-0000-000000000003'::uuid,
       ARRAY['51000002-0000-0000-0000-000000001802']::uuid[],        -- the -1w past block
       '51000001-0000-0000-0000-000000000001'::uuid,
       'this_week', false,
       current_setting('test.s1.anchor')::timestamptz) $$,
  'P0001', 'block_started',
  'assign: a block already started/past is rejected (block_started, D1)'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000001802'),
  'vacant',
  'assign: the past block is untouched after the block_started rejection'
);

-- D5. Float-committed seat.
SELECT throws_ok(
  $$ SELECT public.admin_assign_worker(
       '51000001-0000-0000-0000-000000000003'::uuid,
       ARRAY['51000002-0000-0000-0000-000000001601']::uuid[],        -- the pending_float_in seat
       '51000001-0000-0000-0000-000000000001'::uuid,
       'this_week', true,
       current_setting('test.s1.anchor')::timestamptz) $$,
  'P0001', 'float_committed',
  'assign: a float-committed seat is rejected (float_committed, D3)'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000001601'),
  'pending_float_in',
  'assign: the float-committed seat is untouched (no-takeback preserved)'
);

-- D6. Cross-house target.
SELECT throws_ok(
  $$ SELECT public.admin_assign_worker(
       '51000001-0000-0000-0000-000000000006'::uuid,                 -- operator: SM of kings-court (authorized for the block's house, so authz passes and the cross-house check is what fires)
       ARRAY['51000002-0000-0000-0000-000000007801']::uuid[],        -- a kings-court seat
       '51000001-0000-0000-0000-000000000001'::uuid,                 -- a harrison worker (cross-house target)
       'this_week', false,
       current_setting('test.s1.anchor')::timestamptz) $$,
  'P0001', 'cross_house_not_supported',
  'assign: a cross-house target is rejected (cross_house_not_supported)'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000007801'),
  'vacant',
  'assign: the kings-court seat is untouched after the cross-house rejection'
);

-- ============================================================
-- E. ASSIGN — soft confirm gating (§4b). A `cannot`/opted-out/over-soft-cap
--    worker with override=false performs NO write + signals needs_confirm; the
--    same call with override=true writes. Modeled with an over-SOFT-cap worker:
--    a SEPARATE week pinned 20-soft, the worker loaded to 20h there.
-- ============================================================

-- A future soft-cap week (anchor + 14d) pinned 20-soft, with a worker at 20h.
SELECT set_config(
  'test.s1.soft_monday',
  ((((current_setting('test.s1.anchor')::timestamptz + interval '14 days')
       AT TIME ZONE 'America/New_York')::date)
    - EXTRACT(ISODOW FROM (current_setting('test.s1.anchor')::timestamptz + interval '14 days')
                            AT TIME ZONE 'America/New_York')::integer + 1)::text,
  false
);
INSERT INTO public.weekly_cap_overrides (week_start_date, hours_cap, cap_enforcement, modified_by)
VALUES (current_setting('test.s1.soft_monday')::date, 20, 'soft',
        '51000001-0000-0000-0000-000000000003')
ON CONFLICT (week_start_date) DO UPDATE
  SET hours_cap = EXCLUDED.hours_cap, cap_enforcement = EXCLUDED.cap_enforcement;

-- 40 half-hour blocks (= 20h) for the TARGET worker in the soft-cap week, du-bois.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
SELECT
  ('51000002-0000-0000-0000-' || lpad((950000 + n)::text, 12, '0'))::uuid,
  'du-bois',
  ((current_setting('test.s1.soft_monday')::date + (n / 16))::timestamp
    + make_interval(mins => 480 + (n % 16) * 30)) AT TIME ZONE 'America/New_York',
  1
FROM generate_series(0, 39) AS n;
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
SELECT
  ('51000003-0000-0000-0000-' || lpad((950000 + n)::text, 12, '0'))::uuid,
  ('51000002-0000-0000-0000-' || lpad((950000 + n)::text, 12, '0'))::uuid,
  '51000001-0000-0000-0000-000000000001',
  'scheduled', 'none', false, NULL
FROM generate_series(0, 39) AS n;

-- A vacant harrison seat in the soft-cap week (anchor + 14d, 18:00).
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES (
  '51000002-0000-0000-0000-000000148001', 'harrison',
  (current_setting('test.s1.anchor')::timestamptz + interval '14 days') - interval '1 hour', 1
);
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES (
  '51000003-0000-0000-0000-000000148001', '51000002-0000-0000-0000-000000148001',
  NULL, 'vacant', 'never_assigned', false, NULL
);

-- override=false: NO write, needs_confirm with a soft_cap advisory.
SELECT set_config(
  'test.s1.confirm',
  (public.admin_assign_worker(
     '51000001-0000-0000-0000-000000000003'::uuid,
     ARRAY['51000002-0000-0000-0000-000000148001']::uuid[],
     '51000001-0000-0000-0000-000000000001'::uuid,                   -- the worker at 20h that week
     'this_week', false,
     current_setting('test.s1.anchor')::timestamptz
   ))::text,
  false
);
SELECT is(
  current_setting('test.s1.confirm')::jsonb ->> 'needs_confirm',
  'true',
  'soft confirm: override=false on an over-soft-cap assign signals needs_confirm'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000148001'),
  'vacant',
  'soft confirm: override=false performs NO write (the seat stays vacant)'
);

-- override=true: the write goes through.
SELECT lives_ok(
  $$ SELECT public.admin_assign_worker(
       '51000001-0000-0000-0000-000000000003'::uuid,
       ARRAY['51000002-0000-0000-0000-000000148001']::uuid[],
       '51000001-0000-0000-0000-000000000001'::uuid,
       'this_week', true,
       current_setting('test.s1.anchor')::timestamptz) $$,
  'soft confirm: override=true completes the over-soft-cap assign'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000148001'),
  '51000001-0000-0000-0000-000000000001'::uuid,
  'soft confirm: override=true writes the worker onto the seat'
);

-- ============================================================
-- F. AUTHZ (§4b). D7 — sm/hm/bm AND admin house == block house.
-- ============================================================

-- A fresh vacant harrison seat (anchor + 14d, 17:00) for the authz attempts.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES (
  '51000002-0000-0000-0000-000000147001', 'harrison',
  (current_setting('test.s1.anchor')::timestamptz + interval '14 days') - interval '2 hours', 1
);
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES (
  '51000003-0000-0000-0000-000000147001', '51000002-0000-0000-0000-000000147001',
  NULL, 'vacant', 'never_assigned', false, NULL
);

SELECT throws_ok(
  $$ SELECT public.admin_assign_worker(
       '51000001-0000-0000-0000-000000000005'::uuid,                 -- a plain SW operator
       ARRAY['51000002-0000-0000-0000-000000147001']::uuid[],
       '51000001-0000-0000-0000-000000000001'::uuid,
       'this_week', false,
       current_setting('test.s1.anchor')::timestamptz) $$,
  'P0001', 'not_authorized',
  'authz: a non-(sm/hm/bm) operator is rejected (not_authorized)'
);
SELECT throws_ok(
  $$ SELECT public.admin_assign_worker(
       '51000001-0000-0000-0000-000000000006'::uuid,                 -- an SM of kings-court
       ARRAY['51000002-0000-0000-0000-000000147001']::uuid[],        -- a harrison block
       '51000001-0000-0000-0000-000000000001'::uuid,
       'this_week', false,
       current_setting('test.s1.anchor')::timestamptz) $$,
  'P0001', 'not_authorized',
  'authz: an SM whose admin house ≠ the block house is rejected (SM stays own-house; the elevated hm/bm/rsm tier is cross-house per 20260627000002)'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000147001'),
  'vacant',
  'authz: the seat is untouched after both unauthorized attempts (atomicity)'
);

-- ============================================================
-- G. REMOVE — this_week (§4b). D6 — vacate only, no block_step_status row.
-- ============================================================

-- A future occupied harrison seat (anchor + 21d, 18:00) for the this-week remove.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES (
  '51000002-0000-0000-0000-000000218001', 'harrison',
  (current_setting('test.s1.anchor')::timestamptz + interval '21 days') - interval '1 hour', 1
);
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES (
  '51000003-0000-0000-0000-000000218001', '51000002-0000-0000-0000-000000218001',
  '51000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL
);

SELECT lives_ok(
  $$ SELECT public.admin_remove_worker(
       '51000001-0000-0000-0000-000000000003'::uuid,
       ARRAY['51000002-0000-0000-0000-000000218001']::uuid[],
       '51000001-0000-0000-0000-000000000001'::uuid,
       'this_week',
       current_setting('test.s1.anchor')::timestamptz) $$,
  'remove this_week: an occupied same-house seat is vacated'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000218001'),
  'vacant',
  'remove this_week: status -> vacant'
);
SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000218001'),
  'temporary_drop',
  'remove this_week: vacancy_origin -> temporary_drop'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000218001'),
  NULL::uuid,
  'remove this_week: user_id cleared'
);
SELECT is(
  (SELECT count(*)::integer FROM public.block_step_status WHERE block_id = '51000002-0000-0000-0000-000000218001'),
  0,
  'remove this_week: NO block_step_status row is written for the seat (D6 — orchestrator re-escalates)'
);

-- ============================================================
-- H. REMOVE — permanent (§4b). The (harrison, Thu, 19:00) slot is now held by
--    the target worker on +1w/+2w/+5w (from section C). Permanently remove it.
-- ============================================================

SELECT set_config(
  'test.s1.perm_remove',
  (public.admin_remove_worker(
     '51000001-0000-0000-0000-000000000003'::uuid,                   -- the SM operator
     ARRAY['51000002-0000-0000-0000-0000000019a1']::uuid[],          -- a held occurrence (+1w)
     '51000001-0000-0000-0000-000000000001'::uuid,                   -- the worker being removed
     'permanent',
     current_setting('test.s1.anchor')::timestamptz
   ))::text,
  false
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-0000000019a1'),
  'vacant',
  'permanent remove: a future in-semester occurrence is vacated'
);
SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-0000000019a3'),
  'permanent_drop',
  'permanent remove: the +5w occurrence is vacant+permanent_drop (re-enters the feed)'
);
-- The removed worker (operator ≠ worker) is notified.
SELECT is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE recipient_user_id = '51000001-0000-0000-0000-000000000001'
     AND type = 'sw_permanent_removal_alert'),
  1,
  'permanent remove: the removed worker receives an sw_permanent_removal_alert (operator ≠ worker, §8.4.2)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.permanent_openings_feed('harrison', current_setting('test.s1.anchor')::timestamptz)
   WHERE block_start_time = '19:00'),
  1,
  'permanent remove: the 19:00 slot reappears in permanent_openings_feed'
);

-- Permanent remove SKIPS float-committed occurrences: seed a held +1w float-out on
-- a SEPARATE slot (harrison, Thu, 12:00) and confirm a permanent remove leaves it.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('51000002-0000-0000-0000-0000000012a1', 'harrison', current_setting('test.s1.anchor')::timestamptz + interval '7 days'  - interval '7 hours', 1),
  ('51000002-0000-0000-0000-0000000012a2', 'harrison', current_setting('test.s1.anchor')::timestamptz + interval '14 days' - interval '7 hours', 1);
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES
  ('51000003-0000-0000-0000-0000000012a1', '51000002-0000-0000-0000-0000000012a1',
   '51000001-0000-0000-0000-000000000001', 'floated_out', 'none', false, NULL),  -- float-committed (no-takeback)
  ('51000003-0000-0000-0000-0000000012a2', '51000002-0000-0000-0000-0000000012a2',
   '51000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL);    -- a plain held week
SELECT lives_ok(
  $$ SELECT public.admin_remove_worker(
       '51000001-0000-0000-0000-000000000003'::uuid,
       ARRAY['51000002-0000-0000-0000-0000000012a2']::uuid[],
       '51000001-0000-0000-0000-000000000001'::uuid,
       'permanent',
       current_setting('test.s1.anchor')::timestamptz) $$,
  'permanent remove (float-skip slot): the call succeeds'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-0000000012a1'),
  'floated_out',
  'permanent remove: a float-committed occurrence is SKIPPED (no-takeback, invariant #3)'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-0000000012a2'),
  'vacant',
  'permanent remove: the plain held occurrence IS vacated alongside the skipped float seat'
);

-- ============================================================
-- I. REMOVE — rejections (§4b) — RAISE P0001 + the targeted row unchanged.
-- ============================================================

-- I1. Block started/past.
SELECT throws_ok(
  $$ SELECT public.admin_remove_worker(
       '51000001-0000-0000-0000-000000000003'::uuid,
       ARRAY['51000002-0000-0000-0000-000000001701']::uuid[],        -- the 17:00 seat is now held by the target
       '51000001-0000-0000-0000-000000000001'::uuid,
       'this_week',
       current_setting('test.s1.anchor')::timestamptz + interval '100 days') $$,  -- as-of after the block start
  'P0001', 'block_started',
  'remove: a block already started/past is rejected (block_started)'
);

-- I2. Float-committed seat. (The pending_float_in seat is held by the incumbent.)
SELECT throws_ok(
  $$ SELECT public.admin_remove_worker(
       '51000001-0000-0000-0000-000000000003'::uuid,
       ARRAY['51000002-0000-0000-0000-000000001601']::uuid[],
       '51000001-0000-0000-0000-000000000002'::uuid,
       'this_week',
       current_setting('test.s1.anchor')::timestamptz) $$,
  'P0001', 'float_committed',
  'remove: a float-committed seat is rejected (float_committed, D3)'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000001601'),
  'pending_float_in',
  'remove: the float-committed seat is untouched (no-takeback)'
);

-- I3. Seat not occupied by the named worker. (The 17:00 seat is held by the
--     target; ask to remove the incumbent who no longer holds it.)
SELECT throws_ok(
  $$ SELECT public.admin_remove_worker(
       '51000001-0000-0000-0000-000000000003'::uuid,
       ARRAY['51000002-0000-0000-0000-000000001701']::uuid[],
       '51000001-0000-0000-0000-000000000002'::uuid,                 -- the incumbent (already reassigned away)
       'this_week',
       current_setting('test.s1.anchor')::timestamptz) $$,
  'P0001', 'not_occupied_by_worker',
  'remove: a seat not occupied by the named worker is rejected (not_occupied_by_worker)'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '51000003-0000-0000-0000-000000001701'),
  '51000001-0000-0000-0000-000000000001'::uuid,
  'remove: the 17:00 seat is untouched after the wrong-worker rejection'
);

SELECT finish();
ROLLBACK;
