-- pgTAP tests for web-remediation session S3: the Allied "resolved" state — the
-- `set_allied_resolved` RPC + the new notifications.resolved_at / resolved_by
-- columns (audit #3, reframed). Plus the reused mark_notification_read path.
--
-- Spec sources:
--   BEHAVIORAL_SPECIFICATION.md
--     §5.4 (escalation chain — T-2h float-lookup failure → HMOD notified that
--       Allied coverage is required; "once Allied is assigned, the gap is
--       considered resolved"),
--     §10.1 (routing — HM/BM notifications real-time to the HM in HM hours; the
--       on-duty HMOD off-hours/weekends; "the HM/BM/HMOD places the call to Allied"),
--     §10.3 (the Allied-procurement notification's content: house, window, reason);
--   docs/design-brief.md §6.4 (the Action inbox — the Allied-procurement alert is
--     the signature item; read/unread, urgency, clean empty state);
--   AGENTS.md hard invariants #3 (no-takeback — resolving an alert may NOT touch a
--     pending float / assignment), #5 (30-min blocks), #6 (NY timestamptz);
--   docs/web-remediation/sessions/S3/TEST_PLAN.md (the §4a behavior contract +
--     pinned decisions D1/D2/D4 — this suite pins §4a). Run with: supabase test db
--
-- THE REFRAME (TEST_PLAN "what resolved is"): an `hmod_urgent` notification means
-- "this coverage gap needs an Allied call". The HM (in hours) or the on-duty HMOD
-- (off-hours) makes that call OUT OF BAND. S3 adds a single Resolved checkbox that
-- marks the ALERT handled — it does NOT fill the seat. **Resolved ≠ covered.** The
-- RPC therefore touches ONLY the notifications row (line 16 below proves it leaves
-- every shift_block_assignments row untouched — no-takeback, invariant #3).
--
-- WHAT THIS SUITE COVERS (§4a)
-- ----------------------------
--   Existence  — the (uuid,uuid,boolean,timestamptz)→boolean signature + the two
--                new columns (lines 1–2).
--   Resolve    — set resolved_at=p_now / resolved_by=p_user_id, return true (3);
--                clear on unresolve, return true (4); idempotent double-resolve →
--                false, row unchanged (5); double-unresolve → false, no error (6).
--   Authz      — the HM (7) and BM (8) of the alert's house may resolve; the
--                on-duty HMOD may resolve an alert for a house they do NOT
--                administer (9); an HM of a DIFFERENT house who is not the on-duty
--                HMOD is rejected (10); an SM (11) and an SW (12) are rejected.
--   Type gate  — a non-hmod_urgent notification is not_resolvable, row unchanged (13).
--   Bad id     — an unknown notification id raises notification_not_found (14).
--   Grants     — REVOKE from PUBLIC + GRANT to authenticated, service_role (15).
--   Decoupling — resolving mutates NO shift_block_assignments row (16; resolved ≠
--                covered, no-takeback).
--   Reuse      — a non-urgent notification still marks read via
--                mark_notification_read (acknowledged_at set) (17).
--
-- TDD-RED: the S3 migration (`set_allied_resolved` + the resolved_at / resolved_by
-- columns, migration 20260606000002) is not yet written; this suite pins their
-- contract and turns GREEN when the migration lands — the same TDD discipline
-- phase-09/10/11 + S1 used for their not-yet-existing RPCs. The PURE inbox-filter
-- predicates the data layer pairs with this RPC are the surface tested in
-- packages/core/tests/s3-inbox/inbox.test.ts.
--
-- Note on the spoof guard (D2 step 3): it depends on auth.uid(). pgTAP runs as a
-- superuser where auth.uid() is NULL, so the guard's `auth.uid() IS NULL`
-- (service-role) branch is the one every role test below exercises — the SAME
-- branch the web action uses (it always calls with the service client). A dedicated
-- SET ROLE + request.jwt.claims spoof test is OPTIONAL per the TEST_PLAN and is
-- omitted here as awkward to set up reliably; the guard's job is just to not block
-- service-role, which lines 3–12 already cover.

BEGIN;

SELECT plan(35);

-- ============================================================
-- 0. Fixtures.
--    Anchor: a FIXED Saturday-afternoon NY-local instant in July 2026 — DST-stable
--    (EDT), and a weekend so the on-duty-HMOD routing (§10.1) is the natural read
--    for the gating actor. p_now is passed EXPLICITLY to every call so the suite is
--    clock-independent (AGENTS invariant #6 — never naive timestamps).
--
--    Houses (all seeded by supabase/seed.sql, applied before pgTAP):
--      quad     — the ALERT house (payload.house_id). Hana the HM + Bea the BM
--                 administer it.
--      house-05 — a SECOND house; its HM is the wrong-house-admin rejection (10).
--      house-07 — the HMOD's HOME house (≠ quad), so line 9 proves the on-duty-HMOD
--                 branch authorized them, NOT house-admin.
-- ============================================================

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  -- Hana — HM of quad (the alert house). The primary resolver.
  ('53000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's3-hm-quad@test.local'),
  -- Bea — BM of quad. Also authorized for the alert house.
  ('53000001-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's3-bm-quad@test.local'),
  -- Sam — SM of quad. NEVER authorized (sm is not hm/bm).
  ('53000001-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's3-sm-quad@test.local'),
  -- Wendy — a plain SW. NEVER authorized.
  ('53000001-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's3-sw@test.local'),
  -- Otto — HM of house-05. An admin of a DIFFERENT house; NOT the on-duty HMOD → rejected.
  ('53000001-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's3-hm-other@test.local'),
  -- Holly — HM of house-07, wired on duty as HMOD via hmod_rotor. Authorized for a
  --         quad alert ONLY through the HMOD branch (her home house ≠ quad).
  ('53000001-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's3-hmod@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('53000001-0000-0000-0000-000000000001', 'Hana Quad',   's3-hm-quad@test.local', 'quad',     true),
  ('53000001-0000-0000-0000-000000000002', 'Bea Quad',    's3-bm-quad@test.local', 'quad',     true),
  ('53000001-0000-0000-0000-000000000003', 'Sam Quad',    's3-sm-quad@test.local', 'quad',     true),
  ('53000001-0000-0000-0000-000000000004', 'Wendy Quad',  's3-sw@test.local',      'quad',     true),
  ('53000001-0000-0000-0000-000000000005', 'Otto Five',   's3-hm-other@test.local','house-05', true),
  ('53000001-0000-0000-0000-000000000006', 'Holly Seven', 's3-hmod@test.local',    'house-07', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('53000001-0000-0000-0000-000000000001', 'hm', 'quad'),       -- alert-house HM
  ('53000001-0000-0000-0000-000000000002', 'bm', 'quad'),       -- alert-house BM
  ('53000001-0000-0000-0000-000000000003', 'sm', 'quad'),       -- alert-house SM (NOT authorized)
  ('53000001-0000-0000-0000-000000000004', 'sw', NULL),         -- plain SW (NOT authorized)
  ('53000001-0000-0000-0000-000000000005', 'hm', 'house-05'),   -- HM of the WRONG house
  ('53000001-0000-0000-0000-000000000006', 'hm', 'house-07');   -- HMOD's home-house HM role

-- Anchor: 2026-07-04 14:00 America/New_York (EDT, a Saturday). Stored as timestamptz.
SELECT set_config(
  'test.s3.now',
  ('2026-07-04 14:00'::timestamp AT TIME ZONE 'America/New_York')::text,
  false
);

-- The Friday-anchored HMOD rotor week for p_now, computed with the EXACT formula
-- resolve_hmod_on_duty uses (20260528000008 / 20260528000012):
--   v_shifted   := ((p_now AT TIME ZONE 'America/New_York') - interval '8 hours')::date
--   v_week_start:= v_shifted - (((extract(isodow FROM v_shifted)::int + 2) % 7))
-- For Sat 2026-07-04 14:00 EDT this lands on Fri 2026-07-03 (isodow 5 — satisfies the
-- hmod_rotor_week_start_friday_check CHECK).
SELECT set_config(
  'test.s3.hmod_week',
  (
    WITH shifted AS (
      SELECT ((current_setting('test.s3.now')::timestamptz AT TIME ZONE 'America/New_York')
                - interval '8 hours')::date AS d
    )
    SELECT (d - (((extract(isodow FROM d)::int + 2) % 7)))::text FROM shifted
  ),
  false
);

-- Wire Holly (HM of house-07) on duty as HMOD for p_now's week. She is active with
-- NO hm_leave covering the interval, so resolve_hm_for_user returns her unchanged →
-- resolve_hmod_on_duty(p_now) = Holly.
INSERT INTO public.hmod_rotor (week_start_date, hmod_user_id)
VALUES (current_setting('test.s3.hmod_week')::date, '53000001-0000-0000-0000-000000000006')
ON CONFLICT (week_start_date) DO UPDATE SET hmod_user_id = EXCLUDED.hmod_user_id;

-- A quad block + an assignment row, so the alert payload can name a real block and
-- the "resolved ≠ covered" decoupling test (line 16) has a seat to prove untouched.
-- A FUTURE quad seat (block at p_now + 6h, still vacant — the gap the alert is about).
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('53000002-0000-0000-0000-000000000001', 'quad',
   current_setting('test.s3.now')::timestamptz + interval '6 hours', 1);

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES
  -- The still-vacant quad seat the Allied alert is escalating. It must remain a gap
  -- (resolving the alert does NOT cover it).
  ('53000003-0000-0000-0000-000000000001', '53000002-0000-0000-0000-000000000001',
   NULL, 'vacant', 'never_assigned', false, NULL);

-- ---- Notification fixtures ----
-- A1: an unresolved hmod_urgent alert for quad → the resolve target (lines 3,5,7,9..14,16).
-- A2: a SECOND unresolved hmod_urgent alert for quad → the unresolve/idempotent-unresolve
--     target (lines 4,6) so each line owns its own row (no cross-test ordering coupling).
-- A3: an unresolved hmod_urgent alert for quad → the BM target (line 8).
-- A4: an unresolved hmod_urgent alert for quad → the wrong-house-admin reject target (line 10).
-- A5: an unresolved hmod_urgent alert for quad → the SM reject target (line 11).
-- A6: an unresolved hmod_urgent alert for quad → the SW reject target (line 12).
-- N7: a NON-urgent hm_leave_notice → the not_resolvable target (13) + the
--     mark_notification_read reuse target (17).
INSERT INTO public.notifications
  (notification_id, recipient_user_id, type, scheduled_for, delivered_at, acknowledged_at, payload)
VALUES
  -- A1 — primary resolve target. Recipient is the on-duty HMOD (off-hours routing).
  ('53000005-0000-0000-0000-000000000001', '53000001-0000-0000-0000-000000000006',
   'hmod_urgent', NULL, NULL, NULL,
   jsonb_build_object(
     'target', 'hm', 'reason', 'escalation_chain', 'house_id', 'quad',
     'block_id', '53000002-0000-0000-0000-000000000001',
     'block_start_at', (current_setting('test.s3.now')::timestamptz + interval '6 hours')::text)),
  -- A2 — unresolve / double-unresolve target. Inserted UNRESOLVED here, then driven to
  --      RESOLVED via the RPC in the setup step below (set_allied_resolved as Hana) so
  --      line 4 can clear it and line 6 can re-clear a no-op. (Driving it through the RPC
  --      rather than a literal resolved_at column keeps this INSERT independent of the
  --      new columns; the suite's first RED is the set_allied_resolved setup call, which
  --      does not exist pre-migration.)
  ('53000005-0000-0000-0000-000000000002', '53000001-0000-0000-0000-000000000006',
   'hmod_urgent', NULL, NULL, NULL,
   jsonb_build_object('target','hm','reason','escalation_chain','house_id','quad')),
  -- A3 — BM resolve target.
  ('53000005-0000-0000-0000-000000000003', '53000001-0000-0000-0000-000000000006',
   'hmod_urgent', NULL, NULL, NULL,
   jsonb_build_object('target','hm','reason','escalation_chain','house_id','quad')),
  -- A4 — wrong-house-admin reject target.
  ('53000005-0000-0000-0000-000000000004', '53000001-0000-0000-0000-000000000006',
   'hmod_urgent', NULL, NULL, NULL,
   jsonb_build_object('target','hm','reason','escalation_chain','house_id','quad')),
  -- A5 — SM reject target.
  ('53000005-0000-0000-0000-000000000005', '53000001-0000-0000-0000-000000000006',
   'hmod_urgent', NULL, NULL, NULL,
   jsonb_build_object('target','hm','reason','escalation_chain','house_id','quad')),
  -- A6 — SW reject target.
  ('53000005-0000-0000-0000-000000000006', '53000001-0000-0000-0000-000000000006',
   'hmod_urgent', NULL, NULL, NULL,
   jsonb_build_object('target','hm','reason','escalation_chain','house_id','quad')),
  -- N7 — a NON-urgent notification (no house_id). not_resolvable + mark-read target.
  --      Recipient = Hana (so the mark_notification_read recipient scope matches).
  ('53000005-0000-0000-0000-000000000007', '53000001-0000-0000-0000-000000000001',
   'hm_leave_notice', NULL, NULL, NULL,
   jsonb_build_object('kind','hm_leave_notice'));

-- Pre-resolve A2 (the unresolve target) via the RPC itself, as the alert-house HM —
-- this is the SETUP for lines 4 & 6, kept out of the asserted lines so they test the
-- CLEAR path in isolation. (Runs after the function exists; in RED the whole file
-- aborts earlier at the missing columns / function, so this is harmless setup.)
SELECT set_config(
  'test.s3.pre_resolve_a2',
  (public.set_allied_resolved(
     '53000005-0000-0000-0000-000000000002'::uuid,
     '53000001-0000-0000-0000-000000000001'::uuid,                 -- Hana (alert-house HM)
     true,
     current_setting('test.s3.now')::timestamptz
   ))::text,
  false
);

-- ============================================================
-- 1. EXISTENCE — the signature + the new columns (§4a lines 1–2).
-- ============================================================

-- Line 1.
SELECT has_function(
  'public', 'set_allied_resolved',
  ARRAY['uuid', 'uuid', 'boolean', 'timestamptz'],
  'should expose set_allied_resolved with the (uuid,uuid,boolean,timestamptz)→boolean signature'
);
-- Return type via catalog introspection (the repo idiom — function_returns' args-array
-- overload normalizes 'timestamptz' inconsistently with has_function above; the grant
-- check below likewise reads the catalog directly).
SELECT is(
  pg_get_function_result(
    'public.set_allied_resolved(uuid, uuid, boolean, timestamptz)'::regprocedure),
  'boolean',
  'set_allied_resolved returns boolean ("state changed")'
);

-- Line 2.
SELECT has_column('public', 'notifications', 'resolved_at',
  'should add notifications.resolved_at and resolved_by columns (resolved_at present)');
SELECT has_column('public', 'notifications', 'resolved_by',
  'notifications.resolved_by column present');
SELECT col_type_is('public', 'notifications', 'resolved_at', 'timestamp with time zone',
  'notifications.resolved_at is timestamptz (D1)');
SELECT col_type_is('public', 'notifications', 'resolved_by', 'uuid',
  'notifications.resolved_by is uuid (D1)');
SELECT fk_ok(
  'public', 'notifications', ARRAY['resolved_by'],
  'public', 'users',         ARRAY['user_id'],
  'notifications.resolved_by → users.user_id (D1, ON DELETE SET NULL)'
);

-- ============================================================
-- 3. RESOLVE — set / clear / idempotency (§4a lines 3–6).
-- ============================================================

-- Line 3 — resolve A1 (as the on-duty HMOD): true, and the columns are stamped.
SELECT is(
  public.set_allied_resolved(
    '53000005-0000-0000-0000-000000000001'::uuid,
    '53000001-0000-0000-0000-000000000006'::uuid,                  -- Holly (on-duty HMOD)
    true,
    current_setting('test.s3.now')::timestamptz),
  true,
  'should set resolved_at=p_now and resolved_by=p_user_id when resolving an hmod_urgent alert (returns true)'
);
SELECT is(
  (SELECT resolved_at FROM public.notifications WHERE notification_id = '53000005-0000-0000-0000-000000000001'),
  current_setting('test.s3.now')::timestamptz,
  'resolve: resolved_at is set to p_now'
);
SELECT is(
  (SELECT resolved_by FROM public.notifications WHERE notification_id = '53000005-0000-0000-0000-000000000001'),
  '53000001-0000-0000-0000-000000000006'::uuid,
  'resolve: resolved_by is set to p_user_id'
);

-- Line 4 — unresolve A2 (pre-resolved in setup), as the alert-house HM: true, columns cleared.
SELECT is(
  public.set_allied_resolved(
    '53000005-0000-0000-0000-000000000002'::uuid,
    '53000001-0000-0000-0000-000000000001'::uuid,                  -- Hana (alert-house HM)
    false,
    current_setting('test.s3.now')::timestamptz),
  true,
  'should clear resolved_at and resolved_by when unresolving (returns true)'
);
SELECT ok(
  (SELECT resolved_at FROM public.notifications WHERE notification_id = '53000005-0000-0000-0000-000000000002') IS NULL
  AND (SELECT resolved_by FROM public.notifications WHERE notification_id = '53000005-0000-0000-0000-000000000002') IS NULL,
  'unresolve: both resolved_at and resolved_by are cleared to NULL'
);

-- Line 5 — a SECOND resolve of A1 (already resolved) → false, row unchanged. Use a
-- DIFFERENT p_now to prove the conditional WHERE … IS NULL no-ops (resolved_at stays
-- the ORIGINAL instant, not the new one) rather than re-stamping.
SELECT is(
  public.set_allied_resolved(
    '53000005-0000-0000-0000-000000000001'::uuid,
    '53000001-0000-0000-0000-000000000001'::uuid,                  -- Hana
    true,
    current_setting('test.s3.now')::timestamptz + interval '15 minutes'),
  false,
  'should be idempotent — a second resolve returns false and leaves resolved_at/by unchanged'
);
SELECT is(
  (SELECT resolved_at FROM public.notifications WHERE notification_id = '53000005-0000-0000-0000-000000000001'),
  current_setting('test.s3.now')::timestamptz,
  'idempotent resolve: resolved_at is STILL the original p_now (the no-op did not re-stamp)'
);
SELECT is(
  (SELECT resolved_by FROM public.notifications WHERE notification_id = '53000005-0000-0000-0000-000000000001'),
  '53000001-0000-0000-0000-000000000006'::uuid,
  'idempotent resolve: resolved_by is STILL the original resolver (not overwritten)'
);

-- Line 6 — a SECOND unresolve of A2 (already unresolved) → false, no error.
SELECT is(
  public.set_allied_resolved(
    '53000005-0000-0000-0000-000000000002'::uuid,
    '53000001-0000-0000-0000-000000000001'::uuid,                  -- Hana
    false,
    current_setting('test.s3.now')::timestamptz),
  false,
  'should treat a second unresolve as a no-op returning false (not an error)'
);

-- ============================================================
-- 7. AUTHZ — who may resolve (§4a lines 7–12). D4 gating.
-- ============================================================

-- Line 7 — the HM of the alert's house (Hana) may resolve A3.
SELECT lives_ok(
  $$ SELECT public.set_allied_resolved(
       '53000005-0000-0000-0000-000000000003'::uuid,
       '53000001-0000-0000-0000-000000000001'::uuid,               -- Hana (HM of quad)
       true,
       current_setting('test.s3.now')::timestamptz) $$,
  'should allow the HM of the alert''s house to resolve'
);
SELECT is(
  (SELECT resolved_by FROM public.notifications WHERE notification_id = '53000005-0000-0000-0000-000000000003'),
  '53000001-0000-0000-0000-000000000001'::uuid,
  'HM resolve: A3 is now resolved by the alert-house HM'
);

-- Line 8 — the BM of the alert's house (Bea) may resolve A3 (unresolve then re-resolve
-- as the BM, so the BM-authorized path is what writes).
SELECT lives_ok(
  $$ SELECT public.set_allied_resolved(
       '53000005-0000-0000-0000-000000000003'::uuid,
       '53000001-0000-0000-0000-000000000002'::uuid,               -- Bea (BM of quad)
       false,                                                      -- clear first (BM-authorized)
       current_setting('test.s3.now')::timestamptz) $$,
  'should allow the BM of the alert''s house to resolve (BM may clear)'
);
SELECT is(
  public.set_allied_resolved(
    '53000005-0000-0000-0000-000000000003'::uuid,
    '53000001-0000-0000-0000-000000000002'::uuid,                  -- Bea (BM of quad)
    true,                                                          -- and re-resolve
    current_setting('test.s3.now')::timestamptz),
  true,
  'BM resolve: the BM of the alert''s house re-resolves the alert (state changed)'
);

-- Line 9 — the on-duty HMOD (Holly, home house house-07 ≠ quad) may resolve a quad
-- alert. A4 is for quad; Holly is NOT a house-admin of quad, so success here proves
-- the HMOD branch (not house-admin) authorized her.
SELECT lives_ok(
  $$ SELECT public.set_allied_resolved(
       '53000005-0000-0000-0000-000000000004'::uuid,
       '53000001-0000-0000-0000-000000000006'::uuid,               -- Holly (on-duty HMOD)
       true,
       current_setting('test.s3.now')::timestamptz) $$,
  'should allow the on-duty HMOD to resolve an alert for a house they do not administer'
);
-- Belt-and-braces: Holly genuinely is NOT a quad house-admin, so the success above
-- can ONLY have come from the HMOD branch.
SELECT is(
  public.user_has_house_admin_role('53000001-0000-0000-0000-000000000006'::uuid, 'quad'),
  false,
  'HMOD authz: Holly is NOT an hm/bm of quad — her authorization is the on-duty-HMOD branch alone'
);

-- Line 10 — an HM of a DIFFERENT house (Otto, HM of house-05) who is not the on-duty
-- HMOD is rejected; A5 (a quad alert) is left unchanged.
SELECT throws_ok(
  $$ SELECT public.set_allied_resolved(
       '53000005-0000-0000-0000-000000000005'::uuid,
       '53000001-0000-0000-0000-000000000005'::uuid,               -- Otto (HM of house-05)
       true,
       current_setting('test.s3.now')::timestamptz) $$,
  'P0001', 'not_authorized',
  'should reject an HM of a different house who is not the on-duty HMOD (not_authorized), row unchanged'
);
SELECT ok(
  (SELECT resolved_at FROM public.notifications WHERE notification_id = '53000005-0000-0000-0000-000000000005') IS NULL,
  'wrong-house-admin reject: A5 stays unresolved (row unchanged)'
);

-- Line 11 — an SM (Sam, SM of quad) is rejected.
SELECT throws_ok(
  $$ SELECT public.set_allied_resolved(
       '53000005-0000-0000-0000-000000000005'::uuid,
       '53000001-0000-0000-0000-000000000003'::uuid,               -- Sam (SM of quad)
       true,
       current_setting('test.s3.now')::timestamptz) $$,
  'P0001', 'not_authorized',
  'should reject an SM (not_authorized)'
);

-- Line 12 — an SW (Wendy) is rejected.
SELECT throws_ok(
  $$ SELECT public.set_allied_resolved(
       '53000005-0000-0000-0000-000000000006'::uuid,
       '53000001-0000-0000-0000-000000000004'::uuid,               -- Wendy (sw)
       true,
       current_setting('test.s3.now')::timestamptz) $$,
  'P0001', 'not_authorized',
  'should reject an SW (not_authorized)'
);

-- ============================================================
-- 13. TYPE GATE + BAD ID (§4a lines 13–14).
-- ============================================================

-- Line 13 — a non-hmod_urgent notification (N7, hm_leave_notice) is not_resolvable;
-- nothing about the row changes.
SELECT throws_ok(
  $$ SELECT public.set_allied_resolved(
       '53000005-0000-0000-0000-000000000007'::uuid,               -- the hm_leave_notice
       '53000001-0000-0000-0000-000000000001'::uuid,               -- Hana (would otherwise be authorized)
       true,
       current_setting('test.s3.now')::timestamptz) $$,
  'P0001', 'not_resolvable',
  'should reject resolving a non-hmod_urgent notification (not_resolvable), row unchanged'
);
SELECT ok(
  (SELECT resolved_at FROM public.notifications WHERE notification_id = '53000005-0000-0000-0000-000000000007') IS NULL,
  'not_resolvable: the non-urgent row is untouched'
);

-- Line 14 — an unknown notification id raises notification_not_found.
SELECT throws_ok(
  $$ SELECT public.set_allied_resolved(
       '53000005-0000-0000-0000-0000000000ff'::uuid,               -- no such notification
       '53000001-0000-0000-0000-000000000001'::uuid,
       true,
       current_setting('test.s3.now')::timestamptz) $$,
  'P0001', 'notification_not_found',
  'should raise notification_not_found for an unknown notification id'
);

-- ============================================================
-- 15. GRANTS — REVOKE from PUBLIC; GRANT to authenticated + service_role (§4a line 15).
-- ============================================================

-- authenticated + service_role hold EXECUTE; PUBLIC does NOT (the revoke landed).
-- has_function_privilege with a non-empty proacl returns true only for explicit grants.
SELECT ok(
  has_function_privilege('authenticated',
    'public.set_allied_resolved(uuid, uuid, boolean, timestamptz)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'public.set_allied_resolved(uuid, uuid, boolean, timestamptz)', 'EXECUTE')
  AND NOT EXISTS (
    -- a PUBLIC grant materializes as a grantee oid of 0 in proacl.
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(p.proacl) AS acl
    WHERE p.oid = 'public.set_allied_resolved(uuid, uuid, boolean, timestamptz)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'should REVOKE set_allied_resolved from PUBLIC and GRANT it to authenticated and service_role'
);

-- ============================================================
-- 16. DECOUPLING — resolved ≠ covered: NO shift_block_assignments row is mutated
--     (§4a line 16). Snapshot a content checksum of the whole table before & after a
--     resolve and assert equality (no row added, removed, or changed — invariant #3).
-- ============================================================

SELECT set_config(
  'test.s3.sba_before',
  (SELECT COALESCE(md5(string_agg(
            assignment_id::text || '|' || COALESCE(user_id::text,'∅') || '|' ||
            status::text || '|' || vacancy_origin::text, ',' ORDER BY assignment_id)), '∅')
   FROM public.shift_block_assignments),
  false
);

-- Re-resolve A1 (a real state change is not required — toggle it off then on so a
-- write definitely happens) and confirm the assignments table is byte-for-byte the same.
SELECT lives_ok(
  $$ SELECT public.set_allied_resolved(
       '53000005-0000-0000-0000-000000000001'::uuid,
       '53000001-0000-0000-0000-000000000001'::uuid,               -- Hana
       false,                                                      -- unresolve
       current_setting('test.s3.now')::timestamptz) $$,
  'decoupling setup: toggling A1 resolved-state succeeds'
);

SELECT is(
  (SELECT COALESCE(md5(string_agg(
            assignment_id::text || '|' || COALESCE(user_id::text,'∅') || '|' ||
            status::text || '|' || vacancy_origin::text, ',' ORDER BY assignment_id)), '∅')
   FROM public.shift_block_assignments),
  current_setting('test.s3.sba_before'),
  'should NOT mutate any shift_block_assignments row when resolving (resolved is not covered)'
);
-- And the specific quad gap the alert is about is STILL a vacant gap.
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '53000003-0000-0000-0000-000000000001'),
  'vacant',
  'decoupling: the quad seat the alert escalated stays vacant (the seat is not filled by resolving)'
);

-- ============================================================
-- 17. MARK-READ REUSE — a non-urgent notification still marks read (§4a line 17).
-- ============================================================

-- N7 (hm_leave_notice, recipient = Hana) → mark_notification_read stamps acknowledged_at.
SELECT is(
  public.mark_notification_read(
    '53000005-0000-0000-0000-000000000007'::uuid,
    '53000001-0000-0000-0000-000000000001'::uuid,                  -- Hana (the recipient)
    current_setting('test.s3.now')::timestamptz),
  true,
  'should still mark a non-urgent notification read via mark_notification_read (acknowledged_at set)'
);
SELECT is(
  (SELECT acknowledged_at FROM public.notifications WHERE notification_id = '53000005-0000-0000-0000-000000000007'),
  current_setting('test.s3.now')::timestamptz,
  'mark-read reuse: acknowledged_at is stamped to the open instant'
);

SELECT * FROM finish();
ROLLBACK;
