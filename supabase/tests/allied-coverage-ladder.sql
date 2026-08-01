-- pgTAP behavioral tests for the Allied coverage escalation ladder —
-- migration 20260729000010.
--
-- What this pins, and why each one exists (all three were REAL, live-verified
-- failures before the migration):
--
--   * The ladder is RSM -> HM -> HMOD, in that order, and reaches EXACTLY those
--     three people. Before: one notification, to one person, once, forever. Verified
--     live 2026-07-29 that three escalation calls 90 minutes and 4 hours apart
--     produced 1 notification and 1 distinct recipient.
--   * A rung whose resolver returns NULL is SKIPPED immediately rather than burning
--     its timeout on a seat nobody occupies.
--   * The terminal rung never escalates to a fourth party and never fans out.
--   * An open request NEVER auto-clears. Before: it archived at the coverage-window
--     end whether or not anyone acted, and was discarded 24h later, so a desk that
--     went empty left no record anywhere.
--   * Close-out requires an outcome, and 'desk_unstaffed' requires a note.
--   * Adjacent blocks COALESCE into one request (the chain step fires once per
--     30-minute block, so a 4h stretch would otherwise page eight times).
--
-- Run with: supabase test db   (RLS-reading assertions need the role grants that
-- raw psql does not have; the non-RLS assertions here also pass under raw psql).

BEGIN;

SELECT plan(24);

-- ============================================================
-- Fixture. `acl-` prefixed ids so nothing collides with other suites.
-- mayer holds an RSM (Rita) and an HM (Hank). Mona is the campus HMOD.
-- Wendy is a plain worker who must never be able to close a request.
-- ============================================================
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('ac100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'acl-rita@test.local'),
  ('ac100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'acl-hank@test.local'),
  ('ac100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'acl-mona@test.local'),
  ('ac100000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'acl-wendy@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('ac100000-0000-0000-0000-000000000001', 'Rita RSM',  'acl-rita@test.local',  'mayer', true),
  ('ac100000-0000-0000-0000-000000000002', 'Hank HM',   'acl-hank@test.local',  'mayer', true),
  ('ac100000-0000-0000-0000-000000000003', 'Mona HMOD', 'acl-mona@test.local',  'lauder',  true),
  ('ac100000-0000-0000-0000-000000000004', 'Wendy SW',  'acl-wendy@test.local', 'mayer', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('ac100000-0000-0000-0000-000000000001', 'rsm', 'mayer'),
  ('ac100000-0000-0000-0000-000000000002', 'hm',  'mayer'),
  ('ac100000-0000-0000-0000-000000000003', 'hm',  'lauder'),
  ('ac100000-0000-0000-0000-000000000004', 'sw',  NULL);

-- Mona holds the rotor for every Friday in the test window, so the hmod rung is
-- reachable. Without this the ladder correctly SKIPS hmod (see test 8).
INSERT INTO hmod_rotor (week_start_date, hmod_user_id)
SELECT d::date, 'ac100000-0000-0000-0000-000000000003'
FROM generate_series(CURRENT_DATE - 21, CURRENT_DATE + 60, interval '1 day') d
WHERE EXTRACT(isodow FROM d) = 5
ON CONFLICT (week_start_date) DO UPDATE SET hmod_user_id = EXCLUDED.hmod_user_id;

-- A future mayer block to escalate on.
CREATE TEMP TABLE acl_block AS
SELECT sb.block_id, sb.house_id, sb.block_start_at
FROM shift_blocks sb
WHERE sb.house_id = 'mayer'
  AND sb.block_start_at > now() + interval '5 days'
  AND sb.voided_at IS NULL
ORDER BY sb.block_start_at
LIMIT 1;

CREATE TEMP TABLE acl_req AS
SELECT (open_allied_coverage_request(
          (SELECT block_id FROM acl_block), 'mayer',
          (SELECT block_start_at FROM acl_block),
          (SELECT block_start_at + interval '30 minutes' FROM acl_block),
          'escalation_chain', now()) ->> 'request_id')::uuid AS request_id;

-- ============================================================
-- 1-4. Opening: rung 1 is the RSM, and exactly one page goes out.
-- ============================================================
SELECT isnt((SELECT request_id FROM acl_req), NULL, 'opening an escalation creates a coverage request');

SELECT is(
  (SELECT current_rung FROM allied_coverage_requests WHERE request_id = (SELECT request_id FROM acl_req)),
  'rsm', 'the ladder starts at rung 1, the RSM');

SELECT is(
  (SELECT current_recipient FROM allied_coverage_requests WHERE request_id = (SELECT request_id FROM acl_req)),
  'ac100000-0000-0000-0000-000000000001'::uuid, 'the RSM of the house is the first person paged');

SELECT is(
  (SELECT count(*)::int FROM notifications
    WHERE payload ->> 'request_id' = (SELECT request_id::text FROM acl_req)),
  1, 'opening pages exactly once, not a fan-out');

-- ============================================================
-- 5. The coverage window is carried on the row, so it cannot silently regress to
--    the start+30m fallback the way the payload key did (20260713000001 dropped
--    the block_end_at key that 20260624000001 had added).
-- ============================================================
SELECT ok(
  (SELECT payload ? 'block_end_at' FROM notifications
    WHERE payload ->> 'request_id' = (SELECT request_id::text FROM acl_req) LIMIT 1),
  'the page carries an explicit block_end_at coverage window');

-- ============================================================
-- 6-7. No acknowledgment escalates rsm -> hm -> hmod, one rung per timeout.
-- ============================================================
SELECT lives_ok(
  $$ SELECT advance_allied_coverage_ladder(now() + interval '61 minutes') $$,
  'the ladder advances on a tick past the rung timeout');

SELECT is(
  (SELECT current_rung FROM allied_coverage_requests WHERE request_id = (SELECT request_id FROM acl_req)),
  'hm', 'an unacknowledged RSM rung escalates to the Housing Manager');

-- ============================================================
-- 8. Rung skipping: with no reachable HMOD the ladder must NOT sit on the rung
--    burning its timeout. Temporarily empty the rotor to prove it.
-- ============================================================
SAVEPOINT no_hmod;
DELETE FROM hmod_rotor;
SELECT advance_allied_coverage_ladder(now() + interval '122 minutes');
SELECT isnt(
  (SELECT current_rung FROM allied_coverage_requests WHERE request_id = (SELECT request_id FROM acl_req)),
  'hmod', 'an unreachable HMOD rung is skipped, not sat on');
ROLLBACK TO SAVEPOINT no_hmod;

-- ============================================================
-- 9-11. Terminal rung: reaches the HMOD, then stops. No fourth party, ever.
-- ============================================================
SELECT advance_allied_coverage_ladder(now() + interval '122 minutes');
SELECT is(
  (SELECT current_rung FROM allied_coverage_requests WHERE request_id = (SELECT request_id FROM acl_req)),
  'hmod', 'an unacknowledged HM rung escalates to the HMOD on duty');

SELECT advance_allied_coverage_ladder(now() + interval '183 minutes');
SELECT is(
  (SELECT current_rung FROM allied_coverage_requests WHERE request_id = (SELECT request_id FROM acl_req)),
  'hmod', 'the HMOD rung is terminal: there is no fourth rung');

SELECT is(
  (SELECT count(DISTINCT recipient_user_id)::int FROM notifications
    WHERE payload ->> 'request_id' = (SELECT request_id::text FROM acl_req)),
  3, 'exactly three managers are ever contacted, never other RSMs or managers');

-- ============================================================
-- 12. The window passes and the request is STILL open. This is the behavior that
--     replaced archive-on-window-end.
-- ============================================================
SELECT ok(
  (SELECT closed_at IS NULL FROM allied_coverage_requests WHERE request_id = (SELECT request_id FROM acl_req)),
  'an unactioned request is still open long after its coverage window');

-- ============================================================
-- 13-15. Acknowledge stops escalation but does NOT close.
-- ============================================================
SELECT lives_ok(
  format($$ SELECT acknowledge_allied_coverage_request(%L, %L, now()) $$,
         (SELECT request_id FROM acl_req), 'ac100000-0000-0000-0000-000000000001'),
  'the RSM can acknowledge a request that has already escalated past them');

SELECT ok(
  (SELECT acknowledged_at IS NOT NULL AND closed_at IS NULL
     FROM allied_coverage_requests WHERE request_id = (SELECT request_id FROM acl_req)),
  'acknowledging does not close: the outcome is still unrecorded');

SELECT is(
  (SELECT (advance_allied_coverage_ladder(now() + interval '900 minutes') ->> 'escalated')::int),
  0, 'an acknowledged request never escalates again');

-- ============================================================
-- 16-18. Close-out authorization and the required outcome.
-- ============================================================
SELECT throws_ok(
  format($$ SELECT close_allied_coverage_request(%L, %L, 'desk_unstaffed', NULL, now()) $$,
         (SELECT request_id FROM acl_req), 'ac100000-0000-0000-0000-000000000002'),
  'note_required',
  'closing as desk_unstaffed without a note is refused');

SELECT throws_ok(
  format($$ SELECT close_allied_coverage_request(%L, %L, 'allied_secured', NULL, now()) $$,
         (SELECT request_id FROM acl_req), 'ac100000-0000-0000-0000-000000000004'),
  'not_authorized',
  'a plain student worker cannot close a coverage request');

SELECT lives_ok(
  format($$ SELECT close_allied_coverage_request(%L, %L, 'desk_unstaffed', 'Allied unavailable.', now()) $$,
         (SELECT request_id FROM acl_req), 'ac100000-0000-0000-0000-000000000002'),
  'the house HM can close the request with an outcome and a note');

-- ============================================================
-- 19-20. Closed state, and closure is terminal for the ladder.
-- ============================================================
SELECT is(
  (SELECT outcome FROM allied_coverage_requests WHERE request_id = (SELECT request_id FROM acl_req)),
  'desk_unstaffed'::allied_coverage_outcome, 'the recorded outcome survives close-out');

SELECT is(
  (SELECT (advance_allied_coverage_ladder(now() + interval '2000 minutes') ->> 'escalated')::int),
  0, 'a closed request never escalates again');

-- ============================================================
-- 21. Coalescing: an adjacent block extends the open request rather than opening
--     a second one. Without this a 4h stretch pages eight separate times.
-- ============================================================
CREATE TEMP TABLE acl_block2 AS
SELECT sb.block_id, sb.block_start_at
FROM shift_blocks sb
WHERE sb.house_id = 'mayer'
  AND sb.block_start_at > now() + interval '9 days'
  AND sb.voided_at IS NULL
ORDER BY sb.block_start_at LIMIT 1;

SELECT open_allied_coverage_request((SELECT block_id FROM acl_block2), 'mayer',
       (SELECT block_start_at FROM acl_block2),
       (SELECT block_start_at + interval '30 minutes' FROM acl_block2),
       'escalation_chain', now());

-- The next contiguous 30 minutes.
SELECT open_allied_coverage_request((SELECT block_id FROM acl_block2), 'mayer',
       (SELECT block_start_at + interval '30 minutes' FROM acl_block2),
       (SELECT block_start_at + interval '60 minutes' FROM acl_block2),
       'escalation_chain', now());

SELECT is(
  (SELECT count(*)::int FROM allied_coverage_requests
    WHERE closed_at IS NULL AND house_id = 'mayer'
      AND window_start_at >= (SELECT block_start_at FROM acl_block2)),
  1, 'two adjacent blocks coalesce into ONE request, not two pages');

-- ============================================================
-- 22. Grants: the ladder RPCs must not be reachable by anon or authenticated.
--     REVOKE ... FROM PUBLIC alone does NOT strip Supabase's per-role grants, and
--     naming the roles explicitly is the only thing that does.
-- ============================================================
SELECT ok(
  NOT has_function_privilege('anon', 'public.advance_allied_coverage_ladder(timestamptz, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.advance_allied_coverage_ladder(timestamptz, integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.open_allied_coverage_request(uuid, text, timestamptz, timestamptz, text, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.open_allied_coverage_request(uuid, text, timestamptz, timestamptz, text, timestamptz)', 'EXECUTE'),
  'the orchestrator-only ladder RPCs are revoked from anon AND authenticated');

-- ============================================================
-- 23-24. TABLE GRANTS. An RLS policy alone is not enough: table privileges are
--     checked BEFORE any policy runs. Without a SELECT grant to `authenticated`,
--     every manager got "permission denied for table" and the Action Inbox showed
--     an empty state while real requests sat unactioned. This is invisible to the
--     rest of this suite, which runs as a superuser (no grants, no RLS).
--     `anon` must NEVER hold it: this project has regressed an accidental
--     GRANT ... TO anon three times, hence scripts/hooks/anon-grant-guard.js.
-- ============================================================
SELECT ok(
  has_table_privilege('authenticated', 'public.allied_coverage_requests', 'SELECT'),
  'authenticated can SELECT coverage requests, so RLS actually gets a chance to run');

SELECT ok(
  NOT has_table_privilege('anon', 'public.allied_coverage_requests', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.allied_coverage_requests', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.allied_coverage_requests', 'UPDATE'),
  'anon cannot read, and clients cannot write: every write goes through an RPC');

SELECT * FROM finish();
ROLLBACK;
