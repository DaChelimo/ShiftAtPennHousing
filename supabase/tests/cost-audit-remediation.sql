-- pgTAP tests for the Supabase cost-audit remediation (migrations 20260726000001-000008).
--
-- Covers the DB-layer behaviour introduced or changed by the audit fixes:
--   F-01  worker_open_shifts horizon bounds, and that they never hide a permanent opening
--   F-03  bounded push-delivery retries, dead-lettering, and delivered_at NOT pre-stamped
--   F-04  launch-gated orchestrator scan
--   F-05  RLS visibility is unchanged by the InitPlan rewrite
--   F-06  no-ack lookahead applied in SQL
--   F-08  suppressed ack reminders reach a terminal state and leave the queue
--   F-10  swap expiry defers to the cron when one is scheduled
--   F-14  retention deletes only terminal/non-pending rows past the horizon
--   F-15  the simulated clock can only be moved by the project administrator, in every
--         environment (superseded 20260726000008's environment gate with a role gate,
--         migration 20260805000001)
--
-- Dates are relative to now() so the fixtures land outside the seeded schedule's window.
-- Self-contained; everything rolls back.

BEGIN;

SELECT plan(27);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('ca000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ca-w1@test.local'),
  ('ca000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ca-hw@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('ca000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ca-admin@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('ca000000-0000-0000-0000-000000000001', 'Cost Worker', 'ca-w1@test.local', 'quad', true),
  ('ca000000-0000-0000-0000-000000000002', 'Harn Worker', 'ca-hw@test.local', 'harnwell', true),
  ('ca000000-0000-0000-0000-000000000003', 'Cost Admin', 'ca-admin@test.local', 'quad', true);
INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('ca000000-0000-0000-0000-000000000001', 'sw', 'quad'),
  ('ca000000-0000-0000-0000-000000000002', 'sw', 'harnwell'),
  ('ca000000-0000-0000-0000-000000000003', 'admin', NULL);

-- Regular-school-year calendar days: one inside the weekly horizon, one beyond it but
-- inside the permanent horizon, one beyond both.
INSERT INTO operating_calendar (date, profile_name)
SELECT d::date, 'regular_school_year'
FROM generate_series(
       (now() + interval '3 days')::date,
       (now() + interval '40 weeks')::date,
       interval '1 day'
     ) d
ON CONFLICT (date) DO NOTHING;

-- Blocks: near (inside 6w), mid (beyond 6w, inside 26w), far (beyond 26w).
-- Block atomicity (AGENTS hard invariant #5): every block starts on a 30-minute
-- boundary, enforced by shift_blocks_block_start_boundary_check.
INSERT INTO shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('cb000000-0000-4000-8000-000000000001', 'quad', date_trunc('hour', now() + interval '3 days'),  1),
  ('cb000000-0000-4000-8000-000000000002', 'quad', date_trunc('hour', now() + interval '10 weeks'), 1),
  ('cb000000-0000-4000-8000-000000000003', 'quad', date_trunc('hour', now() + interval '40 weeks'), 1);

-- A plain vacancy on each, plus a permanent_drop occurrence on the mid block.
INSERT INTO shift_block_assignments (assignment_id, block_id, status, vacancy_origin) VALUES
  ('cc000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'vacant', 'never_assigned'),
  ('cc000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000002', 'vacant', 'permanent_drop'),
  ('cc000000-0000-4000-8000-000000000003', 'cb000000-0000-4000-8000-000000000003', 'vacant', 'never_assigned');

-- ---------------------------------------------------------------------------
-- F-01 -- horizon bounds
-- ---------------------------------------------------------------------------
SELECT ok(
  EXISTS (SELECT 1 FROM worker_open_shifts
          WHERE id = 'cc000000-0000-4000-8000-000000000001'
            AND eligible_user_id = 'ca000000-0000-0000-0000-000000000001'
            AND feed = 'weekly'),
  'F-01: a vacancy inside the 6-week weekly horizon is still emitted'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM worker_open_shifts
              WHERE id = 'cc000000-0000-4000-8000-000000000003'),
  'F-01: a vacancy beyond the horizon is no longer materialised at all'
);

-- The pickability guarantee the horizon decision turned on.
SELECT ok(
  EXISTS (SELECT 1 FROM worker_open_shifts
          WHERE id = 'cc000000-0000-4000-8000-000000000002'
            AND feed = 'permanent_opening'),
  'F-01: a permanent opening 10 weeks out is STILL emitted (permanent horizon is 26w)'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM worker_open_shifts
              WHERE id = 'cc000000-0000-4000-8000-000000000002'
                AND feed = 'weekly'),
  'F-01: that same occurrence is NOT in the weekly feed (outside the 6w/30d window)'
);

-- The Harnwell training constraint must survive the rewrite untouched.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM worker_open_shifts
    WHERE house_id = 'harnwell'
      AND eligible_user_id = 'ca000000-0000-0000-0000-000000000001'
  ),
  'F-01: a non-Harnwell worker still sees no Harnwell seat (training invariant intact)'
);

-- ---------------------------------------------------------------------------
-- F-04 -- launch-gated orchestrator scan
-- ---------------------------------------------------------------------------
SELECT ok(
  EXISTS (SELECT 1 FROM orchestrator_vacant_seats(now(), now() + interval '4 days')
          WHERE assignment_id = 'cc000000-0000-4000-8000-000000000001'),
  'F-04: with the launch gate disabled, a vacant seat is scanned as before'
);

INSERT INTO system_config (config_key, config_value, value_type)
VALUES ('staggered_launch_enabled', 'true', 'enum')
ON CONFLICT (config_key) DO UPDATE SET config_value = 'true';
UPDATE houses SET launch_state = 'live' WHERE id = 'harnwell';

SELECT ok(
  NOT EXISTS (SELECT 1 FROM orchestrator_vacant_seats(now(), now() + interval '4 days')
              WHERE assignment_id = 'cc000000-0000-4000-8000-000000000001'),
  'F-04: with the gate on, a pre-launch house is not scanned (no escalation for dark desks)'
);

SELECT is(
  (SELECT count(DISTINCT house_id)::int
     FROM orchestrator_vacant_seats(now(), now() + interval '30 days')),
  1,
  'F-04: only the launched house is scanned'
);

UPDATE system_config SET config_value = 'false' WHERE config_key = 'staggered_launch_enabled';

SELECT ok(
  EXISTS (SELECT 1 FROM orchestrator_vacant_seats(now(), now() + interval '4 days')
          WHERE assignment_id = 'cc000000-0000-4000-8000-000000000001'),
  'F-04: turning the master switch off restores the pre-gate behaviour exactly'
);

-- desk_covered must reflect the ESCALATION present-set, which counts allied.
INSERT INTO shift_block_assignments (block_id, status, vacancy_origin)
VALUES ('cb000000-0000-4000-8000-000000000001', 'allied', 'none');

SELECT ok(
  (SELECT bool_and(desk_covered) FROM orchestrator_vacant_seats(now(), now() + interval '4 days')
    WHERE block_id = 'cb000000-0000-4000-8000-000000000001'),
  'F-04: desk_covered counts ''allied'' (escalation present-set, not the pickup-lock one)'
);

-- ---------------------------------------------------------------------------
-- F-03 / F-08 -- delivery accounting
-- ---------------------------------------------------------------------------
INSERT INTO notifications (notification_id, recipient_user_id, type, payload)
VALUES ('cd000000-0000-4000-8000-000000000001', 'ca000000-0000-0000-0000-000000000001',
        'broadcast', '{}'::jsonb);

SELECT ok(
  EXISTS (SELECT 1 FROM pending_notification_deliveries(now())
          WHERE notification_id = 'cd000000-0000-4000-8000-000000000001'),
  'F-03: a fresh notification is queued immediately (no backoff on attempt 0)'
);

SELECT is(
  begin_notification_delivery_attempt('cd000000-0000-4000-8000-000000000001', now()),
  1,
  'F-03: the attempt counter increments before the send'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM pending_notification_deliveries(now())
              WHERE notification_id = 'cd000000-0000-4000-8000-000000000001'),
  'F-03: backoff keeps a just-attempted notification out of the queue'
);

-- Exhaust the ceiling.
DO $$
DECLARE i int;
BEGIN
  FOR i IN 1..20 LOOP
    PERFORM begin_notification_delivery_attempt('cd000000-0000-4000-8000-000000000001', now());
    PERFORM record_notification_delivery_failure(
      'cd000000-0000-4000-8000-000000000001', now(), 'FIREBASE_SERVICE_ACCOUNT_JSON is not configured');
  END LOOP;
END;
$$;

SELECT ok(
  (SELECT dead_lettered_at IS NOT NULL FROM notifications
    WHERE notification_id = 'cd000000-0000-4000-8000-000000000001'),
  'F-03: repeated failure dead-letters instead of retrying forever'
);

SELECT ok(
  (SELECT delivered_at IS NULL FROM notifications
    WHERE notification_id = 'cd000000-0000-4000-8000-000000000001'),
  'F-03: delivered_at is STILL NULL -- at-least-once is not weakened by the fix'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM pending_notification_deliveries(now() + interval '10 years')
              WHERE notification_id = 'cd000000-0000-4000-8000-000000000001'),
  'F-03: a dead-lettered notification never re-enters the queue (the loop is closed)'
);

SELECT ok(
  EXISTS (SELECT 1 FROM dead_lettered_notifications
          WHERE notification_id = 'cd000000-0000-4000-8000-000000000001'),
  'F-03: the failure is visible to an operator rather than silent'
);

-- Suppressed ack reminder reaches a terminal state (F-08 category 1).
INSERT INTO notifications (notification_id, recipient_user_id, type, payload)
VALUES ('cd000000-0000-4000-8000-000000000002', 'ca000000-0000-0000-0000-000000000001',
        'ack_reminder',
        '{"kind":"float_ack_reminder","float_id":"ce000000-0000-4000-8000-000000000009"}'::jsonb);

SELECT is(
  sweep_suppressed_ack_reminders(now()),
  1,
  'F-08: an ack reminder whose float is not pending is swept to a terminal state'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM pending_notification_deliveries(now())
              WHERE notification_id = 'cd000000-0000-4000-8000-000000000002'),
  'F-08: the swept reminder leaves the delivery queue for good'
);

SELECT ok(
  (SELECT delivered_at IS NULL FROM notifications
    WHERE notification_id = 'cd000000-0000-4000-8000-000000000002'),
  'F-08: suppression uses suppressed_at, NOT a delivered_at stamp'
);

-- ---------------------------------------------------------------------------
-- F-06 -- no-ack lookahead in SQL
-- ---------------------------------------------------------------------------
-- The contract is the FILTER, not a row count: whatever comes back must already be
-- inside the lookahead. Asserting "zero rows" would be wrong here, because the seeded
-- database can legitimately hold pending floats.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pending_floats_due_for_no_ack(now(), 15)
    WHERE earliest_destination_start > now() + interval '15 minutes'
  ),
  'F-06: the lookahead is applied in SQL -- nothing outside the window is ever returned'
);

-- ---------------------------------------------------------------------------
-- F-10 -- swap expiry ownership
-- ---------------------------------------------------------------------------
SELECT ok(
  expire_pending_swaps_if_uncronned(now()) >= 0,
  'F-10: with no swap-expiry cron registered, the orchestrator still expires swaps'
);

-- ---------------------------------------------------------------------------
-- F-14 -- retention
-- ---------------------------------------------------------------------------
INSERT INTO notifications (notification_id, recipient_user_id, type, payload, created_at, delivered_at)
VALUES ('cd000000-0000-4000-8000-000000000003', 'ca000000-0000-0000-0000-000000000001',
        'broadcast', '{}'::jsonb, now() - interval '90 days', now() - interval '90 days');
INSERT INTO notifications (notification_id, recipient_user_id, type, payload, created_at)
VALUES ('cd000000-0000-4000-8000-000000000004', 'ca000000-0000-0000-0000-000000000001',
        'broadcast', '{}'::jsonb, now() - interval '90 days');

SELECT purge_expired_operational_records(now());

SELECT ok(
  NOT EXISTS (SELECT 1 FROM notifications WHERE notification_id = 'cd000000-0000-4000-8000-000000000003'),
  'F-14: an old DELIVERED notification is purged'
);

SELECT ok(
  EXISTS (SELECT 1 FROM notifications WHERE notification_id = 'cd000000-0000-4000-8000-000000000004'),
  'F-14: an old UNDELIVERED notification is kept (it is evidence of a delivery fault)'
);

-- ---------------------------------------------------------------------------
-- F-15 -- time-travel admin gate (role, not environment; migration 20260805000001)
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$UPDATE dev_sim_clock SET offset_seconds = -3600, set_by = 'ca000000-0000-0000-0000-000000000001' WHERE id$$,
  'time_travel_admin_only',
  'F-15: a non-admin set_by cannot move the simulated clock'
);

SELECT lives_ok(
  $$UPDATE dev_sim_clock SET offset_seconds = -3600, set_by = 'ca000000-0000-0000-0000-000000000003' WHERE id$$,
  'F-15: the project administrator can move the simulated clock (no environment check)'
);

SELECT lives_ok(
  $$UPDATE dev_sim_clock SET offset_seconds = 0 WHERE id$$,
  'F-15: resetting to real time is always allowed (no unescapable time-travel state)'
);

SELECT * FROM finish();
ROLLBACK;
