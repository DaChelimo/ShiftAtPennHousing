-- pgTAP tests for web-remediation session S4: the `fire_worker` orchestrating RPC
-- (audit #4 — "Fire (thorough tests)").
--
-- Spec sources (authoritative):
--   BEHAVIORAL_SPECIFICATION.md
--     §4.5 (firing — the multi-step contract: in-progress vacate→escalate;
--       recurring→permanent drop; non-recurring→vacate; floats voided + re-lookup
--       excluding the worker; deactivate. "Mechanically equivalent to a permanent
--       drop applied across every shift the worker owns, plus deactivation";
--       "no separate fired-worker vacancy state exists"),
--     §5.4 (escalation chain: T-3h broadcast → T-2h float lookup → HMOD/Allied),
--     §5.5 (drop-while-floating: destination re-lookup skipping broadcast),
--     §6.1–§6.4 (float eligibility + the is_active gate + no-takeback),
--     §6.6 (force-trigger — the "skip broadcast → straight to float lookup" sibling),
--     §8.1/§8.4 (swaps + permanent drop/pickup — the reuse mechanics);
--   ARCHITECTURE.md §7.1/§7.2 (permanent_drop_slot the recurring drop reuses;
--     vacancy_origin rules), §2.8 (block_step_status semantics);
--   AGENTS.md hard invariants #1 (Harnwell training — every write point),
--     #2 (float direction), #3 (no-takeback — WAIVED for firing per §4.5 + the S4
--     PLAN), #4 (cap not on float), #5 (30-min blocks), #6 (NY timestamptz).
--   docs/web-remediation/sessions/S4/TEST_PLAN.md (the behavior contract: PIN 1
--     the RPC signature/return, PIN 3 the in-progress escalation-step shape,
--     sections A–L the `should` lines). Run with: supabase test db
--
-- WHAT THIS SUITE COVERS (TEST_PLAN A–L)
-- --------------------------------------
--   A. Existence & shape — the RPC signature; SECURITY DEFINER, revoked from
--      PUBLIC, granted to service_role.
--   B. Permissions (gate = user_has_house_admin_role of the victim's home house,
--      HM/BM-only) — SW / SM-of-home / HM-of-other-house rejected; HM-of-home and
--      BM-of-home allowed; non-existent worker rejected.
--   C. Future recurring (scheduled) slots → permanent_drop (incl. ≥2 distinct
--      slots, past untouched, current-occurrence skip, the feed, the SM alert).
--   D. Future non-recurring (claimed) seats → temporary_drop (weekly feed, NOT
--      permanent).
--   E. In-progress block — vacate; float_lookup step (status fired) iff it drops
--      below required headcount; NO broadcast step; NO step when at/above; the
--      in_progress_escalated flag.
--   F. Floats voided + re-lookup excludes the worker (no-takeback waived) — pending
--      AND acknowledged → voided; destination reopened; source restored→dropped;
--      is_active gate excludes re-lookup; force-trigger premark rollback; already-
--      resolved floats untouched.
--   G. Swaps voided — initiator and counterparty pending → voided; non-pending
--      untouched.
--   H. Deactivation & future exclusion — is_active=false; broadcast_subscribed
--      auto-cleared; unclaimable; float-pool excluded; other workers unaffected.
--   I. Idempotency — already-inactive no-op; no double-drop on a second fire.
--   J. Atomicity — a raised sub-step (semester_boundary_not_found) rolls the ENTIRE
--      fire back.
--   K. Invariant edges — a Harnwell worker; a currently-floated-out worker.
--   L. Integration — ONE fixture, the entire end state asserted.
--
-- TDD-RED: the S4 migration (`fire_worker`) is not yet written; this suite pins
-- its contract and turns GREEN when the migration lands — the same TDD discipline
-- s1-admin-override.sql / phase-09 / phase-10 used for their not-yet-existing RPCs.
-- The pure decision oracle this RPC re-derives in SQL (planFiring) is the
-- TypeScript surface tested in packages/core/tests/firing/fire-planner.test.ts.

BEGIN;

SELECT plan(68);

-- ============================================================
-- 0. Fixtures.
--    Anchor: a FIXED Thursday-evening NY-local timestamp in July 2027 — chosen
--    DST-stable (EDT throughout July/August, so every weekly occurrence shares
--    one UTC offset; AGENTS invariant #6). All block local times are <= 19:30 so
--    each block's UTC-slice date equals its NY-local calendar date.
--
--    Houses: harrison (multi-staff, the firing house; required_headcount 2 on the
--    headcount blocks), harnwell (training edge), kings-court (the cross-house float
--    destination). All exist in seed.sql.
-- ============================================================

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  -- the worker being fired (home harrison) — the canonical victim for A–H, the
  -- integration victim for L (one worker carries the whole obligation set).
  ('54000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's4-victim@test.local'),
  -- HM of harrison — an authorized initiator.
  ('54000001-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's4-hm05@test.local'),
  -- BM of harrison — an authorized initiator.
  ('54000001-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's4-bm05@test.local'),
  -- SM of harrison — NOT authorized (people-admin is HM/BM-only).
  ('54000001-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's4-sm05@test.local'),
  -- HM of kings-court — admin, but of the WRONG house ⇒ NOT authorized for the victim.
  ('54000001-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's4-hm07@test.local'),
  -- a plain SW (home harrison) — NOT authorized.
  ('54000001-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's4-sw@test.local'),
  -- a co-worker (home harrison) — seats OTHER blocks so a desk can be over/under
  -- required headcount, and proves "other workers untouched".
  ('54000001-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's4-coworker@test.local'),
  -- a SECOND co-worker (home harrison) — extra body for the at/above-headcount case.
  ('54000001-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's4-coworker2@test.local'),
  -- a Harnwell-home worker (the Harnwell-edge victim, section K).
  ('54000001-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's4-harn@test.local'),
  -- an already-inactive worker (idempotency, section I).
  ('54000001-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's4-inactive@test.local'),
  -- a worker for the atomicity test (a scheduled seat on a NO-period date).
  ('54000001-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's4-atomic@test.local'),
  -- a swap counterparty (home harrison) — the other party on the victim's swaps.
  ('54000001-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's4-counterparty@test.local'),
  -- a currently-floated-out worker (section K).
  ('54000001-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's4-floatout@test.local'),
  -- a HM of harrison for the floated-out / Harnwell / atomic / inactive victims'
  -- home houses (reused as initiator where the victim is home harrison; harnwell
  -- victim gets its own HM below).
  ('54000001-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's4-hmharn@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active, broadcast_subscribed)
VALUES
  ('54000001-0000-0000-0000-000000000001', 'Victim (harrison)',     's4-victim@test.local',       'harrison', true,  true),
  ('54000001-0000-0000-0000-000000000002', 'HM (harrison)',         's4-hm05@test.local',         'harrison', true,  false),
  ('54000001-0000-0000-0000-000000000003', 'BM (harrison)',         's4-bm05@test.local',         'harrison', true,  false),
  ('54000001-0000-0000-0000-000000000004', 'SM (harrison)',         's4-sm05@test.local',         'harrison', true,  false),
  ('54000001-0000-0000-0000-000000000005', 'HM (kings-court)',         's4-hm07@test.local',         'kings-court', true,  false),
  ('54000001-0000-0000-0000-000000000006', 'SW (harrison)',         's4-sw@test.local',           'harrison', true,  false),
  ('54000001-0000-0000-0000-000000000007', 'Coworker (harrison)',   's4-coworker@test.local',     'harrison', true,  false),
  ('54000001-0000-0000-0000-000000000008', 'Coworker2 (harrison)',  's4-coworker2@test.local',    'harrison', true,  false),
  ('54000001-0000-0000-0000-000000000009', 'Harn victim (harnwell)','s4-harn@test.local',         'harnwell', true,  false),
  ('54000001-0000-0000-0000-00000000000a', 'Inactive (harrison)',   's4-inactive@test.local',     'harrison', false, false),
  ('54000001-0000-0000-0000-00000000000b', 'Atomic (harrison)',     's4-atomic@test.local',       'harrison', true,  false),
  ('54000001-0000-0000-0000-00000000000c', 'Counterparty (h05)',    's4-counterparty@test.local', 'harrison', true,  false),
  ('54000001-0000-0000-0000-00000000000d', 'Floatout (harrison)',   's4-floatout@test.local',     'harrison', true,  false),
  ('54000001-0000-0000-0000-00000000000e', 'HM (harnwell)',         's4-hmharn@test.local',       'harnwell', true,  false);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('54000001-0000-0000-0000-000000000001', 'sw', NULL),
  ('54000001-0000-0000-0000-000000000002', 'hm', 'harrison'),   -- authorized initiator
  ('54000001-0000-0000-0000-000000000003', 'bm', 'harrison'),   -- authorized initiator
  ('54000001-0000-0000-0000-000000000004', 'sm', 'harrison'),   -- NOT authorized (HM/BM-only)
  ('54000001-0000-0000-0000-000000000005', 'hm', 'kings-court'),   -- admin of the WRONG house
  ('54000001-0000-0000-0000-000000000006', 'sw', NULL),         -- NOT authorized
  ('54000001-0000-0000-0000-000000000007', 'sw', NULL),
  ('54000001-0000-0000-0000-000000000008', 'sw', NULL),
  ('54000001-0000-0000-0000-000000000009', 'sw', NULL),
  ('54000001-0000-0000-0000-00000000000a', 'sw', NULL),
  ('54000001-0000-0000-0000-00000000000b', 'sw', NULL),
  ('54000001-0000-0000-0000-00000000000c', 'sw', NULL),
  ('54000001-0000-0000-0000-00000000000d', 'sw', NULL),
  ('54000001-0000-0000-0000-00000000000e', 'hm', 'harnwell')    -- authorized for the harnwell victim
ON CONFLICT DO NOTHING;

-- Anchor: 2027-07-01 19:00 America/New_York (EDT). Stored as timestamptz. The same
-- DST-stable Thursday s1-admin-override.sql uses (clears the seed's 2026 e2e period).
SELECT set_config(
  'test.s4.anchor',
  ('2027-07-01 19:00'::timestamp AT TIME ZONE 'America/New_York')::text,
  false
);

-- Operating profile (self-contained; no-op if seeded).
INSERT INTO public.operating_profiles
  (profile_name, shift_start_bound, shift_end_bound, default_hours_cap,
   default_cap_enforcement, scheduling_mode, float_enabled, escalation_chain,
   claim_phase_open_offset, claim_phase_alert_offset, claim_phase_close_offset)
VALUES
  ('regular_school_year', '08:00', '00:00', 20, 'soft', 'sm_built', true, '[]'::jsonb,
   NULL, NULL, NULL)
ON CONFLICT (profile_name) DO NOTHING;

-- Operating calendar: a generous regular_school_year window AROUND the anchor —
-- permanent_drop_slot JOINs operating_calendar oc ON oc.date = block date AND
-- profile_name='regular_school_year', so every block date we expect dropped must
-- have a row. We deliberately leave a HOLE for the atomicity test (see section J).
INSERT INTO public.operating_calendar (date, profile_name)
SELECT g::date, 'regular_school_year'
FROM generate_series(
  ((current_setting('test.s4.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date - 14)::timestamp,
  ((current_setting('test.s4.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date + 60)::timestamp,
  interval '1 day'
) AS g
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

-- Scheduling period: covers the anchor and the +7/+14/+35d weeks; end_date =
-- anchor+60d so permanent_drop_slot resolves the semester for every dropped seat.
INSERT INTO public.scheduling_periods (period_name, profile_name, start_date, end_date)
VALUES (
  'S4 Fall 2027', 'regular_school_year',
  ((current_setting('test.s4.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date - 14),
  ((current_setting('test.s4.anchor')::timestamptz + interval '60 days')
    AT TIME ZONE 'America/New_York')::date
);

-- ============================================================
-- BLOCKS + ASSIGNMENTS for the canonical victim (A–H + L).
--
-- The victim holds, in ONE coherent fixture (the integration scenario L is built
-- on exactly these rows so L can assert the whole end state):
--   * IN-PROGRESS below-headcount block: harrison Thu 19:00 (== anchor),
--     required_headcount 2, only the victim present ⇒ vacating drops to 0 < 2.
--   * RECURRING slot A: harrison Thursdays 17:00 — occurrences at +0(in-prog? no,
--     17:00<19:00 so it's a PAST-today seat → see below), +7, +14, +35 days.
--     To keep "recurring future" crisp we anchor slot A at occurrences strictly
--     future: +7/+14/+35 (Thursdays). A PAST occurrence (-7d 17:00) proves
--     "past untouched".
--   * RECURRING slot B: harrison FRIDAYS 16:00 — a DIFFERENT day-of-week, +1/+8
--     days, proving ≥2 distinct slots dropped in one call.
--   * NON-RECURRING claim: harrison +7d 15:00 (status 'claimed') → temporary_drop.
--   * OUTBOUND pending float: source = victim's home seat (harrison +14d 12:00,
--     floated_out→ wait: pending float ⇒ pending_float_out source / pending_float_in
--     destination at kings-court +14d 12:00).
--   * INBOUND acknowledged float: source = victim's home seat (harrison +21d 12:00,
--     floated_out), destination kings-court +21d 12:00 (floated_in).
--   * OPEN swap: a pending shift_swap on the victim's +35d 17:00 seat.
-- ============================================================

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  -- IN-PROGRESS below-headcount: harrison 19:00 (== anchor), headcount 2.
  ('54000002-0000-0000-0000-0000000019b0', 'harrison', current_setting('test.s4.anchor')::timestamptz, 2),
  -- Recurring slot A (Thursdays 17:00): past (-7d), future +7d / +14d / +35d.
  ('54000002-0000-0000-0000-0000000017c0', 'harrison', (current_setting('test.s4.anchor')::timestamptz - interval '7 days')  - interval '2 hours', 1), -- past
  ('54000002-0000-0000-0000-0000000017c1', 'harrison', (current_setting('test.s4.anchor')::timestamptz + interval '7 days')  - interval '2 hours', 1), -- +7d
  ('54000002-0000-0000-0000-0000000017c2', 'harrison', (current_setting('test.s4.anchor')::timestamptz + interval '14 days') - interval '2 hours', 1), -- +14d
  ('54000002-0000-0000-0000-0000000017c3', 'harrison', (current_setting('test.s4.anchor')::timestamptz + interval '35 days') - interval '2 hours', 1), -- +35d (swap seat)
  -- Recurring slot B (Fridays 16:00 = anchor + 1 day - 3h): +1d / +8d.
  ('54000002-0000-0000-0000-0000000016d0', 'harrison', (current_setting('test.s4.anchor')::timestamptz + interval '1 day')  - interval '3 hours', 1), -- next-day Fri
  ('54000002-0000-0000-0000-0000000016d1', 'harrison', (current_setting('test.s4.anchor')::timestamptz + interval '8 days') - interval '3 hours', 1), -- +8d Fri
  -- Non-recurring claim: harrison +7d 15:00.
  ('54000002-0000-0000-0000-0000000015e0', 'harrison', (current_setting('test.s4.anchor')::timestamptz + interval '7 days') - interval '4 hours', 1),
  -- Outbound pending float: source harrison +14d 12:00, destination kings-court +14d 12:00.
  ('54000002-0000-0000-0000-0000000012f0', 'harrison', (current_setting('test.s4.anchor')::timestamptz + interval '14 days') - interval '7 hours', 1),
  ('54000002-0000-0000-0000-000000071200', 'kings-court', (current_setting('test.s4.anchor')::timestamptz + interval '14 days') - interval '7 hours', 1),
  -- Inbound acknowledged float: source harrison +21d 12:00, destination kings-court +21d 12:00.
  ('54000002-0000-0000-0000-0000000012f1', 'harrison', (current_setting('test.s4.anchor')::timestamptz + interval '21 days') - interval '7 hours', 1),
  ('54000002-0000-0000-0000-000000071201', 'kings-court', (current_setting('test.s4.anchor')::timestamptz + interval '21 days') - interval '7 hours', 1);

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id, parent_float_id)
VALUES
  -- In-progress: ONLY the victim present on a headcount-2 desk (vacating → 0 < 2).
  ('54000003-0000-0000-0000-0000000019b0', '54000002-0000-0000-0000-0000000019b0',
   '54000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL, NULL),
  -- Recurring slot A occurrences (scheduled).
  ('54000003-0000-0000-0000-0000000017c0', '54000002-0000-0000-0000-0000000017c0',
   '54000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL, NULL), -- past
  ('54000003-0000-0000-0000-0000000017c1', '54000002-0000-0000-0000-0000000017c1',
   '54000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL, NULL), -- +7d
  ('54000003-0000-0000-0000-0000000017c2', '54000002-0000-0000-0000-0000000017c2',
   '54000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL, NULL), -- +14d
  ('54000003-0000-0000-0000-0000000017c3', '54000002-0000-0000-0000-0000000017c3',
   '54000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL, NULL), -- +35d (swap seat)
  -- Recurring slot B occurrences (scheduled).
  ('54000003-0000-0000-0000-0000000016d0', '54000002-0000-0000-0000-0000000016d0',
   '54000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL, NULL), -- +1d Fri
  ('54000003-0000-0000-0000-0000000016d1', '54000002-0000-0000-0000-0000000016d1',
   '54000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL, NULL), -- +8d Fri
  -- Non-recurring claim (claimed).
  ('54000003-0000-0000-0000-0000000015e0', '54000002-0000-0000-0000-0000000015e0',
   '54000001-0000-0000-0000-000000000001', 'claimed', 'none', false, NULL, NULL),
  -- Outbound pending float: source (pending_float_out), destination (pending_float_in).
  ('54000003-0000-0000-0000-0000000012f0', '54000002-0000-0000-0000-0000000012f0',
   '54000001-0000-0000-0000-000000000001', 'pending_float_out', 'none', false, NULL, NULL),
  ('54000003-0000-0000-0000-000000071200', '54000002-0000-0000-0000-000000071200',
   '54000001-0000-0000-0000-000000000001', 'pending_float_in', 'none', true, 'harrison', NULL),
  -- Inbound acknowledged float: source (floated_out), destination (floated_in).
  ('54000003-0000-0000-0000-0000000012f1', '54000002-0000-0000-0000-0000000012f1',
   '54000001-0000-0000-0000-000000000001', 'floated_out', 'none', false, NULL, NULL),
  ('54000003-0000-0000-0000-000000071201', '54000002-0000-0000-0000-000000071201',
   '54000001-0000-0000-0000-000000000001', 'floated_in', 'none', true, 'harrison', NULL);

-- The two float rows (the victim is the floater on BOTH; user_id = victim).
INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids, status,
   initiated_by, force_triggered_by, expires_for_cleanup_at)
VALUES
  -- Outbound PENDING (automated).
  ('54000004-0000-0000-0000-000000000f00',
   '54000001-0000-0000-0000-000000000001',
   ARRAY['54000003-0000-0000-0000-0000000012f0']::uuid[],
   ARRAY['54000003-0000-0000-0000-000000071200']::uuid[],
   'pending', 'automated', NULL,
   current_setting('test.s4.anchor')::timestamptz + interval '30 days'),
  -- Inbound ACKNOWLEDGED (automated) — no-takeback would normally protect it.
  ('54000004-0000-0000-0000-000000000f01',
   '54000001-0000-0000-0000-000000000001',
   ARRAY['54000003-0000-0000-0000-0000000012f1']::uuid[],
   ARRAY['54000003-0000-0000-0000-000000071201']::uuid[],
   'acknowledged', 'automated', NULL,
   current_setting('test.s4.anchor')::timestamptz + interval '30 days');

-- Stamp the destination seats' parent_float_id (the reverse FK decline_float clears).
UPDATE public.shift_block_assignments
SET parent_float_id = '54000004-0000-0000-0000-000000000f00'
WHERE assignment_id = '54000003-0000-0000-0000-000000071200';
UPDATE public.shift_block_assignments
SET parent_float_id = '54000004-0000-0000-0000-000000000f01'
WHERE assignment_id = '54000003-0000-0000-0000-000000071201';

-- One OPEN (pending) swap on the victim's +35d 17:00 seat (initiator = victim).
INSERT INTO public.swap_requests
  (swap_id, swap_type, initiator_user_id, counterparty_user_id,
   initiator_assignment_ids, counterparty_assignment_ids, status, expires_at)
VALUES
  ('54000005-0000-0000-0000-000000000a00', 'shift_swap',
   '54000001-0000-0000-0000-000000000001', '54000001-0000-0000-0000-00000000000c',
   ARRAY['54000003-0000-0000-0000-0000000017c3']::uuid[],
   ARRAY['54000003-0000-0000-0000-0000000019b0']::uuid[],  -- counterparty's seat (any valid assignment)
   'pending',
   current_setting('test.s4.anchor')::timestamptz + interval '20 days');

-- ============================================================
-- A. EXISTENCE & SHAPE (TEST_PLAN A; PIN 1).
-- ============================================================

SELECT has_function(
  'public', 'fire_worker',
  ARRAY['uuid', 'uuid', 'timestamptz'],
  'should expose fire_worker(uuid, uuid, timestamptz) returning jsonb'
);
SELECT is(
  (SELECT prosecdef FROM pg_proc WHERE proname = 'fire_worker'
   AND pronargs = 3 LIMIT 1),
  true,
  'should be SECURITY DEFINER, revoked from PUBLIC, granted to service_role (SECURITY DEFINER)'
);
SELECT is(
  (SELECT has_function_privilege('service_role', p.oid, 'EXECUTE')
   FROM pg_proc p WHERE p.proname = 'fire_worker' AND p.pronargs = 3 LIMIT 1),
  true,
  'should be SECURITY DEFINER, revoked from PUBLIC, granted to service_role (service_role EXECUTE granted)'
);
SELECT is(
  (SELECT has_function_privilege('public', p.oid, 'EXECUTE')
   FROM pg_proc p WHERE p.proname = 'fire_worker' AND p.pronargs = 3 LIMIT 1),
  false,
  'should be SECURITY DEFINER, revoked from PUBLIC, granted to service_role (PUBLIC EXECUTE revoked)'
);

-- ============================================================
-- B. PERMISSIONS (TEST_PLAN B). The gate is user_has_house_admin_role of the
--    VICTIM'S home house (HM/BM-only). We probe the rejections against a DEDICATED
--    permission-victim so the canonical victim above stays pristine for C–L (a
--    rejection rolls back its own statement, but a SUCCESS would consume seats).
-- ============================================================

-- A dedicated, obligation-free permission victim (home harrison).
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('54000001-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 's4-permvictim@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES ('54000001-0000-0000-0000-0000000000b0', 'PermVictim (h05)', 's4-permvictim@test.local', 'harrison', true);
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('54000001-0000-0000-0000-0000000000b0', 'sw', NULL) ON CONFLICT DO NOTHING;

SELECT throws_ok(
  $$ SELECT public.fire_worker(
       '54000001-0000-0000-0000-000000000006'::uuid,   -- a plain SW initiator
       '54000001-0000-0000-0000-0000000000b0'::uuid,   -- the permission victim
       current_setting('test.s4.anchor')::timestamptz) $$,
  'P0001', 'not_authorized',
  'should reject when initiator is a plain SW (not_authorized)'
);
SELECT throws_ok(
  $$ SELECT public.fire_worker(
       '54000001-0000-0000-0000-000000000004'::uuid,   -- SM of harrison (the victim's home house)
       '54000001-0000-0000-0000-0000000000b0'::uuid,
       current_setting('test.s4.anchor')::timestamptz) $$,
  'P0001', 'not_authorized',
  'should reject when initiator is an SM of the worker''s home house (people-admin is HM/BM-only)'
);
SELECT throws_ok(
  $$ SELECT public.fire_worker(
       '54000001-0000-0000-0000-000000000005'::uuid,   -- HM of kings-court (a DIFFERENT house)
       '54000001-0000-0000-0000-0000000000b0'::uuid,
       current_setting('test.s4.anchor')::timestamptz) $$,
  'P0001', 'not_authorized',
  'should reject when initiator is an HM of a DIFFERENT house (not_authorized)'
);
SELECT throws_ok(
  $$ SELECT public.fire_worker(
       '54000001-0000-0000-0000-000000000002'::uuid,   -- HM of harrison
       '54000001-0000-0000-0000-0000000000ff'::uuid,   -- no such users row
       current_setting('test.s4.anchor')::timestamptz) $$,
  'P0001', 'worker_not_found',
  'should reject a non-existent worker (worker_not_found)'
);
-- Allowed: the HM of the worker's home house fires the obligation-free perm victim.
SELECT lives_ok(
  $$ SELECT public.fire_worker(
       '54000001-0000-0000-0000-000000000002'::uuid,   -- HM of harrison
       '54000001-0000-0000-0000-0000000000b0'::uuid,
       current_setting('test.s4.anchor')::timestamptz) $$,
  'should allow when initiator is the HM of the worker''s home house'
);
SELECT is(
  (SELECT is_active FROM public.users WHERE user_id = '54000001-0000-0000-0000-0000000000b0'),
  false,
  'should allow when initiator is the HM of the worker''s home house (worker deactivated)'
);
-- Allowed: the BM of the worker's home house. Use a SECOND obligation-free victim.
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('54000001-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 's4-permvictim2@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES ('54000001-0000-0000-0000-0000000000b1', 'PermVictim2 (h05)', 's4-permvictim2@test.local', 'harrison', true);
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('54000001-0000-0000-0000-0000000000b1', 'sw', NULL) ON CONFLICT DO NOTHING;
SELECT lives_ok(
  $$ SELECT public.fire_worker(
       '54000001-0000-0000-0000-000000000003'::uuid,   -- BM of harrison
       '54000001-0000-0000-0000-0000000000b1'::uuid,
       current_setting('test.s4.anchor')::timestamptz) $$,
  'should allow when initiator is the BM of the worker''s home house'
);

-- ============================================================
-- THE BIG FIRE. Fire the canonical victim ONCE (HM of harrison). Sections C–H + L
--    assert the resulting end state; the returned jsonb is captured for the count
--    assertions. (One fire, many asserts — the high-blast-radius action exercised
--    in full per the user's "thorough tests" ask.)
-- ============================================================

SELECT set_config(
  'test.s4.fire',
  (public.fire_worker(
     '54000001-0000-0000-0000-000000000002'::uuid,     -- HM of harrison
     '54000001-0000-0000-0000-000000000001'::uuid,     -- the canonical victim
     current_setting('test.s4.anchor')::timestamptz
   ))::text,
  false
);

-- ============================================================
-- C. FUTURE RECURRING SLOTS → PERMANENT DROP (TEST_PLAN C).
-- ============================================================

SELECT is(
  (SELECT status::text || '/' || vacancy_origin::text
   FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000017c1'),
  'vacant/permanent_drop',
  'should permanent-drop every future occurrence of each recurring (scheduled) slot the worker owns (+7d slot-A)'
);
SELECT is(
  (SELECT status::text || '/' || vacancy_origin::text
   FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000017c2'),
  'vacant/permanent_drop',
  'should permanent-drop every future occurrence of each recurring (scheduled) slot the worker owns (+14d slot-A)'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000017c0'),
  '54000001-0000-0000-0000-000000000001'::uuid,
  'should leave PAST occurrences (block_start_at < now) untouched (still held by the worker)'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000017c0'),
  'scheduled',
  'should leave PAST occurrences (block_start_at < now) untouched (status unchanged)'
);
-- §8.4.1 skip-current: the CURRENT-week occurrence (the in-progress 19:00 anchor
-- block) is NOT permanent-dropped — it is the mid-shift temporary drop (handled in
-- section E), so it never becomes a permanent_drop / never enters the permanent feed.
SELECT isnt(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000019b0'),
  'permanent_drop',
  'should leave the CURRENT-week occurrence untouched when it is the in-progress/at-start block (NOT permanent-dropped — §8.4.1 skip-current)'
);
-- Slot B (a DIFFERENT day-of-week) future occurrences are dropped too.
SELECT is(
  (SELECT status::text || '/' || vacancy_origin::text
   FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000016d1'),
  'vacant/permanent_drop',
  'should drop recurring occurrences across >=2 distinct slots (different day-of-week / house) in one call (slot-B +8d)'
);
SELECT is(
  (SELECT status::text || '/' || vacancy_origin::text
   FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000016d0'),
  'vacant/permanent_drop',
  'should drop recurring occurrences across >=2 distinct slots (different day-of-week / house) in one call (slot-B +1d)'
);
-- The dropped recurring slots surface in the permanent openings feed.
SELECT is(
  (SELECT count(*)::integer FROM public.permanent_openings_feed('harrison', current_setting('test.s4.anchor')::timestamptz)
   WHERE block_start_time = '17:00'),
  1,
  'should surface dropped recurring occurrences in the permanent_openings_feed (slot-A 17:00)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.permanent_openings_feed('harrison', current_setting('test.s4.anchor')::timestamptz)
   WHERE block_start_time = '16:00'),
  1,
  'should surface dropped recurring occurrences in the permanent_openings_feed (slot-B 16:00)'
);
-- ============================================================
-- D. FUTURE NON-RECURRING CLAIMS → VACATE (weekly feed, not permanent) (TEST_PLAN D).
-- ============================================================

SELECT is(
  (SELECT status::text || '/' || vacancy_origin::text
   FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000015e0'),
  'vacant/temporary_drop',
  'should vacate every future claimed seat to vacancy_origin=temporary_drop (NOT permanent_drop)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.weekly_open_shifts_feed('harrison', current_setting('test.s4.anchor')::timestamptz)
   WHERE assignment_id = '54000003-0000-0000-0000-0000000015e0'),
  1,
  'should surface vacated non-recurring occurrences in the weekly_open_shifts_feed when within 30 days'
);
SELECT is(
  (SELECT count(*)::integer FROM public.permanent_openings_feed('harrison', current_setting('test.s4.anchor')::timestamptz)
   WHERE block_start_time = '15:00'),
  0,
  'should NOT place a vacated non-recurring seat in the permanent_openings_feed'
);

-- ============================================================
-- E. IN-PROGRESS BLOCK — the urgency branch (TEST_PLAN E; PIN 3).
-- ============================================================

SELECT is(
  (SELECT status::text || '/' || vacancy_origin::text
   FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000019b0'),
  'vacant/temporary_drop',
  'should vacate the in-progress block immediately (vacant/temporary_drop)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.block_step_status
   WHERE block_id = '54000002-0000-0000-0000-0000000019b0'
     AND step_name = 'float_lookup' AND status = 'fired'),
  1,
  'should write a float_lookup block_step_status row (status fired) when vacating drops the desk below required headcount'
);
SELECT is(
  (SELECT count(*)::integer FROM public.block_step_status
   WHERE block_id = '54000002-0000-0000-0000-0000000019b0'
     AND step_name = 'broadcast'),
  0,
  'should NOT write a broadcast block_step_status row for that in-progress block (broadcast skipped)'
);
SELECT is(
  current_setting('test.s4.fire')::jsonb ->> 'in_progress_escalated',
  'true',
  'should report in_progress_escalated=true only in the below-headcount case'
);

-- The at/above-headcount case: a SEPARATE in-progress overstaffed desk → NO step.
-- A now()-instant in-progress block must start exactly at p_now (the 30-min span
-- start), so it cannot share harrison's anchor slot (UNIQUE house_id+start). Put it
-- at kings-court 19:00 (headcount 1) with the over-victim + a coworker present; firing
-- the over-victim leaves the coworker (1 >= 1). The over-victim is home kings-court, so
-- the HM of kings-court is the authorized initiator.
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('54000001-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 's4-ovictim@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES ('54000001-0000-0000-0000-0000000000c0', 'OverVictim (h07)', 's4-ovictim@test.local', 'kings-court', true);
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('54000001-0000-0000-0000-0000000000c0', 'sw', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES ('54000002-0000-0000-0000-0000000019c0', 'kings-court', current_setting('test.s4.anchor')::timestamptz, 1);
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES
  ('54000003-0000-0000-0000-0000000019c0', '54000002-0000-0000-0000-0000000019c0',
   '54000001-0000-0000-0000-0000000000c0', 'scheduled', 'none', false, NULL),       -- the over-victim (home kings-court)
  ('54000003-0000-0000-0000-0000000019c1', '54000002-0000-0000-0000-0000000019c0',
   '54000001-0000-0000-0000-000000000007', 'scheduled', 'none', false, NULL);       -- a coworker who stays
SELECT set_config(
  'test.s4.fire_over',
  (public.fire_worker(
     '54000001-0000-0000-0000-000000000005'::uuid,                                  -- HM of kings-court
     '54000001-0000-0000-0000-0000000000c0'::uuid,                                  -- the over-victim (home kings-court)
     current_setting('test.s4.anchor')::timestamptz
   ))::text,
  false
);
SELECT is(
  (SELECT count(*)::integer FROM public.block_step_status
   WHERE block_id = '54000002-0000-0000-0000-0000000019c0'),
  0,
  'should NOT write any escalation step when the desk stays at/above required headcount after vacating'
);
SELECT is(
  current_setting('test.s4.fire_over')::jsonb ->> 'in_progress_escalated',
  'false',
  'should report in_progress_escalated=true only in the below-headcount case (at/above ⇒ false)'
);

-- ============================================================
-- F. FLOATS VOIDED + RE-LOOKUP EXCLUDES THE WORKER (no-takeback waived) (TEST_PLAN F).
-- ============================================================

SELECT is(
  (SELECT status::text FROM public.float_assignments WHERE float_id = '54000004-0000-0000-0000-000000000f00'),
  'voided',
  'should void a PENDING float held by the worker (status -> voided)'
);
SELECT is(
  (SELECT status::text FROM public.float_assignments WHERE float_id = '54000004-0000-0000-0000-000000000f01'),
  'voided',
  'should void an ACKNOWLEDGED float held by the worker (status -> voided) — no-takeback waiver'
);
SELECT is(
  (SELECT status::text || '/' || vacancy_origin::text
   FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-000000071200'),
  'vacant/temporary_drop',
  'should reopen each voided float''s DESTINATION seat as vacant/temporary_drop (pending float dest)'
);
SELECT is(
  (SELECT status::text || '/' || vacancy_origin::text
   FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-000000071201'),
  'vacant/temporary_drop',
  'should reopen each voided float''s DESTINATION seat as vacant/temporary_drop (acknowledged float dest)'
);
-- Source seats are restored to the worker, then permanent-dropped as recurring
-- slots (they are future harrison 12:00 seats ⇒ slot drop). End state: vacant /
-- permanent_drop, NOT floated_out / pending_float_out.
SELECT is(
  (SELECT status::text || '/' || vacancy_origin::text
   FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000012f0'),
  'vacant/permanent_drop',
  'should restore the voided float''s SOURCE seat to the worker, then permanent-drop it (pending float source)'
);
SELECT is(
  (SELECT status::text || '/' || vacancy_origin::text
   FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000012f1'),
  'vacant/permanent_drop',
  'should restore the voided float''s SOURCE seat to the worker, then permanent-drop it (acknowledged float source)'
);
-- The is_active gate is what excludes the fired worker from any re-lookup.
SELECT is(
  (SELECT is_active FROM public.users WHERE user_id = '54000001-0000-0000-0000-000000000001'),
  false,
  'should leave the fired worker is_active=false so the standard float-lookup eligibility gate excludes them from any re-lookup'
);

-- Force-trigger premark rollback (mirror decline_float step 4): a SEPARATE
-- force-triggered float whose destination block carries broadcast/float_lookup
-- premarks → firing the floater rolls them to 'rolled_back'.
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('54000001-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 's4-ftvictim@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES ('54000001-0000-0000-0000-0000000000d0', 'FTVictim (h05)', 's4-ftvictim@test.local', 'harrison', true);
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('54000001-0000-0000-0000-0000000000d0', 'sw', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('54000002-0000-0000-0000-0000000012e0', 'harrison', (current_setting('test.s4.anchor')::timestamptz + interval '14 days') - interval '8 hours', 1),
  ('54000002-0000-0000-0000-000000071280', 'kings-court', (current_setting('test.s4.anchor')::timestamptz + interval '14 days') - interval '8 hours', 1);
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES
  ('54000003-0000-0000-0000-0000000012e0', '54000002-0000-0000-0000-0000000012e0',
   '54000001-0000-0000-0000-0000000000d0', 'pending_float_out', 'none', false, NULL),
  ('54000003-0000-0000-0000-000000071280', '54000002-0000-0000-0000-000000071280',
   '54000001-0000-0000-0000-0000000000d0', 'pending_float_in', 'none', true, 'harrison');
INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids, status,
   initiated_by, force_triggered_by, expires_for_cleanup_at)
VALUES
  ('54000004-0000-0000-0000-000000000e00',
   '54000001-0000-0000-0000-0000000000d0',
   ARRAY['54000003-0000-0000-0000-0000000012e0']::uuid[],
   ARRAY['54000003-0000-0000-0000-000000071280']::uuid[],
   'pending', 'force_triggered', '54000001-0000-0000-0000-000000000004',
   current_setting('test.s4.anchor')::timestamptz + interval '30 days');
-- The destination block's premarks (the force-trigger left these 'fired').
INSERT INTO public.block_step_status (block_id, step_name, status, fired_at, updated_at)
VALUES
  ('54000002-0000-0000-0000-000000071280', 'broadcast',    'fired', current_setting('test.s4.anchor')::timestamptz, current_setting('test.s4.anchor')::timestamptz),
  ('54000002-0000-0000-0000-000000071280', 'float_lookup', 'fired', current_setting('test.s4.anchor')::timestamptz, current_setting('test.s4.anchor')::timestamptz);
SELECT public.fire_worker(
  '54000001-0000-0000-0000-000000000002'::uuid,
  '54000001-0000-0000-0000-0000000000d0'::uuid,
  current_setting('test.s4.anchor')::timestamptz
);
SELECT is(
  (SELECT count(*)::integer FROM public.block_step_status
   WHERE block_id = '54000002-0000-0000-0000-000000071280'
     AND step_name IN ('broadcast', 'float_lookup')
     AND status = 'rolled_back'),
  2,
  'should roll back the destination block''s broadcast/float_lookup premarks to rolled_back so the chain re-evaluates'
);

-- A worker holding ONLY an already-resolved float (declined) → that float is NOT
-- re-voided (only pending|acknowledged are voided).
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('54000001-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 's4-declvictim@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES ('54000001-0000-0000-0000-0000000000d1', 'DeclVictim (h05)', 's4-declvictim@test.local', 'harrison', true);
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('54000001-0000-0000-0000-0000000000d1', 'sw', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('54000002-0000-0000-0000-0000000012e1', 'harrison', (current_setting('test.s4.anchor')::timestamptz + interval '14 days') - interval '9 hours', 1),
  ('54000002-0000-0000-0000-000000071281', 'kings-court', (current_setting('test.s4.anchor')::timestamptz + interval '14 days') - interval '9 hours', 1);
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES
  ('54000003-0000-0000-0000-0000000012e1', '54000002-0000-0000-0000-0000000012e1',
   '54000001-0000-0000-0000-0000000000d1', 'scheduled', 'none', false, NULL),
  ('54000003-0000-0000-0000-000000071281', '54000002-0000-0000-0000-000000071281',
   NULL, 'vacant', 'temporary_drop', false, NULL);
INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids, status,
   initiated_by, force_triggered_by, declined_at, expires_for_cleanup_at)
VALUES
  ('54000004-0000-0000-0000-000000000e01',
   '54000001-0000-0000-0000-0000000000d1',
   ARRAY['54000003-0000-0000-0000-0000000012e1']::uuid[],
   ARRAY['54000003-0000-0000-0000-000000071281']::uuid[],
   'declined', 'automated', NULL,
   current_setting('test.s4.anchor')::timestamptz - interval '1 day',
   current_setting('test.s4.anchor')::timestamptz + interval '30 days');
SELECT public.fire_worker(
  '54000001-0000-0000-0000-000000000002'::uuid,
  '54000001-0000-0000-0000-0000000000d1'::uuid,
  current_setting('test.s4.anchor')::timestamptz
);
SELECT is(
  (SELECT status::text FROM public.float_assignments WHERE float_id = '54000004-0000-0000-0000-000000000e01'),
  'declined',
  'should NOT void a worker''s float that is already declined/voided/completed (only pending|acknowledged)'
);

-- ============================================================
-- G. SWAPS VOIDED (TEST_PLAN G).
-- ============================================================

-- The canonical victim's INITIATOR swap (on the +35d 17:00 seat) is voided.
SELECT is(
  (SELECT status::text FROM public.swap_requests WHERE swap_id = '54000005-0000-0000-0000-000000000a00'),
  'voided',
  'should void every pending swap where the worker is the INITIATOR (status -> voided)'
);

-- A dedicated counterparty case + a non-pending case (so they don't perturb the
-- canonical victim). Fire a fresh worker who is the COUNTERPARTY on a pending swap
-- and ALSO referenced by an accepted swap that must stay untouched.
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('54000001-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 's4-swapvictim@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES ('54000001-0000-0000-0000-0000000000e0', 'SwapVictim (h05)', 's4-swapvictim@test.local', 'harrison', true);
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('54000001-0000-0000-0000-0000000000e0', 'sw', NULL) ON CONFLICT DO NOTHING;
-- A pristine future seat that the swap-victim holds (so firing has a seat to act on
-- but the swap-void assertions are about swap_requests rows, not seat unwinding).
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES ('54000002-0000-0000-0000-0000000013e0', 'harrison', (current_setting('test.s4.anchor')::timestamptz + interval '14 days') - interval '6 hours', 1);
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES ('54000003-0000-0000-0000-0000000013e0', '54000002-0000-0000-0000-0000000013e0',
   '54000001-0000-0000-0000-0000000000e0', 'scheduled', 'none', false, NULL);
-- A PENDING swap where the swap-victim is the COUNTERPARTY.
INSERT INTO public.swap_requests
  (swap_id, swap_type, initiator_user_id, counterparty_user_id,
   initiator_assignment_ids, counterparty_assignment_ids, status, expires_at)
VALUES
  ('54000005-0000-0000-0000-000000000b00', 'shift_swap',
   '54000001-0000-0000-0000-00000000000c', '54000001-0000-0000-0000-0000000000e0',
   ARRAY['54000003-0000-0000-0000-0000000013e0']::uuid[],
   ARRAY['54000003-0000-0000-0000-0000000017c0']::uuid[],  -- any valid (past) seat
   'pending',
   current_setting('test.s4.anchor')::timestamptz + interval '20 days');
-- An ACCEPTED swap referencing the swap-victim — must stay untouched.
INSERT INTO public.swap_requests
  (swap_id, swap_type, initiator_user_id, counterparty_user_id,
   initiator_assignment_ids, counterparty_assignment_ids, status, expires_at)
VALUES
  ('54000005-0000-0000-0000-000000000b01', 'shift_swap',
   '54000001-0000-0000-0000-0000000000e0', '54000001-0000-0000-0000-00000000000c',
   ARRAY['54000003-0000-0000-0000-0000000017c0']::uuid[],
   ARRAY['54000003-0000-0000-0000-0000000017c0']::uuid[],
   'accepted',
   current_setting('test.s4.anchor')::timestamptz + interval '20 days');
SELECT public.fire_worker(
  '54000001-0000-0000-0000-000000000002'::uuid,
  '54000001-0000-0000-0000-0000000000e0'::uuid,
  current_setting('test.s4.anchor')::timestamptz
);
SELECT is(
  (SELECT status::text FROM public.swap_requests WHERE swap_id = '54000005-0000-0000-0000-000000000b00'),
  'voided',
  'should void every pending swap where the worker is the COUNTERPARTY (status -> voided)'
);
SELECT is(
  (SELECT status::text FROM public.swap_requests WHERE swap_id = '54000005-0000-0000-0000-000000000b01'),
  'accepted',
  'should leave non-pending swaps (accepted/expired/rejected/voided) untouched'
);

-- ============================================================
-- H. DEACTIVATION & FUTURE EXCLUSION (TEST_PLAN H).
-- ============================================================

SELECT is(
  (SELECT is_active FROM public.users WHERE user_id = '54000001-0000-0000-0000-000000000001'),
  false,
  'should set users.is_active=false'
);
SELECT is(
  (SELECT broadcast_subscribed FROM public.users WHERE user_id = '54000001-0000-0000-0000-000000000001'),
  false,
  'should auto-clear broadcast_subscribed when deactivating a subscribed worker'
);
-- Unclaimable afterward: claim_open_shift raises user_inactive for the fired worker.
-- (Use a fresh vacant harrison seat well in the future.)
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES ('54000002-0000-0000-0000-0000000014a0', 'harrison', (current_setting('test.s4.anchor')::timestamptz + interval '21 days') - interval '5 hours', 1);
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES ('54000003-0000-0000-0000-0000000014a0', '54000002-0000-0000-0000-0000000014a0',
   NULL, 'vacant', 'never_assigned', false, NULL);
SELECT throws_ok(
  $$ SELECT public.claim_open_shift(
       '54000003-0000-0000-0000-0000000014a0'::uuid,
       '54000001-0000-0000-0000-000000000001'::uuid,
       current_setting('test.s4.anchor')::timestamptz) $$,
  'user_inactive',
  'should make the fired worker unclaimable afterward (claim attempt fails on the is_active gate)'
);
-- Float-pool exclusion: the eligibility helper rejects an inactive worker. Assert
-- via the is_active state already proven (no float row was created for the fired
-- worker by the fire — voids only), plus the DB-side claim gate above. The pure
-- isEligibleForFloatLookup(inactive) === false is the Vitest surface; here we pin
-- the DB invariant the gate relies on.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.float_assignments
    WHERE user_id = '54000001-0000-0000-0000-000000000001'
      AND status IN ('pending', 'acknowledged')
  ),
  'should exclude the fired worker from the float-lookup eligibility pool afterward (no live float remains for them)'
);
-- Other workers untouched: the coworker who shared the over-headcount in-progress
-- desk (seat ...19c1) still holds their seat after the canonical fire.
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000019c1'),
  '54000001-0000-0000-0000-000000000007'::uuid,
  'should not break a published schedule''s other workers (only the fired worker''s seats change)'
);

-- The canonical fire's returned counts (the success shape, PIN 1).
SELECT is(
  current_setting('test.s4.fire')::jsonb ->> 'fired', 'true',
  'the canonical fire returned fired=true'
);
SELECT cmp_ok(
  (current_setting('test.s4.fire')::jsonb ->> 'recurring_seats_dropped')::integer,
  '>=', 6,
  'the canonical fire returned recurring_seats_dropped covering both slots + the two restored float sources'
);
SELECT is(
  (current_setting('test.s4.fire')::jsonb ->> 'non_recurring_vacated')::integer, 1,
  'the canonical fire returned non_recurring_vacated = 1 (the +7d claim)'
);
SELECT is(
  (current_setting('test.s4.fire')::jsonb ->> 'floats_voided')::integer, 2,
  'the canonical fire returned floats_voided = 2'
);
SELECT cmp_ok(
  (current_setting('test.s4.fire')::jsonb ->> 'swaps_voided')::integer,
  '>=', 1,
  'the canonical fire returned swaps_voided >= 1 (the initiator swap)'
);

-- ============================================================
-- I. IDEMPOTENCY (TEST_PLAN I).
-- ============================================================

-- The pre-seeded already-inactive worker → safe no-op.
SELECT set_config(
  'test.s4.noop',
  (public.fire_worker(
     '54000001-0000-0000-0000-000000000002'::uuid,
     '54000001-0000-0000-0000-00000000000a'::uuid,   -- already inactive
     current_setting('test.s4.anchor')::timestamptz
   ))::text,
  false
);
SELECT is(
  current_setting('test.s4.noop')::jsonb,
  '{"fired": false, "already_inactive": true, "in_progress_escalated": false, "recurring_seats_dropped": 0, "non_recurring_vacated": 0, "floats_voided": 0, "swaps_voided": 0}'::jsonb,
  'should be a safe no-op on an already-inactive worker (already_inactive=true, fired=false, all-zero counts)'
);
-- Firing the canonical victim a SECOND time is now a no-op (already inactive).
SELECT set_config(
  'test.s4.refire',
  (public.fire_worker(
     '54000001-0000-0000-0000-000000000002'::uuid,
     '54000001-0000-0000-0000-000000000001'::uuid,   -- already fired above
     current_setting('test.s4.anchor')::timestamptz
   ))::text,
  false
);
SELECT is(
  current_setting('test.s4.refire')::jsonb ->> 'already_inactive', 'true',
  'should not double-drop when fired twice (second call is a no-op)'
);
SELECT is(
  (current_setting('test.s4.refire')::jsonb ->> 'recurring_seats_dropped')::integer, 0,
  'should not double-drop when fired twice (second call drops nothing)'
);

-- ============================================================
-- J. ATOMICITY — rollback on a raised sub-step (TEST_PLAN J).
--    permanent_drop_slot resolves the semester from p_drop_initiated_at (the firing
--    instant), raising semester_boundary_not_found when THAT date has no
--    regular_school_year period. So we fire AS OF a date FAR outside any period
--    (anchor + 400 days — no operating_calendar / scheduling_periods row that far),
--    with the atomic victim holding a future SCHEDULED (recurring) seat at +407d
--    (future relative to that as-of, so the recurring-drop step runs and raises).
--    The whole fire must then roll back — nothing about the worker changes.
-- ============================================================

SELECT set_config(
  'test.s4.atomic_now',
  (current_setting('test.s4.anchor')::timestamptz + interval '400 days')::text,
  false
);
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES ('54000002-0000-0000-0000-0000000099a0', 'harrison', (current_setting('test.s4.anchor')::timestamptz + interval '407 days'), 1);
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES ('54000003-0000-0000-0000-0000000099a0', '54000002-0000-0000-0000-0000000099a0',
   '54000001-0000-0000-0000-00000000000b', 'scheduled', 'none', false, NULL);
-- Also give the atomic victim a pending swap + subscribed flag, so the rollback is
-- observable on multiple surfaces (nothing may change).
UPDATE public.users SET broadcast_subscribed = true WHERE user_id = '54000001-0000-0000-0000-00000000000b';
INSERT INTO public.swap_requests
  (swap_id, swap_type, initiator_user_id, counterparty_user_id,
   initiator_assignment_ids, counterparty_assignment_ids, status, expires_at)
VALUES
  ('54000005-0000-0000-0000-000000000c00', 'shift_swap',
   '54000001-0000-0000-0000-00000000000b', '54000001-0000-0000-0000-00000000000c',
   ARRAY['54000003-0000-0000-0000-0000000099a0']::uuid[],
   ARRAY['54000003-0000-0000-0000-0000000017c0']::uuid[],
   'pending',
   current_setting('test.s4.anchor')::timestamptz + interval '500 days');
SELECT throws_ok(
  $$ SELECT public.fire_worker(
       '54000001-0000-0000-0000-000000000002'::uuid,
       '54000001-0000-0000-0000-00000000000b'::uuid,
       current_setting('test.s4.atomic_now')::timestamptz) $$,
  'P0001', NULL,
  'should roll the ENTIRE fire back when a sub-step raises (semester_boundary_not_found propagates as P0001)'
);
SELECT is(
  (SELECT is_active FROM public.users WHERE user_id = '54000001-0000-0000-0000-00000000000b'),
  true,
  'atomicity: the worker stays is_active=true after the rolled-back fire'
);
SELECT is(
  (SELECT broadcast_subscribed FROM public.users WHERE user_id = '54000001-0000-0000-0000-00000000000b'),
  true,
  'atomicity: broadcast_subscribed is unchanged after the rolled-back fire'
);
SELECT is(
  (SELECT status::text FROM public.swap_requests WHERE swap_id = '54000005-0000-0000-0000-000000000c00'),
  'pending',
  'atomicity: the worker''s pending swap is unchanged after the rolled-back fire'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000099a0'),
  'scheduled',
  'atomicity: the worker''s scheduled seat is unchanged after the rolled-back fire'
);

-- ============================================================
-- K. INVARIANT EDGES (TEST_PLAN K).
-- ============================================================

-- A Harnwell worker: a future Harnwell recurring seat. Firing drops it; no
-- non-Harnwell worker may be auto-seated on the Harnwell block (firing places none).
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES ('54000002-0000-0000-0000-0000000aa001', 'harnwell', (current_setting('test.s4.anchor')::timestamptz + interval '7 days') - interval '5 hours', 1)
ON CONFLICT (house_id, block_start_at) DO NOTHING;
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES ('54000003-0000-0000-0000-0000000aa001', '54000002-0000-0000-0000-0000000aa001',
   '54000001-0000-0000-0000-000000000009', 'scheduled', 'none', false, NULL);
SELECT lives_ok(
  $$ SELECT public.fire_worker(
       '54000001-0000-0000-0000-00000000000e'::uuid,   -- HM of harnwell
       '54000001-0000-0000-0000-000000000009'::uuid,   -- the Harnwell victim
       current_setting('test.s4.anchor')::timestamptz) $$,
  'should unwind a Harnwell worker (home_house=harnwell) cleanly (the fire succeeds)'
);
SELECT is(
  (SELECT status::text || '/' || vacancy_origin::text
   FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000aa001'),
  'vacant/permanent_drop',
  'should unwind a Harnwell worker cleanly (the Harnwell seat is reopened, not refilled)'
);
SELECT is(
  (SELECT is_active FROM public.users WHERE user_id = '54000001-0000-0000-0000-000000000009'),
  false,
  'should unwind a Harnwell worker cleanly (worker deactivated)'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.shift_block_assignments sba
    JOIN public.users u ON u.user_id = sba.user_id
    WHERE sba.block_id = '54000002-0000-0000-0000-0000000aa001'
      AND sba.user_id IS NOT NULL
      AND u.home_house_id <> 'harnwell'
  ),
  'should unwind a Harnwell worker cleanly (no non-Harnwell worker is seated on the Harnwell block by the fire)'
);

-- A currently-floated-out worker (an ACKNOWLEDGED float in progress): the float is
-- voided AND the home (source) seat is handled (restored→dropped).
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('54000002-0000-0000-0000-0000000012fa', 'harrison', (current_setting('test.s4.anchor')::timestamptz + interval '7 days') - interval '6 hours', 1),
  ('54000002-0000-0000-0000-0000000712fa', 'kings-court', (current_setting('test.s4.anchor')::timestamptz + interval '7 days') - interval '6 hours', 1);
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id, parent_float_id)
VALUES
  ('54000003-0000-0000-0000-0000000012fa', '54000002-0000-0000-0000-0000000012fa',
   '54000001-0000-0000-0000-00000000000d', 'floated_out', 'none', false, NULL, NULL),
  ('54000003-0000-0000-0000-0000000712fa', '54000002-0000-0000-0000-0000000712fa',
   '54000001-0000-0000-0000-00000000000d', 'floated_in', 'none', true, 'harrison', NULL);
INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids, status,
   initiated_by, force_triggered_by, acknowledged_at, expires_for_cleanup_at)
VALUES
  ('54000004-0000-0000-0000-000000000faa',
   '54000001-0000-0000-0000-00000000000d',
   ARRAY['54000003-0000-0000-0000-0000000012fa']::uuid[],
   ARRAY['54000003-0000-0000-0000-0000000712fa']::uuid[],
   'acknowledged', 'automated', NULL,
   current_setting('test.s4.anchor')::timestamptz - interval '1 hour',
   current_setting('test.s4.anchor')::timestamptz + interval '30 days');
UPDATE public.shift_block_assignments SET parent_float_id = '54000004-0000-0000-0000-000000000faa'
WHERE assignment_id = '54000003-0000-0000-0000-0000000712fa';
SELECT public.fire_worker(
  '54000001-0000-0000-0000-000000000002'::uuid,
  '54000001-0000-0000-0000-00000000000d'::uuid,
  current_setting('test.s4.anchor')::timestamptz
);
SELECT is(
  (SELECT status::text FROM public.float_assignments WHERE float_id = '54000004-0000-0000-0000-000000000faa'),
  'voided',
  'should unwind a worker who is CURRENTLY FLOATED OUT (acknowledged float) cleanly (the float is voided)'
);
SELECT is(
  (SELECT status::text || '/' || vacancy_origin::text
   FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000012fa'),
  'vacant/permanent_drop',
  'should unwind a currently-floated-out worker cleanly (the home source seat is restored→permanent-dropped)'
);
SELECT is(
  (SELECT status::text || '/' || vacancy_origin::text
   FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000712fa'),
  'vacant/temporary_drop',
  'should unwind a currently-floated-out worker cleanly (the destination seat is reopened)'
);

-- ============================================================
-- L. INTEGRATION — the entire end state of the canonical fire, in ONE assertion
--    block over the rows set up at the top (TEST_PLAN L). The canonical victim
--    held {1 in-progress below-headcount block, 2 future recurring slots, 1 future
--    non-recurring claim, 1 outbound pending float, 1 inbound acknowledged float,
--    1 open swap}. We assert the WHOLE end state survived a single fire_worker.
-- ============================================================

SELECT is(
  ARRAY[
    -- in-progress: vacant/temporary_drop + a float_lookup step + NO broadcast step
    (SELECT status::text || '/' || vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000019b0'),
    (SELECT (count(*) FILTER (WHERE step_name='float_lookup' AND status='fired'))::text || ':' || (count(*) FILTER (WHERE step_name='broadcast'))::text
       FROM public.block_step_status WHERE block_id = '54000002-0000-0000-0000-0000000019b0'),
    -- recurring slot A (+14d) + slot B (+8d): vacant/permanent_drop
    (SELECT status::text || '/' || vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000017c2'),
    (SELECT status::text || '/' || vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000016d1'),
    -- non-recurring claim: vacant/temporary_drop
    (SELECT status::text || '/' || vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000015e0'),
    -- both floats voided
    (SELECT fa1.status::text FROM public.float_assignments fa1 WHERE fa1.float_id = '54000004-0000-0000-0000-000000000f00'),
    (SELECT fa2.status::text FROM public.float_assignments fa2 WHERE fa2.float_id = '54000004-0000-0000-0000-000000000f01'),
    -- each destination reopened (temporary_drop); each source restored→dropped (permanent_drop)
    (SELECT status::text || '/' || vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-000000071200'),
    (SELECT status::text || '/' || vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000012f0'),
    (SELECT status::text || '/' || vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-000000071201'),
    (SELECT status::text || '/' || vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '54000003-0000-0000-0000-0000000012f1'),
    -- swap voided
    (SELECT status::text FROM public.swap_requests WHERE swap_id = '54000005-0000-0000-0000-000000000a00'),
    -- account deactivated + unsubscribed
    (SELECT is_active::text FROM public.users WHERE user_id = '54000001-0000-0000-0000-000000000001'),
    (SELECT broadcast_subscribed::text FROM public.users WHERE user_id = '54000001-0000-0000-0000-000000000001')
  ],
  ARRAY[
    'vacant/temporary_drop',
    '1:0',
    'vacant/permanent_drop',
    'vacant/permanent_drop',
    'vacant/temporary_drop',
    'voided',
    'voided',
    'vacant/temporary_drop',
    'vacant/permanent_drop',
    'vacant/temporary_drop',
    'vacant/permanent_drop',
    'voided',
    'false',
    'false'
  ],
  'should fully unwind a worker holding {in-progress below-headcount, 2 recurring slots, 1 non-recurring claim, 1 outbound pending float, 1 inbound acknowledged float, 1 open swap} in a single fire_worker call'
);
-- The returned jsonb counts match the integration end state.
SELECT is(
  ARRAY[
    current_setting('test.s4.fire')::jsonb ->> 'fired',
    current_setting('test.s4.fire')::jsonb ->> 'already_inactive',
    current_setting('test.s4.fire')::jsonb ->> 'in_progress_escalated',
    current_setting('test.s4.fire')::jsonb ->> 'non_recurring_vacated',
    current_setting('test.s4.fire')::jsonb ->> 'floats_voided'
  ],
  ARRAY['true', 'false', 'true', '1', '2'],
  'integration: the returned jsonb counts match (fired, in_progress_escalated, non_recurring_vacated, floats_voided)'
);

SELECT finish();
ROLLBACK;
