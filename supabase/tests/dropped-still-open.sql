-- pgTAP: worker_my_shifts.dropped_still_open (parity T2-1).
-- Verifies the read model now derives the dropper→vacant-row link persisted by
-- drop_shift (migration 20260611000001):
--   * after worker W temporarily drops a block, worker_my_shifts(W) shows it with
--     dropped_still_open=true;
--   * after the block is re-claimed by anyone, it NO LONGER appears for W;
--   * a different worker with NO home-house/admin access never sees W's dropped row
--     (the new dropped-by clause does not leak it — RLS isolation).
-- Honors block atomicity (#5: one 30-min block) and timezone (#6: timestamptz).
-- Self-contained inside BEGIN…ROLLBACK; uses the real drop_shift / claim_open_shift
-- RPCs so the actual write paths are exercised.
--
-- House choice: a QUAD block — W (quad) drops it and C (quad) re-claims it (a
-- harnwell block could not be claimed by a non-harnwell isolation actor, and a
-- same-home-house actor would see it via the unrelated home-house SELECT policy,
-- masking the dropped-by clause). The isolation actor X is home lower-quad, with no
-- home-house match and no admin role over quad, so ONLY the dropped-by clause
-- could expose W's row to X — and it must not.
BEGIN;
SELECT plan(8);

-- ---- Actors: W (quad dropper), C (quad reclaimer), X (lower-quad, isolation). ----
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated', v.email,
  'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', ''
FROM (VALUES
  ('d0000000-0000-4000-8000-000000000001','dso.w@example.test'),
  ('d0000000-0000-4000-8000-000000000002','dso.c@example.test'),
  ('d0000000-0000-4000-8000-000000000003','dso.x@example.test')
) AS v(id, email);

INSERT INTO users (user_id, name, email, home_house_id, is_active) VALUES
  ('d0000000-0000-4000-8000-000000000001','DSO W','dso.w@example.test','quad',true),
  ('d0000000-0000-4000-8000-000000000002','DSO C','dso.c@example.test','quad',true),
  ('d0000000-0000-4000-8000-000000000003','DSO X','dso.x@example.test','lower-quad',true);

INSERT INTO user_roles (user_id, role, scope_house_id) VALUES
  ('d0000000-0000-4000-8000-000000000001','sw',NULL),
  ('d0000000-0000-4000-8000-000000000002','sw',NULL),
  ('d0000000-0000-4000-8000-000000000003','sw',NULL);

-- ---- One future quad block (well past T-2h), W scheduled on it. ----
INSERT INTO shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('d0000000-0000-4000-9000-000000000001','quad','2026-08-01 20:00:00-04',1);

INSERT INTO shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin, is_float, is_cross_house_pickup, source_house_id) VALUES
  ('d0000000-0000-4000-a000-000000000001','d0000000-0000-4000-9000-000000000001','d0000000-0000-4000-8000-000000000001','scheduled','none',false,false,NULL);

-- Baseline: before any drop, W sees it as a normal scheduled shift.
SELECT is((SELECT kind FROM worker_my_shifts WHERE id='d0000000-0000-4000-a000-000000000001'),
          'scheduled', 'baseline: scheduled shift visible to W');
SELECT ok((SELECT dropped_still_open = false FROM worker_my_shifts WHERE id='d0000000-0000-4000-a000-000000000001'),
          'baseline: dropped_still_open=false for an active scheduled shift');

-- ===== W temporarily drops the block =====
SELECT lives_ok(
  $$ SELECT drop_shift(ARRAY['d0000000-0000-4000-a000-000000000001']::uuid[],
                       'd0000000-0000-4000-8000-000000000001'::uuid) $$,
  'drop_shift succeeds for the owning worker');

-- The row is now vacant + temporary_drop + dropped_by W (schema persistence).
SELECT ok(
  (SELECT status='vacant' AND vacancy_origin='temporary_drop'
          AND dropped_by_user_id='d0000000-0000-4000-8000-000000000001' AND dropped_at IS NOT NULL
     FROM shift_block_assignments WHERE assignment_id='d0000000-0000-4000-a000-000000000001'),
  'drop_shift persists dropped_by_user_id + dropped_at on the temporary-drop row');

-- worker_my_shifts(W) now shows the block as dropped_still_open=true.
SELECT ok(
  (SELECT dropped_still_open = true
     FROM worker_my_shifts
    WHERE id='d0000000-0000-4000-a000-000000000001'
      AND user_id='d0000000-0000-4000-8000-000000000001'),
  'after drop: W sees the block with dropped_still_open=true');

-- ===== RLS isolation: worker X (lower-quad, no quad access) never sees W's row =====
-- Probe worker_my_shifts as the `authenticated` role with X's simulated auth.uid().
DO $$
DECLARE v int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"d0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO v
    FROM worker_my_shifts WHERE id='d0000000-0000-4000-a000-000000000001';
  RESET ROLE;
  PERFORM set_config('test.dso.x_sees', v::text, true);
END $$;
SELECT is(current_setting('test.dso.x_sees')::int, 0,
          'RLS: an unrelated worker (X) does NOT see W''s dropped vacant row');

-- ===== Re-claim by anyone removes dropped_still_open for W =====
-- C claims the open block via the real RPC (status→claimed, vacancy_origin→none).
SELECT lives_ok(
  $$ SELECT claim_open_shift('d0000000-0000-4000-a000-000000000001'::uuid,
                             'd0000000-0000-4000-8000-000000000002'::uuid,
                             '2026-08-01 00:00:00-04'::timestamptz) $$,
  'claim_open_shift re-fills the dropped block (C claims it)');

-- W no longer sees it as dropped_still_open (the row is no longer vacant).
SELECT ok(
  NOT EXISTS(
    SELECT 1 FROM worker_my_shifts
     WHERE id='d0000000-0000-4000-a000-000000000001'
       AND user_id='d0000000-0000-4000-8000-000000000001'
       AND dropped_still_open = true),
  'after re-claim: the block is no longer dropped_still_open for W');

SELECT finish();
ROLLBACK;
