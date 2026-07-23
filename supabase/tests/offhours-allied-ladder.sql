-- pgTAP behavioral tests for the off-hours Allied-page escalation ladder
-- (staggered-rollout pilot; migration 20260713000001). Covers the invariants that must
-- never regress:
--   * master switch OFF  -> unchanged HMOD-direct off-hours terminal (no ladder);
--   * master switch ON   -> off-hours terminal starts the ladder (responsible worker ->
--     SM -> desk) instead of a single HMOD page, and skips the hmod_urgent insert;
--   * a never-assigned gap (no dropper) starts the ladder at the SM;
--   * advance fires only after the per-rung timeout, walks dropper -> sm -> desk, and
--     stops at the terminal desk rung;
--   * only a real recipient may acknowledge, and an ack resolves the ladder;
--   * ON HM working hours the terminal is UNCHANGED (never starts the ladder).
--
-- Self-contained: BEGIN...ROLLBACK, own fixtures, far-future anchor (2030) so it never
-- collides with seeded shift_blocks. Run with: supabase test db.

BEGIN;

SELECT plan(21);

-- ============================================================
-- Fixtures at lower-quad: an SM (Sam), the responsible worker / dropper (Drew), a
-- worker on the desk right now (Dana), and a bystander with no alert (Nate).
-- ============================================================
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('ab000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'apl-sam@test.local'),
  ('ab000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'apl-drew@test.local'),
  ('ab000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'apl-dana@test.local'),
  ('ab000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'apl-nate@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('ab000000-0000-0000-0000-000000000001', 'Sam SM',   'apl-sam@test.local',  'lower-quad', true),
  ('ab000000-0000-0000-0000-000000000002', 'Drew SW',  'apl-drew@test.local', 'lower-quad', true),
  ('ab000000-0000-0000-0000-000000000003', 'Dana SW',  'apl-dana@test.local', 'lower-quad', true),
  ('ab000000-0000-0000-0000-000000000004', 'Nate SW',  'apl-nate@test.local', 'lower-quad', true);

-- Sam is the sole SM for lower-quad in this txn.
DELETE FROM public.user_roles WHERE role = 'sm' AND scope_house_id = 'lower-quad';
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('ab000000-0000-0000-0000-000000000001', 'sm', 'lower-quad');

-- Project-administrator terminal so the switch-OFF off-hours terminal has a resolvable
-- recipient (proves the ladder path is the ONLY difference the switch makes).
INSERT INTO system_config (config_key, config_value, value_type)
VALUES ('project_administrator_user_id', 'ab000000-0000-0000-0000-000000000001', 'uuid')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, value_type = 'uuid';

-- Blocks. Off-hours anchor: Sat 2030-06-01 (weekend => off HM hours regardless of time).
--   B_now  06:00Z (02:00 NY) — the desk block in progress at p_now, Dana present.
--   B1     08:00Z — switch-OFF gap (dropper Drew).
--   B2     09:00Z — switch-ON gap (dropper Drew).
--   B3     10:00Z — no-dropper gap (never assigned).
-- On-hours anchor: Mon 2030-06-03 14:00Z (10:00 NY, weekday, in [08,17)).
--   B4     14:00Z — on-hours gap (dropper Drew).
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('bb000000-0000-0000-0000-0000000000a0', 'lower-quad', '2030-06-01 06:00:00+00', 1),
  ('bb000000-0000-0000-0000-0000000000b1', 'lower-quad', '2030-06-01 08:00:00+00', 1),
  ('bb000000-0000-0000-0000-0000000000b2', 'lower-quad', '2030-06-01 09:00:00+00', 1),
  ('bb000000-0000-0000-0000-0000000000b3', 'lower-quad', '2030-06-01 10:00:00+00', 1),
  ('bb000000-0000-0000-0000-0000000000b4', 'lower-quad', '2030-06-03 14:00:00+00', 1);

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, dropped_by_user_id, dropped_at)
VALUES
  -- Dana on the current desk block (present).
  ('cc000000-0000-0000-0000-0000000000a0', 'bb000000-0000-0000-0000-0000000000a0',
   'ab000000-0000-0000-0000-000000000003', 'scheduled', 'none', NULL, NULL),
  -- B1 vacant, dropped by Drew.
  ('cc000000-0000-0000-0000-0000000000b1', 'bb000000-0000-0000-0000-0000000000b1',
   NULL, 'vacant', 'temporary_drop', 'ab000000-0000-0000-0000-000000000002', '2030-06-01 03:00:00+00'),
  -- B2 vacant, dropped by Drew.
  ('cc000000-0000-0000-0000-0000000000b2', 'bb000000-0000-0000-0000-0000000000b2',
   NULL, 'vacant', 'temporary_drop', 'ab000000-0000-0000-0000-000000000002', '2030-06-01 03:00:00+00'),
  -- B3 vacant, never assigned (no dropper).
  ('cc000000-0000-0000-0000-0000000000b3', 'bb000000-0000-0000-0000-0000000000b3',
   NULL, 'vacant', 'never_assigned', NULL, NULL),
  -- B4 vacant, dropped by Drew (on-hours).
  ('cc000000-0000-0000-0000-0000000000b4', 'bb000000-0000-0000-0000-0000000000b4',
   NULL, 'vacant', 'temporary_drop', 'ab000000-0000-0000-0000-000000000002', '2030-06-03 12:00:00+00');

-- ============================================================
-- 1. Default: switch OFF.
-- ============================================================
SELECT is(is_offhours_ladder_enabled(), false, 'ladder switch defaults off');

-- 2-3. Switch OFF, off-hours terminal on B1 -> HMOD-direct, NOT the ladder.
SELECT isnt(
  (process_hmod_notify_allied_step(
     'bb000000-0000-0000-0000-0000000000b1', 'lower-quad',
     '2030-06-01 08:00:00+00', '2030-06-01 06:10:00+00')->>'target'),
  'offhours_ladder',
  'switch off: off-hours terminal does not start the ladder');
SELECT is(
  (SELECT count(*) FROM allied_page_ladder WHERE block_id = 'bb000000-0000-0000-0000-0000000000b1')::int,
  0, 'switch off: no ladder row created');

-- Enable the master switch.
INSERT INTO system_config (config_key, config_value, value_type)
VALUES ('offhours_ladder_enabled', 'true', 'enum')
ON CONFLICT (config_key) DO UPDATE SET config_value = 'true', value_type = 'enum';

-- 4. Switch now on.
SELECT is(is_offhours_ladder_enabled(), true, 'ladder switch reads on after enable');

-- 5. Switch ON, off-hours terminal on B2 -> starts the ladder.
SELECT is(
  (process_hmod_notify_allied_step(
     'bb000000-0000-0000-0000-0000000000b2', 'lower-quad',
     '2030-06-01 09:00:00+00', '2030-06-01 06:10:00+00')->>'target'),
  'offhours_ladder',
  'switch on: off-hours terminal starts the ladder');

-- 6. Ladder starts at the responsible worker (dropper) rung.
SELECT is(
  (SELECT current_rung FROM allied_page_ladder WHERE block_id = 'bb000000-0000-0000-0000-0000000000b2'),
  'dropper', 'ladder starts at the dropper rung');

-- 7. The first alert goes to Drew (the dropper).
SELECT is(
  (SELECT count(*) FROM notifications
     WHERE recipient_user_id = 'ab000000-0000-0000-0000-000000000002'
       AND type = 'allied_page'
       AND (payload->>'block_id')::uuid = 'bb000000-0000-0000-0000-0000000000b2')::int,
  1, 'dropper receives the first allied_page alert');

-- 8. Switch-on path skips the single hmod_urgent insert for B2.
SELECT is(
  (SELECT count(*) FROM notifications
     WHERE type = 'hmod_urgent'
       AND (payload->>'block_id')::uuid = 'bb000000-0000-0000-0000-0000000000b2')::int,
  0, 'switch on: no hmod_urgent page for a laddered block');

-- 9-10. Advance before the timeout is a no-op.
SELECT is(
  advance_offhours_allied_ladder('2030-06-01 06:10:00+00', 10),
  0, 'advance before timeout: nothing advances');
SELECT is(
  (SELECT current_rung FROM allied_page_ladder WHERE block_id = 'bb000000-0000-0000-0000-0000000000b2'),
  'dropper', 'still on the dropper rung before timeout');

-- 11-12. After the timeout, advance to the SM rung and alert Sam.
SELECT is(
  advance_offhours_allied_ladder('2030-06-01 06:12:00+00', 1),
  1, 'advance after timeout moves one ladder');
SELECT is(
  (SELECT current_rung FROM allied_page_ladder WHERE block_id = 'bb000000-0000-0000-0000-0000000000b2'),
  'sm', 'advanced to the SM rung');
SELECT is(
  (SELECT count(*) FROM notifications
     WHERE recipient_user_id = 'ab000000-0000-0000-0000-000000000001'
       AND type = 'allied_page'
       AND (payload->>'block_id')::uuid = 'bb000000-0000-0000-0000-0000000000b2')::int,
  1, 'SM receives the second-rung alert');

-- 14. Advance again to the terminal desk rung and alert Dana (present on the desk now).
DO $$ BEGIN PERFORM advance_offhours_allied_ladder('2030-06-01 06:14:00+00', 1); END $$;
SELECT is(
  (SELECT current_rung FROM allied_page_ladder WHERE block_id = 'bb000000-0000-0000-0000-0000000000b2'),
  'desk', 'advanced to the terminal desk rung');
SELECT is(
  (SELECT count(*) FROM notifications
     WHERE recipient_user_id = 'ab000000-0000-0000-0000-000000000003'
       AND type = 'allied_page'
       AND (payload->>'block_id')::uuid = 'bb000000-0000-0000-0000-0000000000b2')::int,
  1, 'a desk worker receives the terminal-rung alert');

-- 14. The desk rung is terminal: a further advance does nothing.
SELECT is(
  advance_offhours_allied_ladder('2030-06-01 06:16:00+00', 1),
  0, 'desk rung is terminal: no further advance');

-- 15. A bystander who never received an alert cannot acknowledge.
SELECT is(
  (acknowledge_allied_page('bb000000-0000-0000-0000-0000000000b2',
     'ab000000-0000-0000-0000-000000000004', '2030-06-01 06:17:00+00')->>'reason'),
  'not_a_recipient', 'a non-recipient cannot acknowledge the ladder');

-- 16. A real recipient (Drew) acknowledges -> ladder resolved.
SELECT is(
  (acknowledge_allied_page('bb000000-0000-0000-0000-0000000000b2',
     'ab000000-0000-0000-0000-000000000002', '2030-06-01 06:18:00+00')->>'acknowledged'),
  'true', 'a recipient can acknowledge (I have called the desk)');
SELECT isnt(
  (SELECT resolved_at FROM allied_page_ladder WHERE block_id = 'bb000000-0000-0000-0000-0000000000b2'),
  NULL, 'acknowledgment resolves the ladder');

-- 17. A never-assigned gap (no dropper) starts at the SM rung.
SELECT is(
  (SELECT (start_offhours_allied_ladder(
     'bb000000-0000-0000-0000-0000000000b3', 'lower-quad',
     '2030-06-01 10:00:00+00', '2030-06-01 06:10:00+00')->>'rung')),
  'sm', 'a never-assigned gap starts the ladder at the SM');

-- 18. ON HM working hours the terminal never starts the ladder (unchanged routing).
SELECT is(
  (SELECT count(*) FROM (
     SELECT process_hmod_notify_allied_step(
       'bb000000-0000-0000-0000-0000000000b4', 'lower-quad',
       '2030-06-03 14:00:00+00', '2030-06-03 14:10:00+00') AS r
   ) t
   WHERE (t.r->>'target') = 'offhours_ladder'
      OR EXISTS (SELECT 1 FROM allied_page_ladder WHERE block_id = 'bb000000-0000-0000-0000-0000000000b4'))::int,
  0, 'in HM hours the terminal never starts the ladder');

SELECT * FROM finish();
ROLLBACK;
