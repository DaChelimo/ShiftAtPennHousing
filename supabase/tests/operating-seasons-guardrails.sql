-- pgTAP tests for the P3 runtime guardrails (migration 20260702000005):
-- float_routing legality trigger + grandfathering-aware headcount enforcement.
-- Self-contained: BEGIN…ROLLBACK, far-future blocks to avoid seed collisions.

BEGIN;

SELECT plan(7);

-- ============================================================
-- 1–2. float_routing legality trigger.
-- ============================================================
SELECT throws_ok(
  $$ INSERT INTO public.float_routing (profile_name, source_house_id, destination_house_id, precedence_order)
     VALUES ('regular_school_year', 'quad', 'harnwell', 8) $$,
  '23514', NULL,
  'float_routing rejects a Harnwell destination'
);
SELECT throws_ok(
  $$ INSERT INTO public.float_routing (profile_name, source_house_id, destination_house_id, precedence_order)
     VALUES ('regular_school_year', 'quad', 'quad', 8) $$,
  '23514', NULL,
  'float_routing rejects a self-route'
);

-- ============================================================
-- Grandfathering fixture: a headcount-2 block with two occupied (scheduled) seats.
-- ============================================================
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('a6000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gf-w1@test.local'),
  ('a6000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gf-w2@test.local'),
  ('a6000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gf-w3@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('a6000000-0000-0000-0000-000000000001', 'GF One',   'gf-w1@test.local', 'quad', true),
  ('a6000000-0000-0000-0000-000000000002', 'GF Two',   'gf-w2@test.local', 'quad', true),
  ('a6000000-0000-0000-0000-000000000003', 'GF Three', 'gf-w3@test.local', 'quad', true);
INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('a6000000-0000-0000-0000-000000000001', 'sw', NULL),
  ('a6000000-0000-0000-0000-000000000002', 'sw', NULL),
  ('a6000000-0000-0000-0000-000000000003', 'sw', NULL);

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES ('a6b10000-0000-0000-0000-000000000001', 'quad', '2099-07-02 16:00:00+00', 2);
INSERT INTO public.shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  ('a6a10000-0000-0000-0000-000000000001', 'a6b10000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'scheduled', 'none'),
  ('a6a10000-0000-0000-0000-000000000002', 'a6b10000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000002', 'scheduled', 'none');

-- 3. Simulate a headcount DECREASE 2 -> 1 (what the reconciler does).
UPDATE public.shift_blocks SET required_headcount = 1
WHERE block_id = 'a6b10000-0000-0000-0000-000000000001';
SELECT is(
  (SELECT required_headcount FROM public.shift_blocks WHERE block_id = 'a6b10000-0000-0000-0000-000000000001'),
  1, 'headcount reduced to 1 with two occupants still present (grandfathered)'
);

-- 4. A status-PRESERVING update on a grandfathered seat SUCCEEDS (no occupancy increase).
SELECT lives_ok(
  $$ UPDATE public.shift_block_assignments
     SET user_id = 'a6000000-0000-0000-0000-000000000003'
     WHERE assignment_id = 'a6a10000-0000-0000-0000-000000000001' $$,
  'a swap on a grandfathered over-headcount block is allowed'
);

-- 5. Dropping a grandfathered seat (occupied -> vacant) SUCCEEDS.
SELECT lives_ok(
  $$ UPDATE public.shift_block_assignments
     SET status = 'vacant', user_id = NULL, vacancy_origin = 'temporary_drop'
     WHERE assignment_id = 'a6a10000-0000-0000-0000-000000000002' $$,
  'dropping a grandfathered seat is allowed'
);

-- 6. Re-occupying that freed seat is REJECTED while the block is still over its
-- reduced headcount (one occupant remains, required is 1).
SELECT throws_ok(
  $$ UPDATE public.shift_block_assignments
     SET status = 'claimed', user_id = 'a6000000-0000-0000-0000-000000000002', vacancy_origin = 'none'
     WHERE assignment_id = 'a6a10000-0000-0000-0000-000000000002' $$,
  '23514', NULL,
  'adding a NEW occupant to an over-headcount block is still rejected'
);

-- 7. A fresh INSERT of an occupant onto the over-full block is also rejected.
SELECT throws_ok(
  $$ INSERT INTO public.shift_block_assignments (block_id, user_id, status, vacancy_origin)
     VALUES ('a6b10000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000002', 'claimed', 'none') $$,
  '23514', NULL,
  'inserting a new occupant onto an over-headcount block is rejected'
);

SELECT * FROM finish();
ROLLBACK;
