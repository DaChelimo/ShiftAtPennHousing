-- pgTAP behavioral tests for Phase 02: Users and Roles
-- Spec sources: BEHAVIORAL_SPECIFICATION §2; ARCHITECTURE §3.1
-- Run with: supabase test db
--
-- These tests describe behavior the phase-02 migrations MUST satisfy.
-- They are TDD-first: written before any phase-02 migration exists.
-- The implementation is free to use CHECK constraints, triggers, or
-- exclusion constraints — the tests assert observable behavior only.

BEGIN;

SELECT plan(67);

-- ============================================================
-- Setup: seed an auth.users row and a couple houses for FK targets.
-- The houses already exist via phase-01 seed; we only need auth users
-- here since auth.users is the supabase-managed table phase-02 keys to.
-- ============================================================

-- Insert two fake auth users we can reference. We bypass the supabase
-- auth helpers and write directly to auth.users — only the id column
-- is load-bearing for the FK relationship under test.
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sw-alice@test.local'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hm-bob@test.local'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sm-carol@test.local'),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bm-dan@test.local'),
  ('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fired-erin@test.local')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 1. Schema existence: users + user_roles tables and the role enum
-- ============================================================

SELECT has_table('public', 'users',      'users table exists');
SELECT has_table('public', 'user_roles', 'user_roles table exists');
SELECT has_type ('public', 'user_role_enum', 'user_role_enum type exists');

-- enum values cover all roles from §2.1–2.3a (rsm sits between hm and bm)
SELECT enum_has_labels(
  'public', 'user_role_enum',
  ARRAY['sw', 'sm', 'hm', 'rsm', 'bm'],
  'user_role_enum has labels sw, sm, hm, rsm, bm'
);

-- ============================================================
-- 2. users column shape (ARCHITECTURE §3.1)
-- ============================================================

SELECT has_column('public', 'users', 'user_id',              'users.user_id exists');
SELECT has_column('public', 'users', 'name',                 'users.name exists');
SELECT has_column('public', 'users', 'email',                'users.email exists');
SELECT has_column('public', 'users', 'phone',                'users.phone exists');
SELECT has_column('public', 'users', 'home_house_id',        'users.home_house_id exists');
SELECT has_column('public', 'users', 'is_active',            'users.is_active exists');
SELECT has_column('public', 'users', 'broadcast_subscribed', 'users.broadcast_subscribed exists');

SELECT col_type_is('public', 'users', 'user_id',              'uuid',    'user_id is uuid (FK to auth.users)');
SELECT col_type_is('public', 'users', 'is_active',            'boolean', 'is_active is boolean');
SELECT col_type_is('public', 'users', 'broadcast_subscribed', 'boolean', 'broadcast_subscribed is boolean');

SELECT col_is_pk      ('public', 'users', 'user_id', 'user_id is the primary key');
SELECT col_not_null   ('public', 'users', 'is_active',            'is_active is NOT NULL');
SELECT col_not_null   ('public', 'users', 'broadcast_subscribed', 'broadcast_subscribed is NOT NULL');
SELECT col_default_is ('public', 'users', 'is_active',            'true',  'is_active defaults to true');
SELECT col_default_is ('public', 'users', 'broadcast_subscribed', 'false', 'broadcast_subscribed defaults to false');

-- ============================================================
-- 3. user_roles column shape and uniqueness
-- ============================================================

SELECT has_column('public', 'user_roles', 'user_id',        'user_roles.user_id exists');
SELECT has_column('public', 'user_roles', 'role',           'user_roles.role exists');
SELECT has_column('public', 'user_roles', 'scope_house_id', 'user_roles.scope_house_id exists');

SELECT col_type_is('public', 'user_roles', 'role', 'user_role_enum', 'user_roles.role uses user_role_enum');
SELECT col_not_null('public', 'user_roles', 'user_id', 'user_roles.user_id is NOT NULL');
SELECT col_not_null('public', 'user_roles', 'role',    'user_roles.role is NOT NULL');

-- A user may hold multiple roles but never the same (role, scope_house_id) twice.
-- AMBIGUOUS: spec does not pin the unique-key columns; this is the most defensible
-- interpretation (BEHAVIORAL §2.7 — union of distinct roles).
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_roles'::regclass
      AND contype IN ('u','p')
      AND ARRAY(
        SELECT attname::text FROM pg_attribute
        WHERE attrelid = conrelid AND attnum = ANY(conkey)
        ORDER BY array_position(conkey, attnum)
      ) <@ ARRAY['user_id','role','scope_house_id']
      AND ARRAY['user_id','role','scope_house_id'] <@ ARRAY(
        SELECT attname::text FROM pg_attribute
        WHERE attrelid = conrelid AND attnum = ANY(conkey)
      )
  ),
  'user_roles has unique/PK over (user_id, role, scope_house_id)'
);

-- ============================================================
-- 4. Foreign keys
-- ============================================================

-- users.user_id → auth.users(id)
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND contype = 'f'
      AND confrelid = 'auth.users'::regclass
  ),
  'users.user_id has FK to auth.users'
);

-- users.home_house_id → houses(id)
SELECT fk_ok('public', 'users', 'home_house_id', 'public', 'houses', 'id',
             'users.home_house_id FK to houses(id)');

-- user_roles.user_id → users(user_id)
SELECT fk_ok('public', 'user_roles', 'user_id', 'public', 'users', 'user_id',
             'user_roles.user_id FK to users(user_id)');

-- user_roles.scope_house_id → houses(id)
SELECT fk_ok('public', 'user_roles', 'scope_house_id', 'public', 'houses', 'id',
             'user_roles.scope_house_id FK to houses(id)');

-- hm_leave.user_id → users (added in phase-2 per phase-01 migration note)
SELECT fk_ok('public', 'hm_leave', 'user_id', 'public', 'users', 'user_id',
             'hm_leave.user_id FK to users(user_id) (added in phase-02)');

-- hm_leave.replacement_user_id → users
SELECT fk_ok('public', 'hm_leave', 'replacement_user_id', 'public', 'users', 'user_id',
             'hm_leave.replacement_user_id FK to users(user_id)');

-- ack_cadence_config.modified_by → users (deferred reference from phase-01)
SELECT fk_ok('public', 'ack_cadence_config', 'modified_by', 'public', 'users', 'user_id',
             'ack_cadence_config.modified_by FK to users(user_id)');

-- weekly_cap_overrides.modified_by → users
SELECT fk_ok('public', 'weekly_cap_overrides', 'modified_by', 'public', 'users', 'user_id',
             'weekly_cap_overrides.modified_by FK to users(user_id)');

-- ============================================================
-- 5. RLS enabled (service-role bypass at minimum; user policies later)
-- ============================================================

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.users'::regclass),
  'users has RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_roles'::regclass),
  'user_roles has RLS enabled'
);

-- ============================================================
-- 6. scope_house_id rule: required for sm/hm/bm, nullable for sw
-- ARCHITECTURE §3.1 says "for sm/hm/bm, the house their role covers"
-- AMBIGUOUS: enforcement mechanism (CHECK vs trigger) not specified.
-- We assert behavior, not mechanism.
-- ============================================================

-- Seed one users row (will be cleaned up at ROLLBACK).
INSERT INTO public.users (user_id, name, email, home_house_id, is_active, broadcast_subscribed)
VALUES ('11111111-1111-1111-1111-111111111111', 'Alice SW', 'sw-alice@test.local', 'harnwell', true, false);

-- sw role with NULL scope is allowed (SW is house-agnostic per §2.1)
SELECT lives_ok(
  $$ INSERT INTO public.user_roles (user_id, role, scope_house_id)
     VALUES ('11111111-1111-1111-1111-111111111111', 'sw', NULL) $$,
  'sw role can be inserted with NULL scope_house_id'
);

-- sm without scope is rejected
SELECT throws_ok(
  $$ INSERT INTO public.user_roles (user_id, role, scope_house_id)
     VALUES ('11111111-1111-1111-1111-111111111111', 'sm', NULL) $$,
  NULL,
  NULL,
  'sm role requires non-NULL scope_house_id'
);

-- hm without scope is rejected
SELECT throws_ok(
  $$ INSERT INTO public.user_roles (user_id, role, scope_house_id)
     VALUES ('11111111-1111-1111-1111-111111111111', 'hm', NULL) $$,
  NULL,
  NULL,
  'hm role requires non-NULL scope_house_id'
);

-- bm without scope is rejected
SELECT throws_ok(
  $$ INSERT INTO public.user_roles (user_id, role, scope_house_id)
     VALUES ('11111111-1111-1111-1111-111111111111', 'bm', NULL) $$,
  NULL,
  NULL,
  'bm role requires non-NULL scope_house_id'
);

-- ============================================================
-- 7. Multiple roles: a user can hold sw + sm simultaneously
-- BEHAVIORAL §2.7 — union of roles
-- ============================================================

SELECT lives_ok(
  $$ INSERT INTO public.user_roles (user_id, role, scope_house_id)
     VALUES ('11111111-1111-1111-1111-111111111111', 'sm', 'harnwell') $$,
  'user can hold sw + sm roles concurrently'
);

-- ============================================================
-- 8. Broadcast subscription guard (ARCHITECTURE §3.1)
-- A user holding hm or bm role cannot have broadcast_subscribed=true.
-- ============================================================

-- Seed an HM user (broadcast_subscribed defaults to false).
INSERT INTO public.users (user_id, name, email, home_house_id)
VALUES ('22222222-2222-2222-2222-222222222222', 'Bob HM', 'hm-bob@test.local', 'harnwell');
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('22222222-2222-2222-2222-222222222222', 'hm', 'harnwell');

-- Attempting to flip broadcast_subscribed=true on an HM must be rejected.
SELECT throws_ok(
  $$ UPDATE public.users SET broadcast_subscribed = true
     WHERE user_id = '22222222-2222-2222-2222-222222222222' $$,
  NULL,
  NULL,
  'cannot set broadcast_subscribed=true for a user holding the hm role'
);

-- Seed a BM user and repeat the assertion.
INSERT INTO public.users (user_id, name, email, home_house_id)
VALUES ('44444444-4444-4444-4444-444444444444', 'Dan BM', 'bm-dan@test.local', 'quad');
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('44444444-4444-4444-4444-444444444444', 'bm', 'quad');

SELECT throws_ok(
  $$ UPDATE public.users SET broadcast_subscribed = true
     WHERE user_id = '44444444-4444-4444-4444-444444444444' $$,
  NULL,
  NULL,
  'cannot set broadcast_subscribed=true for a user holding the bm role'
);

-- A pure SW/SM may toggle broadcast_subscribed=true freely.
SELECT lives_ok(
  $$ UPDATE public.users SET broadcast_subscribed = true
     WHERE user_id = '11111111-1111-1111-1111-111111111111' $$,
  'pure SW+SM user can set broadcast_subscribed=true'
);
SELECT is(
  (SELECT broadcast_subscribed FROM public.users WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  true,
  'broadcast_subscribed flip on SW+SM persists'
);

-- Inserting an HM/BM role for a user with broadcast_subscribed=true must
-- not leave the system in an inconsistent state. The implementation may
-- either reject the role insert or atomically flip broadcast_subscribed
-- to false — but the post-condition (no HM/BM with broadcast=true) holds.
-- See §9 for the promotion-hook tests that pin the spec-mandated behavior.

-- ============================================================
-- 8b. BM is exclusive of worker roles sw/sm (ARCHITECTURE §3.1, decision 6B)
-- The schema rejects the combination in BOTH directions:
--   - inserting bm for a user who holds sw or sm
--   - inserting sw or sm for a user who holds bm
-- BM may still coexist with hm (ARCH §3.1: "they may still hold the bm role
-- alongside hm or other admin roles"). HM does NOT trigger this exclusion;
-- hm + sw is a legitimate combination (an HM who also works shifts).
-- ============================================================

-- Direction 1: worker → BM user (Dan holds bm/quad).
SELECT throws_ok(
  $$ INSERT INTO public.user_roles (user_id, role, scope_house_id)
     VALUES ('44444444-4444-4444-4444-444444444444', 'sw', NULL) $$,
  NULL,
  NULL,
  'inserting sw role for a user who already holds bm is rejected'
);

SELECT throws_ok(
  $$ INSERT INTO public.user_roles (user_id, role, scope_house_id)
     VALUES ('44444444-4444-4444-4444-444444444444', 'sm', 'quad') $$,
  NULL,
  NULL,
  'inserting sm role for a user who already holds bm is rejected'
);

-- Direction 2: BM → worker user (Alice holds sw + sm/harnwell).
SELECT throws_ok(
  $$ INSERT INTO public.user_roles (user_id, role, scope_house_id)
     VALUES ('11111111-1111-1111-1111-111111111111', 'bm', 'harnwell') $$,
  NULL,
  NULL,
  'inserting bm role for a user who already holds sw/sm is rejected'
);

-- Sanity: HM does NOT trigger the exclusion. Bob holds hm/harnwell;
-- adding sw to him must succeed (HMs may work shifts per BEH §2.3).
SELECT lives_ok(
  $$ INSERT INTO public.user_roles (user_id, role, scope_house_id)
     VALUES ('22222222-2222-2222-2222-222222222222', 'sw', NULL) $$,
  'inserting sw role for an HM user succeeds (hm does not block worker roles)'
);

-- Clean up the sanity insert so it doesn't pollute later counts.
DELETE FROM public.user_roles
WHERE user_id = '22222222-2222-2222-2222-222222222222'
  AND role = 'sw';

-- ============================================================
-- 9. Role promotion hook (ARCHITECTURE §3.1 — "Role promotion hook")
-- INSERT of hm/bm into user_roles atomically sets broadcast_subscribed=false.
-- Carol is an SM with broadcast_subscribed=true.
-- ============================================================

INSERT INTO public.users (user_id, name, email, home_house_id, broadcast_subscribed)
VALUES ('33333333-3333-3333-3333-333333333333', 'Carol SM', 'sm-carol@test.local', 'harnwell', true);
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('33333333-3333-3333-3333-333333333333', 'sm', 'harnwell');

SELECT is(
  (SELECT broadcast_subscribed FROM public.users WHERE user_id = '33333333-3333-3333-3333-333333333333'),
  true,
  'pre-promotion: Carol (SM) has broadcast_subscribed=true'
);

-- Promote Carol to HM. Per the spec, the same transaction MUST flip
-- broadcast_subscribed to false. The role insert itself must succeed.
SELECT lives_ok(
  $$ INSERT INTO public.user_roles (user_id, role, scope_house_id)
     VALUES ('33333333-3333-3333-3333-333333333333', 'hm', 'harnwell') $$,
  'promotion: inserting hm role for a subscribed SM succeeds'
);

SELECT is(
  (SELECT broadcast_subscribed FROM public.users WHERE user_id = '33333333-3333-3333-3333-333333333333'),
  false,
  'promotion hook: hm role insert atomically set broadcast_subscribed=false'
);

-- BM promotion. Because §8b enforces BM/worker-role exclusion symmetrically,
-- a caller cannot promote an SM directly to BM — the sm row must be dropped
-- first. We verify both halves: direct promotion is rejected, two-step
-- promotion succeeds and triggers the broadcast cleanup hook.
INSERT INTO public.users (user_id, name, email, home_house_id, broadcast_subscribed)
VALUES ('55555555-5555-5555-5555-555555555555', 'Erin SM', 'erin-sm@test.local', 'quad', true);
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('55555555-5555-5555-5555-555555555555', 'sm', 'quad');

SELECT throws_ok(
  $$ INSERT INTO public.user_roles (user_id, role, scope_house_id)
     VALUES ('55555555-5555-5555-5555-555555555555', 'bm', 'quad') $$,
  NULL,
  NULL,
  'direct bm promotion of an sm user is rejected (§8b symmetric exclusion)'
);

-- Two-step: drop worker role, then insert bm.
DELETE FROM public.user_roles
WHERE user_id = '55555555-5555-5555-5555-555555555555'
  AND role = 'sm';

SELECT lives_ok(
  $$ INSERT INTO public.user_roles (user_id, role, scope_house_id)
     VALUES ('55555555-5555-5555-5555-555555555555', 'bm', 'quad') $$,
  'two-step bm promotion (after sm removed) succeeds'
);
SELECT is(
  (SELECT broadcast_subscribed FROM public.users WHERE user_id = '55555555-5555-5555-5555-555555555555'),
  false,
  'promotion hook: bm role insert atomically set broadcast_subscribed=false'
);

-- Post-condition invariant: no HM or BM in the system has broadcast=true.
SELECT is(
  (SELECT count(*)::int FROM public.users u
     JOIN public.user_roles r USING (user_id)
    WHERE u.broadcast_subscribed = true
      AND r.role IN ('hm','bm')),
  0,
  'invariant: zero HM/BM users have broadcast_subscribed=true'
);

-- ============================================================
-- 10. is_active default + firing flow
-- ============================================================

-- Default = true (already covered by col_default_is above, re-checked behaviorally).
INSERT INTO public.users (user_id, name, email, home_house_id)
VALUES ('66666666-6666-6666-6666-666666666666', 'Frank SW', 'frank@test.local', 'house-03');
SELECT is(
  (SELECT is_active FROM public.users WHERE user_id = '66666666-6666-6666-6666-666666666666'),
  true,
  'new user defaults to is_active=true'
);

-- Firing flips is_active to false. This is a direct UPDATE per spec —
-- no separate "fire" endpoint asserted at the schema level.
UPDATE public.users SET is_active = false
WHERE user_id = '66666666-6666-6666-6666-666666666666';
SELECT is(
  (SELECT is_active FROM public.users WHERE user_id = '66666666-6666-6666-6666-666666666666'),
  false,
  'firing: setting is_active=false persists'
);

-- ============================================================
-- 11. hm_leave.replacement_user_id rejects an inactive user
-- (Edge case from prompt: "can't designate a fired person as replacement")
-- AMBIGUOUS: spec §2.6 implies this but does not explicitly say "at the
-- DB layer". Implementation may enforce via trigger; we test behavior.
-- ============================================================

-- Set up a valid HM going on leave (Bob, active).
-- Set up Frank as the candidate replacement (currently inactive from §10 above).
SELECT throws_ok(
  $$ INSERT INTO public.hm_leave (user_id, start_date, end_date, replacement_user_id)
     VALUES (
       '22222222-2222-2222-2222-222222222222',
       '2026-06-01', '2026-06-07',
       '66666666-6666-6666-6666-666666666666'
     ) $$,
  NULL,
  NULL,
  'hm_leave rejects replacement_user_id pointing to an inactive user'
);

-- An active replacement is accepted (Dan, BM, is_active=true by default).
SELECT lives_ok(
  $$ INSERT INTO public.hm_leave (user_id, start_date, end_date, replacement_user_id)
     VALUES (
       '22222222-2222-2222-2222-222222222222',
       '2026-06-01', '2026-06-07',
       '44444444-4444-4444-4444-444444444444'
     ) $$,
  'hm_leave accepts replacement_user_id pointing to an active user'
);

-- NULL replacement is allowed (project administrator is the terminal default per §2.6).
SELECT lives_ok(
  $$ INSERT INTO public.hm_leave (user_id, start_date, end_date, replacement_user_id)
     VALUES (
       '22222222-2222-2222-2222-222222222222',
       '2026-07-01', '2026-07-03',
       NULL
     ) $$,
  'hm_leave accepts NULL replacement_user_id (terminal = project administrator)'
);

-- ============================================================
-- 12. Firing a user does not cascade-delete their user_roles
-- (Historical-row preservation; phase-03 shift_block_assignments
-- will assert the same property at that layer.)
-- ============================================================

-- Frank had no roles inserted; insert one now while inactive should still
-- be allowed at the schema level (firing flips is_active, doesn't bar writes).
-- Actually: per §3.1, no NEW operation may *select* a deactivated user.
-- The schema doesn't prevent writes; the application layer does.
-- What we DO assert: existing user_roles rows for the fired user remain.
-- (sm, quad) is a valid third role for Frank (sw must have NULL scope per
-- the F-02-009 invariant); the point of this row is only to verify it
-- survives a later firing.
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'sm', 'quad');

UPDATE public.users SET is_active = false
WHERE user_id = '11111111-1111-1111-1111-111111111111';

SELECT is(
  (SELECT count(*)::int FROM public.user_roles
    WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  3,
  'firing a user preserves their existing user_roles rows (sw NULL + sm harnwell + sw quad)'
);

-- ============================================================
-- 13. broadcast_subscribed guard survives the round-trip:
-- a fresh attempt to flip-true on a still-HM user is rejected after firing.
-- (Inactive HMs are still HMs at the role level.)
-- ============================================================

SELECT throws_ok(
  $$ UPDATE public.users SET broadcast_subscribed = true, is_active = true
     WHERE user_id = '22222222-2222-2222-2222-222222222222' $$,
  NULL,
  NULL,
  'broadcast_subscribed guard still rejects HM even when toggled with reactivation'
);

-- ============================================================
-- 14. home_house_id immutability (ARCHITECTURE §3.1)
-- The schema enforces "immutable except by admin override" via a trigger
-- gated on auth.role() = 'service_role'. Non-admin UPDATEs must be rejected.
-- ============================================================

-- Reactivate Bob so we can UPDATE him cleanly (he was deactivated nowhere yet,
-- but make the precondition explicit and reset his JWT claim to empty).
SELECT set_config('request.jwt.claims', '', true);

-- Direction 1: non-admin context (no JWT, auth.role() = NULL) cannot change
-- home_house_id.
SELECT throws_ok(
  $$ UPDATE public.users SET home_house_id = 'quad'
     WHERE user_id = '22222222-2222-2222-2222-222222222222' $$,
  NULL,
  NULL,
  'home_house_id UPDATE is rejected when auth.role() is not service_role'
);

-- Touching other columns without changing home_house_id is unaffected.
SELECT lives_ok(
  $$ UPDATE public.users SET phone = '215-555-0100'
     WHERE user_id = '22222222-2222-2222-2222-222222222222' $$,
  'UPDATEs that do not change home_house_id are unaffected by the trigger'
);

-- Direction 2: with a service_role JWT claim, the admin override is allowed.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT lives_ok(
  $$ UPDATE public.users SET home_house_id = 'quad'
     WHERE user_id = '22222222-2222-2222-2222-222222222222' $$,
  'home_house_id UPDATE succeeds under service_role admin override'
);

SELECT is(
  (SELECT home_house_id FROM public.users WHERE user_id = '22222222-2222-2222-2222-222222222222'),
  'quad',
  'home_house_id admin override persists the new value'
);

-- Reset JWT claim so any later assertions run in the default context.
SELECT set_config('request.jwt.claims', '', true);

SELECT finish();
ROLLBACK;
