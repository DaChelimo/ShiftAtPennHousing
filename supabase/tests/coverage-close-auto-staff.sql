-- pgTAP behavioral tests for auto-staffing on coverage close — migration
-- 20260807000002.
--
-- Before this migration, close_allied_coverage_request only ever touched the
-- allied_coverage_requests row itself; the desk's shift_block_assignments stayed
-- exactly as they were, vacant, regardless of the recorded outcome. This pins:
--
--   * 'allied_secured' assigns the Allied contractor to the vacant blocks in the
--     request's window.
--   * 'covered_internally' + p_assign_self assigns the ACTING manager themselves.
--   * 'covered_internally' WITHOUT p_assign_self ("covered another way") and
--     'desk_unstaffed' both leave the schedule untouched.
--   * An RSM may self-cover only their OWN house's request — never another
--     house's — because the write is routed through admin_assign_worker, which
--     already enforces this. A cross-house attempt fails and the WHOLE close
--     aborts: no outcome is recorded on a request nobody actually covered.
--
-- Run with: supabase test db

BEGIN;

SELECT plan(8);

-- ============================================================
-- Fixture. `cas-` prefixed ids. gutmann holds RSM Rachel; rodin holds RSM Rory
-- (used only to prove cross-house self-cover is refused).
-- ============================================================
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('ca500000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cas-rachel@test.local'),
  ('ca500000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cas-rory@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('ca500000-0000-0000-0000-000000000001', 'Rachel RSM', 'cas-rachel@test.local', 'gutmann', true),
  ('ca500000-0000-0000-0000-000000000002', 'Rory RSM',   'cas-rory@test.local',   'rodin',   true);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('ca500000-0000-0000-0000-000000000001', 'rsm', 'gutmann'),
  ('ca500000-0000-0000-0000-000000000002', 'rsm', 'rodin');

-- Four distinct future gutmann blocks, one per scenario below, each given a
-- fresh vacant seat. Inserted directly (fixed, far-future, on-boundary
-- timestamps) rather than selected from the generated calendar, which this
-- local stack does not always carry this far out.
INSERT INTO shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('ca5b0000-0000-0000-0000-000000000001', 'gutmann', '2031-03-03 09:00:00-05', 1),
  ('ca5b0000-0000-0000-0000-000000000002', 'gutmann', '2031-03-03 09:30:00-05', 1),
  ('ca5b0000-0000-0000-0000-000000000003', 'gutmann', '2031-03-03 10:00:00-05', 1),
  ('ca5b0000-0000-0000-0000-000000000004', 'gutmann', '2031-03-03 10:30:00-05', 1)
ON CONFLICT (block_id) DO NOTHING;

CREATE TEMP TABLE cas_blocks AS
SELECT block_id, block_start_at, row_number() OVER (ORDER BY block_start_at) AS n
FROM shift_blocks
WHERE block_id IN (
  'ca5b0000-0000-0000-0000-000000000001', 'ca5b0000-0000-0000-0000-000000000002',
  'ca5b0000-0000-0000-0000-000000000003', 'ca5b0000-0000-0000-0000-000000000004'
);

INSERT INTO shift_block_assignments (block_id, user_id, status, vacancy_origin)
SELECT block_id, NULL, 'vacant', 'never_assigned' FROM cas_blocks;

-- ============================================================
-- 1-2. 'allied_secured' assigns the Allied contractor to the vacant block.
-- ============================================================
CREATE TEMP TABLE cas_req_allied AS
SELECT (open_allied_coverage_request(
          (SELECT block_id FROM cas_blocks WHERE n = 1), 'gutmann',
          (SELECT block_start_at FROM cas_blocks WHERE n = 1),
          (SELECT block_start_at + interval '30 minutes' FROM cas_blocks WHERE n = 1),
          'escalation_chain', now()) ->> 'request_id')::uuid AS request_id;

SELECT lives_ok(
  format($$ SELECT close_allied_coverage_request(%L, %L, 'allied_secured', NULL, now()) $$,
         (SELECT request_id FROM cas_req_allied), 'ca500000-0000-0000-0000-000000000001'),
  'closing as allied_secured succeeds');

SELECT is(
  (SELECT (user_id, status) FROM shift_block_assignments
    WHERE block_id = (SELECT block_id FROM cas_blocks WHERE n = 1)),
  ROW('a111ed00-0000-4000-8000-000000000001'::uuid, 'claimed'::shift_status_enum),
  'allied_secured assigns the Allied contractor account to the vacant block');

-- ============================================================
-- 3-4. 'covered_internally' + p_assign_self assigns the ACTING manager.
-- ============================================================
CREATE TEMP TABLE cas_req_self AS
SELECT (open_allied_coverage_request(
          (SELECT block_id FROM cas_blocks WHERE n = 2), 'gutmann',
          (SELECT block_start_at FROM cas_blocks WHERE n = 2),
          (SELECT block_start_at + interval '30 minutes' FROM cas_blocks WHERE n = 2),
          'escalation_chain', now()) ->> 'request_id')::uuid AS request_id;

SELECT lives_ok(
  format($$ SELECT close_allied_coverage_request(%L, %L, 'covered_internally', NULL, now(), true) $$,
         (SELECT request_id FROM cas_req_self), 'ca500000-0000-0000-0000-000000000001'),
  '"I can cover it" (p_assign_self = true) succeeds for the house''s own RSM');

SELECT is(
  (SELECT (user_id, status) FROM shift_block_assignments
    WHERE block_id = (SELECT block_id FROM cas_blocks WHERE n = 2)),
  ROW('ca500000-0000-0000-0000-000000000001'::uuid, 'claimed'::shift_status_enum),
  'p_assign_self puts the ACTING manager on the vacant block, not Allied and not nobody');

-- ============================================================
-- 5-6. 'covered_internally' WITHOUT p_assign_self ("covered another way") and
--    'desk_unstaffed' both leave the block vacant — the schedule is untouched.
-- ============================================================
CREATE TEMP TABLE cas_req_other AS
SELECT (open_allied_coverage_request(
          (SELECT block_id FROM cas_blocks WHERE n = 3), 'gutmann',
          (SELECT block_start_at FROM cas_blocks WHERE n = 3),
          (SELECT block_start_at + interval '30 minutes' FROM cas_blocks WHERE n = 3),
          'escalation_chain', now()) ->> 'request_id')::uuid AS request_id;

SELECT close_allied_coverage_request(
  (SELECT request_id FROM cas_req_other), 'ca500000-0000-0000-0000-000000000001',
  'covered_internally', NULL, now());

SELECT is(
  (SELECT status FROM shift_block_assignments
    WHERE block_id = (SELECT block_id FROM cas_blocks WHERE n = 3)),
  'vacant'::shift_status_enum,
  '"covered another way" (no p_assign_self) leaves the block vacant');

CREATE TEMP TABLE cas_req_unstaffed AS
SELECT (open_allied_coverage_request(
          (SELECT block_id FROM cas_blocks WHERE n = 4), 'gutmann',
          (SELECT block_start_at FROM cas_blocks WHERE n = 4),
          (SELECT block_start_at + interval '30 minutes' FROM cas_blocks WHERE n = 4),
          'escalation_chain', now()) ->> 'request_id')::uuid AS request_id;

SELECT close_allied_coverage_request(
  (SELECT request_id FROM cas_req_unstaffed), 'ca500000-0000-0000-0000-000000000001',
  'desk_unstaffed', 'Nobody available.', now());

SELECT is(
  (SELECT status FROM shift_block_assignments
    WHERE block_id = (SELECT block_id FROM cas_blocks WHERE n = 4)),
  'vacant'::shift_status_enum,
  'desk_unstaffed leaves the block vacant');

-- ============================================================
-- 7-8. Cross-house self-cover is refused outright, and the WHOLE close aborts:
--    the request stays open and unrecorded, not silently closed with no
--    assignment.
--
-- NOTE ON WHERE THIS GUARD ACTUALLY LIVES: close_allied_coverage_request's own
-- outer authorization (user_can_build_schedule) is DELIBERATELY cross-house for
-- the elevated hm/bm/rsm tier (ARCH "Cross-house-schedule", 2026-06-27) -- an
-- RSM elsewhere legitimately passes it for gutmann's request, the same way they
-- could close any house's request today. The invariant this migration adds --
-- "an RSM may self-cover only their own house" -- is enforced one layer down,
-- inside admin_assign_worker's own-house-only RSM check, which fires only when
-- p_assign_self actually routes a write there. Prove it directly: Rachel
-- (gutmann's RSM) cannot self-assign to a rodin block.
-- ============================================================
INSERT INTO shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES ('ca5b0000-0000-0000-0000-000000000005', 'rodin', '2031-03-03 09:00:00-05', 1)
ON CONFLICT (block_id) DO NOTHING;

CREATE TEMP TABLE cas_rodin_block AS
SELECT block_id, block_start_at
FROM shift_blocks
WHERE block_id = 'ca5b0000-0000-0000-0000-000000000005';

INSERT INTO shift_block_assignments (block_id, user_id, status, vacancy_origin)
SELECT block_id, NULL, 'vacant', 'never_assigned' FROM cas_rodin_block;

CREATE TEMP TABLE cas_req_rodin AS
SELECT (open_allied_coverage_request(
          (SELECT block_id FROM cas_rodin_block), 'rodin',
          (SELECT block_start_at FROM cas_rodin_block),
          (SELECT block_start_at + interval '30 minutes' FROM cas_rodin_block),
          'escalation_chain', now()) ->> 'request_id')::uuid AS request_id;

SELECT throws_ok(
  format($$ SELECT close_allied_coverage_request(%L, %L, 'covered_internally', NULL, now(), true) $$,
         (SELECT request_id FROM cas_req_rodin), 'ca500000-0000-0000-0000-000000000001'),
  'cross_house_not_supported',
  'the gutmann RSM cannot self-cover a rodin request');

SELECT ok(
  (SELECT closed_at IS NULL FROM allied_coverage_requests
    WHERE request_id = (SELECT request_id FROM cas_req_rodin)),
  'the aborted cross-house close never marks the request closed — atomic, not partial');

SELECT * FROM finish();
ROLLBACK;
