-- pgTAP tests for Phase 12: Notification System — the DB-side surface (the
-- push_tokens device registry, the notification delivery-queue query with its
-- already-acknowledged suppression, the per-notification mark-delivered /
-- mark-read transitions, the dispatch_push token resolution + per-type
-- pushability, and the HM-leave mailto deeplink).
--
-- Spec sources:
--   BEHAVIORAL_SPECIFICATION.md
--     §7.1 (ack deadline = T-10m before float start; the snapshotted cadence
--       reminders are written at float-assign time — their delivery is THIS
--       phase's queue),
--     §7.2 / §7.3 (a float that is declined / voided / no-acked is no longer
--       pending — an in-flight ack reminder for it must NOT be delivered),
--     §2.6 rule 3 (HM-leave: "The system crafts an email notification to the
--       affected house's student workers explaining that the HM is on leave and
--       that emergency contact should go to the replacement (including the
--       replacement's role label and name). The system then opens the user's mail
--       application (via a mailto link on web …) with the message pre-filled" — the
--       API returns the mailto: URL; it does NOT send mail);
--   ARCHITECTURE.md
--     §3.7 (notifications.delivered_at null = pending; scheduled_for = the
--       future-cadence delivery instant; acknowledged_at populated when the user
--       opens the updates tab; sm_permanent_drop_alert / sw_permanent_removal_alert
--       are IN-APP ONLY — no push),
--     §2.8 (the ack cadence snapshot — the rows this queue delivers).
--   AGENTS.md hard invariant #6 (timestamptz in America/New_York).
-- Run with: supabase test db
--
-- WHAT THIS SUITE COVERS
-- ----------------------
--   A. push_tokens — table/columns/types, PK, FK→users, RLS, the (user_id,
--      device_token) UNIQUE constraint, the platform CHECK ('android'|'ios').
--   B. notification_is_pushable(type) — push goes to all types EXCEPT the two
--      in-app-only permanent-removal alerts (ARCH §3.7).
--   C. notification_push_targets(user) — dispatch resolution: a user with no
--      device returns zero rows (in-app only); a user with an Android + an iOS
--      device returns both.
--   D. pending_notification_deliveries(now) — the delivery queue: undelivered AND
--      due (scheduled_for <= now, boundary inclusive; NULL schedule = immediate);
--      excludes future, already-delivered; SUPPRESSES an ack_reminder whose float
--      is no longer pending (acknowledged / declined); a non-ack due row is never
--      suppressed.
--   E. deliver_notification(id, now) — stamps delivered_at once (idempotent), and
--      a delivered row leaves the queue.
--   F. mark_notification_read(id, user, now) — stamps acknowledged_at on the
--      recipient's updates-tab open; a non-recipient is a no-op.
--   G. craft_hm_leave_mailto(leave_id) — the §2.6 deeplink: a mailto: URL
--      addressed to the house's student workers, naming the replacement and their
--      role label, saying the HM is on leave. Returns a URL — never sends.
--
-- TDD-RED: the phase-12 migration (the push_tokens table + RLS, the
-- pending_notification_deliveries / deliver_notification / mark_notification_read
-- / notification_push_targets / notification_is_pushable functions, and
-- craft_hm_leave_mailto) is not yet written; this suite pins their contract and
-- turns GREEN when the migration lands — the same TDD discipline phase-09/10/11
-- used for their not-yet-existing RPCs. The PURE ack-cadence math (offset
-- computation, the snapshot, skip-past-offsets, the suppression predicate) is the
-- surface tested in packages/core/tests/phase-12/ack-cadence.test.ts; this suite
-- tests the DB-side device registry, the delivery queue, and the mailto deeplink.

BEGIN;

SELECT plan(55);

-- ============================================================
-- 0. Fixtures: harrison people (a float recipient, a leaving HM, a replacement
--    BM, two student workers), three float_assignments in distinct states, an
--    hm_leave row, and a controlled "now" on a clean EST instant.
--
--    float_assignments.{source,destination}_assignment_ids are uuid[] with NO
--    per-element FK (AGENTS phase-06 note), so arbitrary block uuids satisfy the
--    nonempty CHECK without needing real blocks.
-- ============================================================

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('0d000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p12-recipient@test.local'),
  ('0d000001-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p12-hm@test.local'),
  ('0d000001-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p12-repl@test.local'),
  ('0d000001-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p12-sw1@test.local'),
  ('0d000001-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p12-sw2@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('0d000001-0000-0000-0000-000000000001', 'Recipient W',  'p12-recipient@test.local', 'harrison', true),
  ('0d000001-0000-0000-0000-000000000002', 'Leaving HM',   'p12-hm@test.local',        'harrison', true),
  -- single-token name so the mailto substring match is URL-encoding-proof.
  ('0d000001-0000-0000-0000-000000000003', 'ReplBmgr',     'p12-repl@test.local',      'harrison', true),
  ('0d000001-0000-0000-0000-000000000004', 'SW One',       'p12-sw1@test.local',       'harrison', true),
  ('0d000001-0000-0000-0000-000000000005', 'SW Two',       'p12-sw2@test.local',       'harrison', true);

-- Roles: HM going on leave, BM replacement (→ "Building Manager" label), two SWs.
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('0d000001-0000-0000-0000-000000000002', 'hm', 'harrison'),
  ('0d000001-0000-0000-0000-000000000003', 'bm', 'harrison'),
  ('0d000001-0000-0000-0000-000000000004', 'sw', NULL),
  ('0d000001-0000-0000-0000-000000000005', 'sw', NULL);

-- A block + six assignment rows backing the float source/destination arrays:
-- float_assignments validates each array element exists in shift_block_assignments
-- (an INSERT/UPDATE trigger, not a per-element FK — AGENTS phase-06 note).
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES ('0d000006-0000-0000-0000-000000000001', 'harrison', '2026-02-10 20:00:00-05'::timestamptz, 1);

INSERT INTO public.shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  ('0d0000aa-0000-0000-0000-000000000001', '0d000006-0000-0000-0000-000000000001', NULL, 'vacant', 'never_assigned'),
  ('0d0000aa-0000-0000-0000-000000000002', '0d000006-0000-0000-0000-000000000001', NULL, 'vacant', 'never_assigned'),
  ('0d0000aa-0000-0000-0000-000000000003', '0d000006-0000-0000-0000-000000000001', NULL, 'vacant', 'never_assigned'),
  ('0d0000bb-0000-0000-0000-000000000001', '0d000006-0000-0000-0000-000000000001', NULL, 'vacant', 'never_assigned'),
  ('0d0000bb-0000-0000-0000-000000000002', '0d000006-0000-0000-0000-000000000001', NULL, 'vacant', 'never_assigned'),
  ('0d0000bb-0000-0000-0000-000000000003', '0d000006-0000-0000-0000-000000000001', NULL, 'vacant', 'never_assigned');

-- Three floats: pending (reminders deliver), acknowledged + declined (reminders
-- suppressed). The dest/source arrays reference the rows just created.
INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids, status,
   initiated_by, expires_for_cleanup_at, acknowledged_at, declined_at)
VALUES
  ('0d000003-0000-0000-0000-000000000001', '0d000001-0000-0000-0000-000000000001',
   ARRAY['0d0000aa-0000-0000-0000-000000000001']::uuid[],
   ARRAY['0d0000bb-0000-0000-0000-000000000001']::uuid[],
   'pending', 'automated', '2026-03-01 00:00:00-05'::timestamptz, NULL, NULL),
  ('0d000003-0000-0000-0000-000000000002', '0d000001-0000-0000-0000-000000000001',
   ARRAY['0d0000aa-0000-0000-0000-000000000002']::uuid[],
   ARRAY['0d0000bb-0000-0000-0000-000000000002']::uuid[],
   'acknowledged', 'automated', '2026-03-01 00:00:00-05'::timestamptz,
   '2026-02-10 11:00:00-05'::timestamptz, NULL),
  ('0d000003-0000-0000-0000-000000000003', '0d000001-0000-0000-0000-000000000001',
   ARRAY['0d0000aa-0000-0000-0000-000000000003']::uuid[],
   ARRAY['0d0000bb-0000-0000-0000-000000000003']::uuid[],
   'declined', 'automated', '2026-03-01 00:00:00-05'::timestamptz,
   NULL, '2026-02-10 11:00:00-05'::timestamptz);

-- hm_leave: the leaving HM, BM as replacement.
INSERT INTO public.hm_leave (leave_id, user_id, start_date, end_date, replacement_user_id, status)
VALUES
  ('0d000004-0000-0000-0000-000000000001', '0d000001-0000-0000-0000-000000000002',
   '2026-02-12', '2026-02-16', '0d000001-0000-0000-0000-000000000003', 'active');

-- Controlled "now" — a clean EST instant. Delivery rows are positioned relative
-- to it: due (-1h), exactly-now (0), future (+1h), already-delivered (-2h).
SELECT set_config('test.p12.now', ('2026-02-10 12:00:00-05'::timestamptz)::text, false);

-- Notification fixtures for the delivery queue. Explicit ids so we can probe each.
INSERT INTO public.notifications
  (notification_id, recipient_user_id, type, scheduled_for, delivered_at, payload)
VALUES
  -- n_due: due ack_reminder for the PENDING float → delivered.
  ('0d000005-0000-0000-0000-000000000001', '0d000001-0000-0000-0000-000000000001',
   'ack_reminder', current_setting('test.p12.now')::timestamptz - interval '1 hour', NULL,
   jsonb_build_object('kind','float_ack_reminder','float_id','0d000003-0000-0000-0000-000000000001')),
  -- n_now: scheduled_for EXACTLY now → due (the <= boundary is inclusive).
  ('0d000005-0000-0000-0000-000000000002', '0d000001-0000-0000-0000-000000000001',
   'ack_reminder', current_setting('test.p12.now')::timestamptz, NULL,
   jsonb_build_object('kind','float_ack_reminder','float_id','0d000003-0000-0000-0000-000000000001')),
  -- n_future: scheduled_for in the future → NOT yet due.
  ('0d000005-0000-0000-0000-000000000003', '0d000001-0000-0000-0000-000000000001',
   'ack_reminder', current_setting('test.p12.now')::timestamptz + interval '1 hour', NULL,
   jsonb_build_object('kind','float_ack_reminder','float_id','0d000003-0000-0000-0000-000000000001')),
  -- n_delivered: already delivered → NOT in the queue.
  ('0d000005-0000-0000-0000-000000000004', '0d000001-0000-0000-0000-000000000001',
   'ack_reminder', current_setting('test.p12.now')::timestamptz - interval '2 hours',
   current_setting('test.p12.now')::timestamptz - interval '90 minutes',
   jsonb_build_object('kind','float_ack_reminder','float_id','0d000003-0000-0000-0000-000000000001')),
  -- n_null: scheduled_for NULL (no future-cadence) → an immediate delivery.
  ('0d000005-0000-0000-0000-000000000005', '0d000001-0000-0000-0000-000000000001',
   'personal_shift', NULL, NULL,
   jsonb_build_object('kind','float_assigned')),
  -- n_acked: due ack_reminder whose float is ACKNOWLEDGED → SUPPRESSED.
  ('0d000005-0000-0000-0000-000000000006', '0d000001-0000-0000-0000-000000000001',
   'ack_reminder', current_setting('test.p12.now')::timestamptz - interval '1 hour', NULL,
   jsonb_build_object('kind','float_ack_reminder','float_id','0d000003-0000-0000-0000-000000000002')),
  -- n_declined: due ack_reminder whose float is DECLINED → SUPPRESSED.
  ('0d000005-0000-0000-0000-000000000007', '0d000001-0000-0000-0000-000000000001',
   'ack_reminder', current_setting('test.p12.now')::timestamptz - interval '1 hour', NULL,
   jsonb_build_object('kind','float_ack_reminder','float_id','0d000003-0000-0000-0000-000000000003')),
  -- n_personal_due: a due NON-ack notification (no float dependency) → never suppressed.
  ('0d000005-0000-0000-0000-000000000008', '0d000001-0000-0000-0000-000000000001',
   'personal_shift', current_setting('test.p12.now')::timestamptz - interval '1 hour', NULL,
   jsonb_build_object('kind','personal_shift_change'));

-- ============================================================
-- A. push_tokens — the per-device registry (one row per device per user).
-- ============================================================

SELECT has_table('public', 'push_tokens', 'push_tokens table exists (one row per device per user)');
SELECT has_column('public', 'push_tokens', 'push_token_id', 'push_tokens.push_token_id exists');
SELECT has_column('public', 'push_tokens', 'user_id',       'push_tokens.user_id exists');
SELECT has_column('public', 'push_tokens', 'platform',      'push_tokens.platform exists');
SELECT has_column('public', 'push_tokens', 'device_token',  'push_tokens.device_token exists');
SELECT has_column('public', 'push_tokens', 'created_at',    'push_tokens.created_at exists');

SELECT col_type_is('public', 'push_tokens', 'push_token_id', 'uuid',        'push_token_id is uuid');
SELECT col_type_is('public', 'push_tokens', 'user_id',       'uuid',        'user_id is uuid');
SELECT col_type_is('public', 'push_tokens', 'platform',      'text',        'platform is text');
SELECT col_type_is('public', 'push_tokens', 'device_token',  'text',        'device_token is text');
SELECT col_type_is('public', 'push_tokens', 'created_at',    'timestamp with time zone', 'created_at is timestamptz');

SELECT col_is_pk('public', 'push_tokens', 'push_token_id', 'push_token_id is the primary key');
SELECT fk_ok(
  'public', 'push_tokens', ARRAY['user_id'],
  'public', 'users',       ARRAY['user_id'],
  'push_tokens.user_id → users.user_id'
);

SELECT is(
  (SELECT relrowsecurity FROM pg_class
    WHERE relname = 'push_tokens' AND relnamespace = 'public'::regnamespace),
  true, 'push_tokens has RLS enabled');

-- platform CHECK: android / ios accepted, anything else rejected.
SELECT lives_ok(
  $$ INSERT INTO public.push_tokens (user_id, platform, device_token)
     VALUES ('0d000001-0000-0000-0000-000000000001', 'android', 'tok-android-1') $$,
  'platform=android is accepted');
SELECT lives_ok(
  $$ INSERT INTO public.push_tokens (user_id, platform, device_token)
     VALUES ('0d000001-0000-0000-0000-000000000001', 'ios', 'tok-ios-1') $$,
  'platform=ios is accepted (a user may register an Android AND an iOS device)');
SELECT throws_ok(
  $$ INSERT INTO public.push_tokens (user_id, platform, device_token)
     VALUES ('0d000001-0000-0000-0000-000000000001', 'web', 'tok-web-1') $$,
  '23514', NULL, 'platform=web is rejected by the CHECK constraint');

-- UNIQUE (user_id, device_token): same device for the same user is a duplicate;
-- the same device_token string for a DIFFERENT user is allowed.
SELECT throws_ok(
  $$ INSERT INTO public.push_tokens (user_id, platform, device_token)
     VALUES ('0d000001-0000-0000-0000-000000000001', 'android', 'tok-android-1') $$,
  '23505', NULL, 'duplicate (user_id, device_token) is rejected (UNIQUE)');
SELECT lives_ok(
  $$ INSERT INTO public.push_tokens (user_id, platform, device_token)
     VALUES ('0d000001-0000-0000-0000-000000000004', 'android', 'tok-android-1') $$,
  'the same device_token for a DIFFERENT user is allowed');

-- ============================================================
-- B. notification_is_pushable(type) — push for all types EXCEPT the two in-app-
--    only permanent-removal alerts (ARCH §3.7).
-- ============================================================

SELECT has_function('public', 'notification_is_pushable', ARRAY['notification_type'],
  'notification_is_pushable(type) exists');
SELECT is(public.notification_is_pushable('personal_shift'),  true,
  'personal_shift is pushable');
SELECT is(public.notification_is_pushable('ack_reminder'),    true,
  'ack_reminder is pushable');
SELECT is(public.notification_is_pushable('hm_leave_notice'), true,
  'hm_leave_notice is pushable');
SELECT is(public.notification_is_pushable('sm_permanent_drop_alert'), false,
  'sm_permanent_drop_alert is in-app only — NOT pushable (ARCH §3.7)');
SELECT is(public.notification_is_pushable('sw_permanent_removal_alert'), false,
  'sw_permanent_removal_alert is in-app only — NOT pushable (ARCH §3.7)');

-- ============================================================
-- C. notification_push_targets(user) — dispatch resolution to device tokens.
-- ============================================================

SELECT has_function('public', 'notification_push_targets', ARRAY['uuid'],
  'notification_push_targets(user) exists');

-- sw2 registered no device → in-app only (zero push targets).
SELECT is(
  (SELECT count(*)::integer FROM public.notification_push_targets('0d000001-0000-0000-0000-000000000005')),
  0, 'a worker with no push_tokens resolves to zero dispatch targets (in-app only)');

-- recipient registered Android + iOS → both targets resolve.
SELECT is(
  (SELECT count(*)::integer FROM public.notification_push_targets('0d000001-0000-0000-0000-000000000001')),
  2, 'a worker with 2 devices resolves to 2 dispatch targets');
SELECT is(
  (SELECT count(DISTINCT platform)::integer FROM public.notification_push_targets('0d000001-0000-0000-0000-000000000001')),
  2, 'both platforms (android + ios) are present among the dispatch targets');

-- ============================================================
-- D. pending_notification_deliveries(now) — the delivery queue.
-- ============================================================

SELECT has_function('public', 'pending_notification_deliveries', ARRAY['timestamptz'],
  'pending_notification_deliveries(now) exists');

-- n_due: undelivered + due (scheduled_for < now) for a PENDING float → present.
SELECT is(
  (SELECT count(*)::integer FROM public.pending_notification_deliveries(current_setting('test.p12.now')::timestamptz)
    WHERE notification_id = '0d000005-0000-0000-0000-000000000001'),
  1, 'queue: a due, undelivered ack_reminder for a pending float is delivered');

-- n_now: scheduled_for EXACTLY now → present (the <= boundary is inclusive).
SELECT is(
  (SELECT count(*)::integer FROM public.pending_notification_deliveries(current_setting('test.p12.now')::timestamptz)
    WHERE notification_id = '0d000005-0000-0000-0000-000000000002'),
  1, 'queue: scheduled_for == now is due (boundary inclusive, §3.7 scheduled_for <= NOW())');

-- n_future: NOT yet due → absent.
SELECT is(
  (SELECT count(*)::integer FROM public.pending_notification_deliveries(current_setting('test.p12.now')::timestamptz)
    WHERE notification_id = '0d000005-0000-0000-0000-000000000003'),
  0, 'queue: a future-scheduled reminder is NOT delivered yet');

-- n_delivered: already delivered → absent.
SELECT is(
  (SELECT count(*)::integer FROM public.pending_notification_deliveries(current_setting('test.p12.now')::timestamptz)
    WHERE notification_id = '0d000005-0000-0000-0000-000000000004'),
  0, 'queue: an already-delivered notification is excluded');

-- n_null: scheduled_for NULL → immediate delivery → present.
SELECT is(
  (SELECT count(*)::integer FROM public.pending_notification_deliveries(current_setting('test.p12.now')::timestamptz)
    WHERE notification_id = '0d000005-0000-0000-0000-000000000005'),
  1, 'queue: a NULL scheduled_for is treated as immediate (delivered now)');

-- n_acked: ack_reminder for an ACKNOWLEDGED float → SUPPRESSED.
SELECT is(
  (SELECT count(*)::integer FROM public.pending_notification_deliveries(current_setting('test.p12.now')::timestamptz)
    WHERE notification_id = '0d000005-0000-0000-0000-000000000006'),
  0, 'queue: an ack_reminder for an already-acknowledged float is silently suppressed (§7.2)');

-- n_declined: ack_reminder for a DECLINED float → SUPPRESSED.
SELECT is(
  (SELECT count(*)::integer FROM public.pending_notification_deliveries(current_setting('test.p12.now')::timestamptz)
    WHERE notification_id = '0d000005-0000-0000-0000-000000000007'),
  0, 'queue: an ack_reminder for a declined float is suppressed (§7.3)');

-- n_personal_due: a due NON-ack notification is never subject to float suppression.
SELECT is(
  (SELECT count(*)::integer FROM public.pending_notification_deliveries(current_setting('test.p12.now')::timestamptz)
    WHERE notification_id = '0d000005-0000-0000-0000-000000000008'),
  1, 'queue: a due non-ack notification is delivered (suppression applies only to ack_reminders)');

-- ============================================================
-- E. deliver_notification(id, now) — stamp delivered_at once; idempotent.
-- ============================================================

SELECT has_function('public', 'deliver_notification', ARRAY['uuid', 'timestamptz'],
  'deliver_notification(id, now) exists');

SELECT is(
  public.deliver_notification('0d000005-0000-0000-0000-000000000001', current_setting('test.p12.now')::timestamptz),
  true, 'deliver_notification stamps an undelivered row and reports true');

SELECT is(
  (SELECT delivered_at FROM public.notifications WHERE notification_id = '0d000005-0000-0000-0000-000000000001'),
  current_setting('test.p12.now')::timestamptz,
  'delivered_at is set to the delivery instant');

SELECT is(
  public.deliver_notification('0d000005-0000-0000-0000-000000000001', current_setting('test.p12.now')::timestamptz + interval '5 minutes'),
  false, 'deliver_notification is idempotent — re-delivering an already-delivered row reports false');

SELECT is(
  (SELECT count(*)::integer FROM public.pending_notification_deliveries(current_setting('test.p12.now')::timestamptz)
    WHERE notification_id = '0d000005-0000-0000-0000-000000000001'),
  0, 'a delivered notification leaves the pending queue');

-- ============================================================
-- F. mark_notification_read(id, user, now) — acknowledged_at on updates-tab open.
-- ============================================================

SELECT has_function('public', 'mark_notification_read', ARRAY['uuid', 'uuid', 'timestamptz'],
  'mark_notification_read(id, user, now) exists');

-- A non-recipient cannot mark another user's notification read → no-op (false).
SELECT is(
  public.mark_notification_read('0d000005-0000-0000-0000-000000000002',
    '0d000001-0000-0000-0000-000000000004', current_setting('test.p12.now')::timestamptz),
  false, 'mark_notification_read by a non-recipient is a no-op');
SELECT ok(
  (SELECT acknowledged_at FROM public.notifications WHERE notification_id = '0d000005-0000-0000-0000-000000000002') IS NULL,
  'acknowledged_at stays NULL after the non-recipient no-op');

-- The recipient opens their updates tab → acknowledged_at is stamped.
SELECT is(
  public.mark_notification_read('0d000005-0000-0000-0000-000000000002',
    '0d000001-0000-0000-0000-000000000001', current_setting('test.p12.now')::timestamptz),
  true, 'mark_notification_read by the recipient stamps acknowledged_at and reports true');
SELECT is(
  (SELECT acknowledged_at FROM public.notifications WHERE notification_id = '0d000005-0000-0000-0000-000000000002'),
  current_setting('test.p12.now')::timestamptz,
  'acknowledged_at is set to the open instant');

-- ============================================================
-- G. craft_hm_leave_mailto(leave_id) — the §2.6 mailto deeplink. Returns a URL;
--    never sends. Addressed to the house's student workers; names the replacement
--    and their role label; says the HM is on leave.
-- ============================================================

SELECT has_function('public', 'craft_hm_leave_mailto', ARRAY['uuid'],
  'craft_hm_leave_mailto(leave_id) exists');

SELECT alike(
  public.craft_hm_leave_mailto('0d000004-0000-0000-0000-000000000001'),
  'mailto:%',
  'the deeplink is a mailto: URL (§2.6 — opens the mail app, does not send)');

SELECT alike(
  public.craft_hm_leave_mailto('0d000004-0000-0000-0000-000000000001'),
  '%p12-sw1@test.local%',
  'the mailto addresses student worker 1 of the affected house');
SELECT alike(
  public.craft_hm_leave_mailto('0d000004-0000-0000-0000-000000000001'),
  '%p12-sw2@test.local%',
  'the mailto addresses student worker 2 of the affected house');

SELECT alike(
  public.craft_hm_leave_mailto('0d000004-0000-0000-0000-000000000001'),
  '%ReplBmgr%',
  'the mailto names the replacement (§2.6 rule 3)');
SELECT alike(
  public.craft_hm_leave_mailto('0d000004-0000-0000-0000-000000000001'),
  '%Building%Manager%',
  'the mailto includes the replacement''s role label (BM → "Building Manager")');
SELECT alike(
  public.craft_hm_leave_mailto('0d000004-0000-0000-0000-000000000001'),
  '%leave%',
  'the mailto body says the HM is on leave');

SELECT * FROM finish();
ROLLBACK;
