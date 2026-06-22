-- pgTAP: Break redesign B1 — claim_break_blocks (the calendar drag claim, §4.4).
--
-- Contract (PLAN.md B1): per distinct block, inside the break claim_window, claim ONE
-- still-vacant seat ("system-assigned lane"); SKIP full / conflicting / over-cap /
-- out-of-window / Harnwell-denied blocks; return exactly the claimed (block, seat) pairs
-- (the server-side TRIM the UI reconciles its optimistic drag against).
--
--   A. claims every block when all vacant (single-staff)
--   B. fills any open seat per block on a multi-staff house (lane-agnostic)
--   C. skips a full block and claims the rest (FCFS trim)
--   D. skips a block the caller already covers (time-conflict trim)
--   E. rejects the whole call outside claim_window (pre_open + open_feed)
--   F. refuses a Harnwell block for a non-Harnwell caller (Harnwell training, #1)
--   G. stops at the weekly hard cap (40h) — claims to the cap, trims the tail (#4)
--   H. FCFS: a second caller on a now-full single seat gets nothing
--
-- Dates are 2029 (seed-free): break Wed 2029-11-21 → Sun 2029-11-25 (short_break).
-- start-anchored offsets: open T-14d = 2029-11-07 00:00; close T-1d = 2029-11-20 00:00.
-- All drag blocks live on Fri 2029-11-23 (distinct times). The cap worker's 78 filler
-- blocks sit on Wed/Thu (2029-11-21/22) — the same Mon-2029-11-19 week as the Friday, so
-- they count toward the weekly cap. in_window = 2029-11-16 12:00; pre_open = 2029-11-01
-- 12:00; open_feed = 2029-11-21 12:00 (≥ close). All EST (DST ended 2029-11-04).
-- Invariants #5 (30-min blocks), #6 (timestamptz NY, DST-safe).
--
-- Run with: supabase test db  (or, against a seed-free DB: psql -f this; it BEGIN/ROLLBACKs).

BEGIN;

SELECT plan(14);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO public.operating_profiles
  (profile_name, shift_start_bound, shift_end_bound, default_hours_cap,
   default_cap_enforcement, scheduling_mode, float_enabled, escalation_chain,
   claim_phase_open_offset, claim_phase_alert_offset, claim_phase_close_offset)
VALUES
  ('short_break', '08:00', '00:00', 40, 'hard', 'claim_based', true, '[]'::jsonb,
   '-14 days'::interval, '-3 days'::interval, '-1 day'::interval)
ON CONFLICT (profile_name) DO NOTHING;

INSERT INTO public.break_periods (break_id, break_name, break_type, start_date, end_date, profile_name)
VALUES ('bc000000-0000-0000-0000-0000000000b1', 'B1 TG', 'thanksgiving', '2029-11-21', '2029-11-25', 'short_break');

INSERT INTO public.operating_calendar (date, profile_name)
VALUES
  ('2029-11-21', 'short_break'), ('2029-11-22', 'short_break'), ('2029-11-23', 'short_break'),
  ('2029-11-24', 'short_break'), ('2029-11-25', 'short_break')
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

-- Workers: B house-05 (single-staff), A/C quad (multi-staff), D house-05, F quad (cap).
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('bc000001-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bc-a@test.local'),
  ('bc000001-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bc-b@test.local'),
  ('bc000001-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bc-c@test.local'),
  ('bc000001-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bc-d@test.local'),
  ('bc000001-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bc-f@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('bc000001-0000-0000-0000-00000000000a', 'BC A', 'bc-a@test.local', 'quad',     true),
  ('bc000001-0000-0000-0000-00000000000b', 'BC B', 'bc-b@test.local', 'house-05', true),
  ('bc000001-0000-0000-0000-00000000000c', 'BC C', 'bc-c@test.local', 'quad',     true),
  ('bc000001-0000-0000-0000-00000000000d', 'BC D', 'bc-d@test.local', 'house-05', true),
  ('bc000001-0000-0000-0000-00000000000f', 'BC F', 'bc-f@test.local', 'quad',     true)
ON CONFLICT (user_id) DO NOTHING;

-- Blocks (block_id, house, time on 2029-11-23, headcount) + their seats.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  -- A: single-staff house-05 08:00/08:30/09:00 (1 seat each, vacant) — claim all 3.
  ('bc000002-0000-0000-0000-000000000801', 'house-05', ('2029-11-23 08:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  ('bc000002-0000-0000-0000-000000000802', 'house-05', ('2029-11-23 08:30'::timestamp AT TIME ZONE 'America/New_York'), 1),
  ('bc000002-0000-0000-0000-000000000803', 'house-05', ('2029-11-23 09:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  -- B: multi-staff quad 09:00 (3 seats vacant) — fill one.
  ('bc000002-0000-0000-0000-000000000900', 'quad',     ('2029-11-23 09:00'::timestamp AT TIME ZONE 'America/New_York'), 3),
  -- C: house-05 10:00/10:30/11:00, the 10:30 pre-claimed (full) → trim.
  ('bc000002-0000-0000-0000-000000001000', 'house-05', ('2029-11-23 10:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  ('bc000002-0000-0000-0000-000000001030', 'house-05', ('2029-11-23 10:30'::timestamp AT TIME ZONE 'America/New_York'), 1),
  ('bc000002-0000-0000-0000-000000001100', 'house-05', ('2029-11-23 11:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  -- D: quad 12:00 (A already on seat1) + quad 12:30 (vacant) — time-conflict trim.
  ('bc000002-0000-0000-0000-000000001200', 'quad',     ('2029-11-23 12:00'::timestamp AT TIME ZONE 'America/New_York'), 3),
  ('bc000002-0000-0000-0000-000000001230', 'quad',     ('2029-11-23 12:30'::timestamp AT TIME ZONE 'America/New_York'), 3),
  -- E: house-05 13:00 (vacant) — phase gating.
  ('bc000002-0000-0000-0000-000000001300', 'house-05', ('2029-11-23 13:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  -- F: harnwell 14:00 (vacant) — training deny.
  ('bc000002-0000-0000-0000-000000001400', 'harnwell', ('2029-11-23 14:00'::timestamp AT TIME ZONE 'America/New_York'), 2),
  -- H: house-05 15:00 (1 seat) — FCFS single.
  ('bc000002-0000-0000-0000-000000001500', 'house-05', ('2029-11-23 15:00'::timestamp AT TIME ZONE 'America/New_York'), 1);

INSERT INTO public.shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin) VALUES
  ('bc000003-0000-0000-0000-000000000801', 'bc000002-0000-0000-0000-000000000801', NULL, 'vacant', 'never_assigned'),
  ('bc000003-0000-0000-0000-000000000802', 'bc000002-0000-0000-0000-000000000802', NULL, 'vacant', 'never_assigned'),
  ('bc000003-0000-0000-0000-000000000803', 'bc000002-0000-0000-0000-000000000803', NULL, 'vacant', 'never_assigned'),
  -- quad 09:00 — 3 vacant seats.
  ('bc000003-0000-0000-0000-000000000901', 'bc000002-0000-0000-0000-000000000900', NULL, 'vacant', 'never_assigned'),
  ('bc000003-0000-0000-0000-000000000902', 'bc000002-0000-0000-0000-000000000900', NULL, 'vacant', 'never_assigned'),
  ('bc000003-0000-0000-0000-000000000903', 'bc000002-0000-0000-0000-000000000900', NULL, 'vacant', 'never_assigned'),
  -- house-05 10:00 vacant, 10:30 FULL (D scheduled), 11:00 vacant.
  ('bc000003-0000-0000-0000-000000001000', 'bc000002-0000-0000-0000-000000001000', NULL, 'vacant', 'never_assigned'),
  ('bc000003-0000-0000-0000-000000001030', 'bc000002-0000-0000-0000-000000001030', 'bc000001-0000-0000-0000-00000000000d', 'scheduled', 'none'),
  ('bc000003-0000-0000-0000-000000001100', 'bc000002-0000-0000-0000-000000001100', NULL, 'vacant', 'never_assigned'),
  -- quad 12:00 — A on seat1 (scheduled), 2 vacant.
  ('bc000003-0000-0000-0000-000000001201', 'bc000002-0000-0000-0000-000000001200', 'bc000001-0000-0000-0000-00000000000a', 'scheduled', 'none'),
  ('bc000003-0000-0000-0000-000000001202', 'bc000002-0000-0000-0000-000000001200', NULL, 'vacant', 'never_assigned'),
  -- quad 12:30 — 1 vacant seat.
  ('bc000003-0000-0000-0000-000000001230', 'bc000002-0000-0000-0000-000000001230', NULL, 'vacant', 'never_assigned'),
  -- house-05 13:00 vacant.
  ('bc000003-0000-0000-0000-000000001300', 'bc000002-0000-0000-0000-000000001300', NULL, 'vacant', 'never_assigned'),
  -- harnwell 14:00 vacant.
  ('bc000003-0000-0000-0000-000000001400', 'bc000002-0000-0000-0000-000000001400', NULL, 'vacant', 'never_assigned'),
  -- house-05 15:00 vacant.
  ('bc000003-0000-0000-0000-000000001500', 'bc000002-0000-0000-0000-000000001500', NULL, 'vacant', 'never_assigned');

-- Cap worker F: 78 filler quad blocks (39h) on Wed/Thu of the break week, all scheduled.
WITH ins AS (
  INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
  SELECT gen_random_uuid(), 'quad',
         ('2029-11-21 00:00'::timestamp AT TIME ZONE 'America/New_York') + (g * interval '30 minutes'), 3
  FROM generate_series(0, 77) g
  RETURNING block_id
)
INSERT INTO public.shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin)
SELECT gen_random_uuid(), block_id, 'bc000001-0000-0000-0000-00000000000f', 'scheduled', 'none' FROM ins;

-- F's 4 cap-drag blocks on Fri 2029-11-23 16:00..17:30 (1 vacant seat each).
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('bc000002-0000-0000-0000-000000001600', 'quad', ('2029-11-23 16:00'::timestamp AT TIME ZONE 'America/New_York'), 3),
  ('bc000002-0000-0000-0000-000000001630', 'quad', ('2029-11-23 16:30'::timestamp AT TIME ZONE 'America/New_York'), 3),
  ('bc000002-0000-0000-0000-000000001700', 'quad', ('2029-11-23 17:00'::timestamp AT TIME ZONE 'America/New_York'), 3),
  ('bc000002-0000-0000-0000-000000001730', 'quad', ('2029-11-23 17:30'::timestamp AT TIME ZONE 'America/New_York'), 3);
INSERT INTO public.shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin) VALUES
  ('bc000003-0000-0000-0000-000000001600', 'bc000002-0000-0000-0000-000000001600', NULL, 'vacant', 'never_assigned'),
  ('bc000003-0000-0000-0000-000000001630', 'bc000002-0000-0000-0000-000000001630', NULL, 'vacant', 'never_assigned'),
  ('bc000003-0000-0000-0000-000000001700', 'bc000002-0000-0000-0000-000000001700', NULL, 'vacant', 'never_assigned'),
  ('bc000003-0000-0000-0000-000000001730', 'bc000002-0000-0000-0000-000000001730', NULL, 'vacant', 'never_assigned');

SELECT set_config('bc.win',  ('2029-11-16 12:00'::timestamp AT TIME ZONE 'America/New_York')::text, false);
SELECT set_config('bc.pre',  ('2029-11-01 12:00'::timestamp AT TIME ZONE 'America/New_York')::text, false);
SELECT set_config('bc.open', ('2029-11-21 12:00'::timestamp AT TIME ZONE 'America/New_York')::text, false);

-- ── A. single-staff: claims all three vacant blocks ──────────────────────────
SELECT is(
  (SELECT count(*)::integer FROM public.claim_break_blocks(
     ARRAY['bc000002-0000-0000-0000-000000000801','bc000002-0000-0000-0000-000000000802','bc000002-0000-0000-0000-000000000803']::uuid[],
     'bc000001-0000-0000-0000-00000000000b'::uuid, current_setting('bc.win')::timestamptz)),
  3, 'A: a 3-block drag over all-vacant single-staff blocks claims all 3');
SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
     WHERE block_id IN ('bc000002-0000-0000-0000-000000000801','bc000002-0000-0000-0000-000000000802','bc000002-0000-0000-0000-000000000803')
       AND status = 'claimed' AND user_id = 'bc000001-0000-0000-0000-00000000000b'),
  3, 'A: all three seats are now claimed by the caller');

-- ── B. multi-staff: fills exactly one of three open seats (lane-agnostic) ─────
SELECT is(
  (SELECT count(*)::integer FROM public.claim_break_blocks(
     ARRAY['bc000002-0000-0000-0000-000000000900']::uuid[],
     'bc000001-0000-0000-0000-00000000000a'::uuid, current_setting('bc.win')::timestamptz)),
  1, 'B: claiming a multi-staff block fills exactly one seat');
SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
     WHERE block_id = 'bc000002-0000-0000-0000-000000000900' AND status = 'vacant'),
  2, 'B: the multi-staff block still has its other two seats open');

-- ── C. trim: a full block in the middle is skipped; the rest claims ──────────
SELECT is(
  (SELECT array_agg(claimed_block_id ORDER BY claimed_block_id)::text FROM public.claim_break_blocks(
     ARRAY['bc000002-0000-0000-0000-000000001000','bc000002-0000-0000-0000-000000001030','bc000002-0000-0000-0000-000000001100']::uuid[],
     'bc000001-0000-0000-0000-00000000000b'::uuid, current_setting('bc.win')::timestamptz)),
  ARRAY['bc000002-0000-0000-0000-000000001000','bc000002-0000-0000-0000-000000001100']::uuid[]::text,
  'C: the full 10:30 block is trimmed; 10:00 and 11:00 are claimed');
SELECT is(
  (SELECT user_id::text FROM public.shift_block_assignments WHERE block_id = 'bc000002-0000-0000-0000-000000001030' AND status = 'scheduled'),
  'bc000001-0000-0000-0000-00000000000d', 'C: the full block keeps its original occupant (not overwritten)');

-- ── D. time-conflict: a block the caller already covers is skipped ───────────
SELECT is(
  (SELECT array_agg(claimed_block_id)::text FROM public.claim_break_blocks(
     ARRAY['bc000002-0000-0000-0000-000000001200','bc000002-0000-0000-0000-000000001230']::uuid[],
     'bc000001-0000-0000-0000-00000000000a'::uuid, current_setting('bc.win')::timestamptz)),
  ARRAY['bc000002-0000-0000-0000-000000001230']::uuid[]::text,
  'D: the 12:00 block (caller already on a seat) is trimmed; only 12:30 claims');

-- ── E. phase: nothing claims outside the claim window ────────────────────────
SELECT is(
  (SELECT count(*)::integer FROM public.claim_break_blocks(
     ARRAY['bc000002-0000-0000-0000-000000001300']::uuid[],
     'bc000001-0000-0000-0000-00000000000b'::uuid, current_setting('bc.pre')::timestamptz)),
  0, 'E: pre_open — the drag claims nothing');
SELECT is(
  (SELECT count(*)::integer FROM public.claim_break_blocks(
     ARRAY['bc000002-0000-0000-0000-000000001300']::uuid[],
     'bc000001-0000-0000-0000-00000000000b'::uuid, current_setting('bc.open')::timestamptz)),
  0, 'E: open_feed — the picker is closed, the drag claims nothing');
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = 'bc000003-0000-0000-0000-000000001300'),
  'vacant', 'E: the 13:00 seat is untouched outside the window');

-- ── F. Harnwell training: non-Harnwell caller is refused (#1) ────────────────
SELECT is(
  (SELECT count(*)::integer FROM public.claim_break_blocks(
     ARRAY['bc000002-0000-0000-0000-000000001400']::uuid[],
     'bc000001-0000-0000-0000-00000000000b'::uuid, current_setting('bc.win')::timestamptz)),
  0, 'F: a non-Harnwell worker cannot claim a Harnwell break block');

-- ── G. weekly hard cap: claims to 40h, trims the tail (#4) ───────────────────
SELECT is(
  (SELECT count(*)::integer FROM public.claim_break_blocks(
     ARRAY['bc000002-0000-0000-0000-000000001600','bc000002-0000-0000-0000-000000001630','bc000002-0000-0000-0000-000000001700','bc000002-0000-0000-0000-000000001730']::uuid[],
     'bc000001-0000-0000-0000-00000000000f'::uuid, current_setting('bc.win')::timestamptz)),
  2, 'G: a worker at 39h claims 2 blocks (to the 40h cap) and trims the rest');

-- ── H. FCFS: a second caller on a now-full single seat gets nothing ──────────
SELECT is(
  (SELECT count(*)::integer FROM public.claim_break_blocks(
     ARRAY['bc000002-0000-0000-0000-000000001500']::uuid[],
     'bc000001-0000-0000-0000-00000000000b'::uuid, current_setting('bc.win')::timestamptz)),
  1, 'H: the first caller claims the single seat');
SELECT is(
  (SELECT count(*)::integer FROM public.claim_break_blocks(
     ARRAY['bc000002-0000-0000-0000-000000001500']::uuid[],
     'bc000001-0000-0000-0000-00000000000d'::uuid, current_setting('bc.win')::timestamptz)),
  0, 'H: the second caller on the now-full block claims nothing (FCFS trim)');

SELECT finish();
ROLLBACK;
