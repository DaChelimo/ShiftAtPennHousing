-- pgTAP: dropping a shift notifies claimable workers IMMEDIATELY.
--
-- Regression for the 2026-07-29 gap, found by running a real drop end to end.
-- `drop_shift` vacated the seat and wrote no notification at all. The only "a shift
-- opened up" a worker could ever receive was the escalation chain's `broadcast` step,
-- which fires at T-3h AND only when the desk would otherwise be EMPTY. On a
-- multi-staffed desk (Harnwell 2, Quad 3) a drop therefore notified NOBODY, ever, and a
-- shift dropped a week out sat silent for six days.
--
-- Fixed by 20260729000013: both drop paths call `notify_shift_opened`.
--
-- THE FOUR RULES THIS PINS (stakeholder decision 2026-07-29):
--   1. The notification fires on the DROP, not at T-3h, and fires even when the desk
--      still has another worker on it (the coverage floor governs escalation only).
--   2. Own house is MANDATORY: `open_shifts_home_house = false` does not suppress it.
--      That preference remains the switch for the T-3h `broadcast` only.
--   3. Other houses are OPT-IN via `open_shifts_other_houses` (default false).
--   4. Hard invariant #1 outranks rule 3: an opted-in non-Harnwell worker is never told
--      about a Harnwell seat, because they can never claim it.
--
-- Also pinned: ONE notification per dropped SPAN, not one per 30-minute block, and the
-- dropper is excluded.
--
-- Spec: BEHAVIORAL_SPECIFICATION.md §5.3 (instant open-shift notification),
--       §10.1 (channel matrix), ARCHITECTURE.md §5.1 (notify_shift_opened).
-- Run with: supabase test db

BEGIN;

SELECT plan(13);

-- Every count below is scoped to the six fixture users. The database also carries the
-- seeded Harnwell roster (10 real workers), so a global count would pass or fail on
-- seed size rather than on the rule under test.
CREATE TEMP VIEW son_users AS
SELECT unnest(ARRAY[
  '50000000-0000-4000-a000-000000000001',
  '50000000-0000-4000-a000-000000000002',
  '50000000-0000-4000-a000-000000000003',
  '50000000-0000-4000-a000-000000000004',
  '50000000-0000-4000-a000-000000000005',
  '50000000-0000-4000-a000-000000000006'
]::uuid[]) AS user_id;

-- ============================================================
-- 0. Fixtures. Anchor: Wednesday 2029-03-07 09:00 America/New_York.
--    2029 is clear of the seed's periods and of every other suite's fixtures.
--    Two houses: 'lauder' (multi-worker, the general case) and 'harnwell'
--    (the training-invariant case).
-- ============================================================

SELECT set_config(
  'test.son.anchor',
  ('2029-03-07 19:00'::timestamp AT TIME ZONE 'America/New_York')::text,
  false
);

INSERT INTO auth.users (id, instance_id, aud, role, email)
SELECT v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v.email
FROM (VALUES
  ('50000000-0000-4000-a000-000000000001'::uuid, 'son-dropper@test.local'),
  ('50000000-0000-4000-a000-000000000002'::uuid, 'son-mate@test.local'),
  ('50000000-0000-4000-a000-000000000003'::uuid, 'son-optout@test.local'),
  ('50000000-0000-4000-a000-000000000004'::uuid, 'son-other-optin@test.local'),
  ('50000000-0000-4000-a000-000000000005'::uuid, 'son-other-optout@test.local'),
  ('50000000-0000-4000-a000-000000000006'::uuid, 'son-bm@test.local')
) AS v(id, email)
ON CONFLICT (id) DO NOTHING;

-- Four at Lauder (dropper, deskmate, an explicit home-house opt-OUT, and a BM who must
-- never be offered a seat) and two at Harnwell for the invariant case.
INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('50000000-0000-4000-a000-000000000001', 'SON Dropper',   'son-dropper@test.local',      'lauder',   true),
  ('50000000-0000-4000-a000-000000000002', 'SON Mate',      'son-mate@test.local',         'lauder',   true),
  ('50000000-0000-4000-a000-000000000003', 'SON OptOut',    'son-optout@test.local',       'lauder',   true),
  ('50000000-0000-4000-a000-000000000006', 'SON BM',        'son-bm@test.local',           'lauder',   true),
  ('50000000-0000-4000-a000-000000000004', 'SON OtherIn',   'son-other-optin@test.local',  'harnwell', true),
  ('50000000-0000-4000-a000-000000000005', 'SON OtherOut',  'son-other-optout@test.local', 'harnwell', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('50000000-0000-4000-a000-000000000001', 'sw', NULL),
  ('50000000-0000-4000-a000-000000000002', 'sw', NULL),
  ('50000000-0000-4000-a000-000000000003', 'sw', NULL),
  ('50000000-0000-4000-a000-000000000004', 'sw', NULL),
  ('50000000-0000-4000-a000-000000000005', 'sw', NULL),
  ('50000000-0000-4000-a000-000000000006', 'bm', 'lauder');

-- A 2-block (1 hour) span at Lauder with required_headcount 2, so the deskmate stays on
-- the block after the drop. That is the exact shape the old code notified nobody for.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('5b000000-0000-4000-a000-000000000001', 'lauder',
   current_setting('test.son.anchor')::timestamptz, 2),
  ('5b000000-0000-4000-a000-000000000002', 'lauder',
   current_setting('test.son.anchor')::timestamptz + interval '30 minutes', 2);

INSERT INTO public.shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  ('5a000000-0000-4000-a000-000000000001', '5b000000-0000-4000-a000-000000000001',
   '50000000-0000-4000-a000-000000000001', 'scheduled', 'none'),
  ('5a000000-0000-4000-a000-000000000002', '5b000000-0000-4000-a000-000000000002',
   '50000000-0000-4000-a000-000000000001', 'scheduled', 'none'),
  -- the deskmate, who keeps the desk covered across the drop
  ('5a000000-0000-4000-a000-000000000003', '5b000000-0000-4000-a000-000000000001',
   '50000000-0000-4000-a000-000000000002', 'scheduled', 'none'),
  ('5a000000-0000-4000-a000-000000000004', '5b000000-0000-4000-a000-000000000002',
   '50000000-0000-4000-a000-000000000002', 'scheduled', 'none');

-- Preferences: one Lauder worker explicitly turns the home-house channel OFF, one
-- Harnwell worker opts INTO other houses, the other Harnwell worker does not.
INSERT INTO public.notification_preferences (user_id, open_shifts_home_house, open_shifts_other_houses)
VALUES
  ('50000000-0000-4000-a000-000000000003', false, false),
  ('50000000-0000-4000-a000-000000000004', true,  true),
  ('50000000-0000-4000-a000-000000000005', true,  false);

-- Guard the fixture's premise: the desk really is still covered after the drop, so a
-- pass here cannot be an artefact of the block going empty.
SELECT is(
  (SELECT count(*)::int FROM shift_block_assignments
   WHERE block_id = '5b000000-0000-4000-a000-000000000001'
     AND user_id = '50000000-0000-4000-a000-000000000002'
     AND status = 'scheduled'),
  1,
  'fixture: a second worker is scheduled on the block, so the desk stays covered'
);

-- ============================================================
-- A. The drop itself notifies, immediately.
-- ============================================================

SELECT lives_ok(
  $$SELECT drop_shift(
      ARRAY['5a000000-0000-4000-a000-000000000001',
            '5a000000-0000-4000-a000-000000000002']::uuid[],
      '50000000-0000-4000-a000-000000000001'::uuid,
      current_setting('test.son.anchor')::timestamptz - interval '2 days'
    )$$,
  'the drop succeeds'
);

SELECT is(
  (SELECT count(*)::int FROM notifications n
   JOIN son_users s ON s.user_id = n.recipient_user_id
   WHERE n.type = 'shift_opened'
     AND n.payload->>'house_id' = 'lauder'),
  3,
  'exactly 3 fixture recipients: the covered deskmate, the home-house opt-OUT (own '
  || 'house is mandatory) and the opted-in Harnwell worker. Not the dropper, not the BM, '
  || 'not the non-opted-in Harnwell worker'
);

SELECT is(
  (SELECT count(*)::int FROM notifications
   WHERE type = 'shift_opened'
     AND recipient_user_id = '50000000-0000-4000-a000-000000000002'),
  1,
  'RULE 1: the deskmate is notified even though the desk never went empty, and gets '
  || 'ONE notification for the 2-block span, not one per block'
);

SELECT is(
  (SELECT count(*)::int FROM notifications
   WHERE type = 'shift_opened'
     AND recipient_user_id = '50000000-0000-4000-a000-000000000001'),
  0,
  'the dropper is not notified about their own drop'
);

SELECT is(
  (SELECT count(*)::int FROM notifications
   WHERE type = 'shift_opened'
     AND recipient_user_id = '50000000-0000-4000-a000-000000000006'),
  0,
  'a BM is never offered an open seat, matching worker_open_shifts eligibility'
);

-- ============================================================
-- B. Own house is mandatory; other houses are opt-in.
-- ============================================================

SELECT is(
  (SELECT count(*)::int FROM notifications
   WHERE type = 'shift_opened'
     AND recipient_user_id = '50000000-0000-4000-a000-000000000003'),
  1,
  'RULE 2: open_shifts_home_house = false does NOT suppress a drop at your own house'
);

SELECT is(
  (SELECT count(*)::int FROM notifications
   WHERE type = 'shift_opened'
     AND recipient_user_id = '50000000-0000-4000-a000-000000000004'),
  1,
  'RULE 3: a worker at another house who opted in IS notified'
);

SELECT is(
  (SELECT count(*)::int FROM notifications
   WHERE type = 'shift_opened'
     AND recipient_user_id = '50000000-0000-4000-a000-000000000005'),
  0,
  'RULE 3: a worker at another house who did NOT opt in is not notified'
);

-- The payload is what both front ends render verbatim (pushDisplayFromData reads
-- title/body straight out of it), so an empty body ships an empty push.
SELECT ok(
  (SELECT payload->>'title' <> '' AND payload->>'body' LIKE '%Lauder%'
     FROM notifications
    WHERE type = 'shift_opened'
      AND recipient_user_id = '50000000-0000-4000-a000-000000000002'),
  'the payload carries the house-named title/body the clients render'
);

-- ============================================================
-- C. Hard invariant #1 outranks the cross-house opt-in.
-- ============================================================
-- The Lauder worker opts in to other houses, then a Harnwell seat opens. They can never
-- staff Harnwell (AGENTS hard invariant #1), so they must not hear about it. Without
-- the guard this returns 1 and the worker gets a notification for an uncleanable seat.

UPDATE public.notification_preferences
SET open_shifts_other_houses = true
WHERE user_id = '50000000-0000-4000-a000-000000000002';

SELECT lives_ok(
  $$SELECT notify_shift_opened(
      'harnwell',
      '5b000000-0000-4000-a000-000000000001'::uuid,
      current_setting('test.son.anchor')::timestamptz,
      current_setting('test.son.anchor')::timestamptz + interval '60 minutes',
      NULL,
      now(),
      false
    )$$,
  'a Harnwell seat opens'
);

SELECT is(
  (SELECT count(*)::int FROM notifications n
   JOIN son_users s ON s.user_id = n.recipient_user_id
   WHERE n.type = 'shift_opened'
     AND n.payload->>'house_id' = 'harnwell'),
  2,
  'RULE 4: among the fixture users the Harnwell seat reaches exactly the two '
  || 'home-Harnwell workers, never the opted-in Lauder worker'
);

SELECT is(
  (SELECT count(*)::int FROM notifications
   WHERE type = 'shift_opened'
     AND payload->>'house_id' = 'harnwell'
     AND recipient_user_id = '50000000-0000-4000-a000-000000000002'),
  0,
  'RULE 4, stated directly: the opted-in non-Harnwell worker received nothing'
);

SELECT * FROM finish();
ROLLBACK;
