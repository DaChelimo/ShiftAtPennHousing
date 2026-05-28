-- pgTAP behavioral tests for Phase 07: process_broadcast_step() atomic
-- RPC (audit finding B-1, broadcast portion).
--
-- Spec sources:
--   ARCHITECTURE §1.3 (atomicity invariant: no partial state observable),
--                §4.1 (block_step_status; ON CONFLICT DO NOTHING claim),
--                §4.2 ("Step: broadcast" — query subscribed SWs at the
--                       block's home house and generate notifications);
--   BEHAVIORAL_SPECIFICATION §5.4 (T-3h broadcast step),
--                            §10.1 (broadcast scope: subscribed SWs only).
--
-- Audit finding exercised:
--   B-1 (broadcast): claimStep() + broadcastStep() were two separate
--        round-trips. If the Edge Function died between the claim and
--        the notification inserts, block_step_status said 'fired' but
--        the notifications were never sent. The new RPC consolidates
--        the claim INSERT and the notifications INSERT into one
--        plpgsql transaction so partial state is impossible.
--
-- Run with: supabase test db

BEGIN;

SELECT plan(12);

-- ============================================================
-- 0. Fixture: subscribed users at one house + a sample block.
-- ============================================================

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('e0000509-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07bc-sub1@test.local'),
  ('e0000509-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07bc-sub2@test.local'),
  ('e0000509-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07bc-nosub@test.local'),
  ('e0000509-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07bc-otherhouse@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active,
                          broadcast_subscribed)
VALUES
  ('e0000509-0000-0000-0000-000000000001', 'BC Sub 1', 'p07bc-sub1@test.local',
   'harnwell', true, true),
  ('e0000509-0000-0000-0000-000000000002', 'BC Sub 2', 'p07bc-sub2@test.local',
   'harnwell', true, true),
  ('e0000509-0000-0000-0000-000000000003', 'BC No Sub', 'p07bc-nosub@test.local',
   'harnwell', true, false),
  ('e0000509-0000-0000-0000-000000000004', 'BC Other House',
   'p07bc-otherhouse@test.local', 'house-03', true, true);

SELECT set_config(
  'test.phase07bc.anchor',
  (
    (date_trunc('hour', now() AT TIME ZONE 'America/New_York')
     + interval '60 days') AT TIME ZONE 'America/New_York'
  )::text,
  false
);

INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('f0000509-0000-0000-0000-000000000001', 'harnwell',
   current_setting('test.phase07bc.anchor')::timestamptz, 3),
  ('f0000509-0000-0000-0000-000000000002', 'harnwell',
   current_setting('test.phase07bc.anchor')::timestamptz + interval '30 minutes', 3),
  ('f0000509-0000-0000-0000-000000000003', 'harnwell',
   current_setting('test.phase07bc.anchor')::timestamptz + interval '60 minutes', 3);

-- ============================================================
-- 1. Function exists with the expected signature.
-- ============================================================

SELECT has_function(
  'public', 'process_broadcast_step',
  ARRAY['uuid', 'text', 'timestamptz', 'timestamptz'],
  'process_broadcast_step(block_id, house_id, block_start_at, now) exists'
);

-- ============================================================
-- 2. Successful broadcast: claims the chain step AND inserts a
--    notification per subscribed worker AT THE BLOCK'S HOUSE only,
--    all in one transaction.
-- ============================================================

SELECT lives_ok(
  $$ SELECT public.process_broadcast_step(
       'f0000509-0000-0000-0000-000000000001'::uuid,
       'harnwell',
       current_setting('test.phase07bc.anchor')::timestamptz,
       (current_setting('test.phase07bc.anchor')::timestamptz - interval '3 hours')
     ) $$,
  'B-1 broadcast: RPC runs without error'
);

SELECT is(
  (SELECT status::text FROM public.block_step_status
   WHERE block_id = 'f0000509-0000-0000-0000-000000000001'
     AND step_name = 'broadcast'),
  'fired',
  'B-1 broadcast: block_step_status claimed as fired in the same transaction'
);

SELECT is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE type = 'broadcast'
     AND payload ->> 'block_id' = 'f0000509-0000-0000-0000-000000000001'),
  2,
  'B-1 broadcast: 2 notifications inserted (one per subscribed SW at harnwell)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE type = 'broadcast'
     AND payload ->> 'block_id' = 'f0000509-0000-0000-0000-000000000001'
     AND recipient_user_id = 'e0000509-0000-0000-0000-000000000003'),
  0,
  'B-1 broadcast: unsubscribed user did NOT receive a notification'
);

SELECT is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE type = 'broadcast'
     AND payload ->> 'block_id' = 'f0000509-0000-0000-0000-000000000001'
     AND recipient_user_id = 'e0000509-0000-0000-0000-000000000004'),
  0,
  'B-1 broadcast: other-house subscriber did NOT receive a notification'
);

-- ============================================================
-- 3. Idempotency: a second call against the same (block, broadcast)
--    must NOT re-insert notifications and must signal claimed=false.
--    This is the property that prevents duplicate broadcasts when two
--    orchestrator ticks race or when a retry hits the same block.
-- ============================================================

SELECT is(
  (SELECT (public.process_broadcast_step(
            'f0000509-0000-0000-0000-000000000001'::uuid,
            'harnwell',
            current_setting('test.phase07bc.anchor')::timestamptz,
            (current_setting('test.phase07bc.anchor')::timestamptz - interval '3 hours')
          ) ->> 'claimed')::boolean),
  false,
  'B-1 broadcast: second call returns claimed=false (idempotent)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE type = 'broadcast'
     AND payload ->> 'block_id' = 'f0000509-0000-0000-0000-000000000001'),
  2,
  'B-1 broadcast: notification count unchanged after idempotent second call (still 2)'
);

-- ============================================================
-- 4. rolled_back row is re-firable: simulates the rollback path after
--    a force-trigger decline at a moment within the broadcast offset
--    window (see ARCH §4.5 rollback procedure).
-- ============================================================

INSERT INTO public.block_step_status
  (block_id, step_name, status, fired_at, updated_at)
VALUES
  ('f0000509-0000-0000-0000-000000000002', 'broadcast', 'rolled_back',
   current_setting('test.phase07bc.anchor')::timestamptz - interval '3 hours',
   current_setting('test.phase07bc.anchor')::timestamptz - interval '3 hours');

SELECT is(
  (SELECT (public.process_broadcast_step(
            'f0000509-0000-0000-0000-000000000002'::uuid,
            'harnwell',
            current_setting('test.phase07bc.anchor')::timestamptz + interval '30 minutes',
            (current_setting('test.phase07bc.anchor')::timestamptz + interval '30 minutes' - interval '3 hours')
          ) ->> 'claimed')::boolean),
  true,
  'B-1 broadcast: rolled_back row re-fires (claimed=true on second-try)'
);

SELECT is(
  (SELECT status::text FROM public.block_step_status
   WHERE block_id = 'f0000509-0000-0000-0000-000000000002'
     AND step_name = 'broadcast'),
  'fired',
  'B-1 broadcast: rolled_back transitioned to fired'
);

-- ============================================================
-- 5. Zero-subscribers path: still claims the step but inserts no rows.
--    This matters because the Edge Function's contract is "broadcast
--    was attempted" — the chain advances even when no one is listening.
-- ============================================================

-- Create a block at a house with NO subscribed users. quad is closed
-- in some profiles but its row is in the houses table; we just need a
-- house_id that has no subscribed user filtered by our fixture.
INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('f0000509-0000-0000-0000-000000000004', 'quad',
   current_setting('test.phase07bc.anchor')::timestamptz + interval '90 minutes', 3);

SELECT is(
  (SELECT (public.process_broadcast_step(
            'f0000509-0000-0000-0000-000000000004'::uuid,
            'quad',
            current_setting('test.phase07bc.anchor')::timestamptz + interval '90 minutes',
            (current_setting('test.phase07bc.anchor')::timestamptz + interval '90 minutes' - interval '3 hours')
          ) ->> 'notifications_sent')::integer),
  0,
  'B-1 broadcast: zero-subscribers result is notifications_sent=0'
);

SELECT is(
  (SELECT status::text FROM public.block_step_status
   WHERE block_id = 'f0000509-0000-0000-0000-000000000004'
     AND step_name = 'broadcast'),
  'fired',
  'B-1 broadcast: step still claimed even when no subscribers exist'
);

SELECT * FROM finish();
ROLLBACK;
