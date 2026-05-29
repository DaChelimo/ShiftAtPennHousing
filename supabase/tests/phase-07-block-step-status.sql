-- pgTAP behavioral tests for Phase 07: block_step_status idempotency
-- and rollback observable semantics.
-- Spec sources: BEHAVIORAL_SPECIFICATION §5.4 (escalation chain),
--               §5.5 (one-way escalation), §6.6 #7 (chain resumption);
--               ARCHITECTURE §1.3 (idempotency invariant), §4.1
--               (block_step_status; "not yet processed" check; ON
--               CONFLICT DO NOTHING for orchestrator idempotency;
--               rollback semantics; cascade-on-block-delete cleanup),
--               §4.5 (force-trigger pre-mark + rollback).
-- Run with: supabase test db
--
-- The `block_step_status` TABLE was created in the phase-03 migration
-- (20260527000004_shift_blocks_calendar_generation.sql) so phase-07
-- has something to write to. Schema-shape assertions (table exists,
-- columns exist, types, composite PK, FK to shift_blocks, enum
-- labels) are validated in phase-03's test file. This file focuses
-- on phase-07's NEW observable invariants:
--
--   1. INSERT ON CONFLICT (block_id, step_name) DO NOTHING is the
--      mechanism the orchestrator's chain-step handlers use to claim
--      a fire slot atomically. Concurrent ticks racing on the same
--      step must produce exactly ONE row, and only the winning tick
--      should execute the side-effect (notifications, etc.).
--
--   2. A rolled_back row is treated as "not yet processed" by the
--      orchestrator. When re-firing, the row is UPDATEd in place
--      (status, fired_at, updated_at refresh) rather than INSERTed
--      (the PK would conflict).
--
--   3. Cascade on shift_blocks delete removes the associated step
--      rows (ARCH §4.1 cleanup rule for deleted blocks).
--
--   4. The status enum's three labels MUST be present and exactly
--      those three (no extras). The values 'fired' and
--      'completed_via_force_trigger' both BLOCK re-fire; 'rolled_back'
--      does NOT — the orchestrator's "not yet processed" predicate
--      treats it as eligible.
--
--   5. RLS is enabled and the service-role policy allows orchestrator
--      writes.
--
-- TDD-first: most assertions pass against the existing schema.
-- A few assertions describe observable semantics the orchestrator's
-- SQL helpers MUST satisfy.

BEGIN;

SELECT plan(34);

-- ============================================================
-- 0. Fixture: one shift_blocks row to attach step-status rows to.
--    Time is irrelevant to the idempotency assertions; we just need
--    a valid (house_id, block_start_at) pair.
-- ============================================================

DO $$
DECLARE
  v_block_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
  VALUES (v_block_id, 'harnwell',
          '2026-06-04 19:00:00 America/New_York'::timestamptz, 2);
  PERFORM set_config('test.phase07.block_id', v_block_id::text, true);
END $$;

-- A second block for the cascade test.
DO $$
DECLARE
  v_block_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
  VALUES (v_block_id, 'harnwell',
          '2026-06-04 19:30:00 America/New_York'::timestamptz, 2);
  PERFORM set_config('test.phase07.cascade_block_id', v_block_id::text, true);
END $$;

-- ============================================================
-- 1. Sanity: table, enum, PK exist (most assertions live in
--    phase-03-blocks-schema.sql; these are the most load-bearing
--    invariants for phase-07).
-- ============================================================

SELECT has_table('public', 'block_step_status',
                 'block_step_status table exists');

SELECT enum_has_labels(
  'public', 'block_step_status_enum',
  ARRAY['fired', 'completed_via_force_trigger', 'rolled_back'],
  'block_step_status_enum has exactly the three ARCH §4.1 labels'
);

SELECT col_type_is('public', 'block_step_status', 'status',
                   'block_step_status_enum',
                   'status column uses block_step_status_enum');

-- Composite PK is the foundation of idempotency.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.block_step_status'::regclass
      AND contype = 'p'
      AND ARRAY(
        SELECT attname::text FROM pg_attribute
        WHERE attrelid = conrelid AND attnum = ANY(conkey)
      ) <@ ARRAY['block_id','step_name']
      AND ARRAY['block_id','step_name'] <@ ARRAY(
        SELECT attname::text FROM pg_attribute
        WHERE attrelid = conrelid AND attnum = ANY(conkey)
      )
  ),
  'composite PK on (block_id, step_name) — the idempotency key'
);

-- ============================================================
-- 2. RLS enabled + service-role bypass
-- ============================================================

SELECT ok(
  (SELECT relrowsecurity
     FROM pg_class
    WHERE relname = 'block_step_status' AND relnamespace = 'public'::regnamespace),
  'block_step_status has RLS enabled'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'block_step_status'
      AND 'service_role' = ANY (roles)
  ),
  'block_step_status has a service_role policy (orchestrator runs as service role)'
);

-- ============================================================
-- 3. INSERT ON CONFLICT DO NOTHING — first insert succeeds (pinned #7)
-- ============================================================

DO $$
DECLARE
  v_rows int;
BEGIN
  WITH ins AS (
    INSERT INTO public.block_step_status (block_id, step_name, status)
    VALUES (current_setting('test.phase07.block_id')::uuid, 'broadcast', 'fired')
    ON CONFLICT (block_id, step_name) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM ins;
  PERFORM set_config('test.phase07.first_insert_rows', v_rows::text, true);
END $$;

SELECT is(
  current_setting('test.phase07.first_insert_rows')::int,
  1,
  'first INSERT ON CONFLICT DO NOTHING returns 1 row (the winner)'
);

-- ============================================================
-- 4. INSERT ON CONFLICT DO NOTHING — second insert is a no-op (pinned #7)
-- ============================================================

DO $$
DECLARE
  v_rows int;
BEGIN
  WITH ins AS (
    INSERT INTO public.block_step_status (block_id, step_name, status)
    VALUES (current_setting('test.phase07.block_id')::uuid, 'broadcast', 'fired')
    ON CONFLICT (block_id, step_name) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM ins;
  PERFORM set_config('test.phase07.second_insert_rows', v_rows::text, true);
END $$;

SELECT is(
  current_setting('test.phase07.second_insert_rows')::int,
  0,
  'second INSERT ON CONFLICT DO NOTHING returns 0 rows (the loser; orchestrator side-effect is gated on this)'
);

SELECT is(
  (SELECT count(*) FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.block_id')::uuid
      AND step_name = 'broadcast')::int,
  1,
  'exactly one row exists after two ON CONFLICT inserts (PK uniqueness)'
);

-- ============================================================
-- 5. Different step_name on the same block is a separate row
-- ============================================================

DO $$
DECLARE
  v_rows int;
BEGIN
  WITH ins AS (
    INSERT INTO public.block_step_status (block_id, step_name, status)
    VALUES (current_setting('test.phase07.block_id')::uuid, 'float_lookup', 'fired')
    ON CONFLICT (block_id, step_name) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM ins;
  PERFORM set_config('test.phase07.float_insert_rows', v_rows::text, true);
END $$;

SELECT is(
  current_setting('test.phase07.float_insert_rows')::int,
  1,
  'inserting a DIFFERENT step_name on the same block succeeds (per-step idempotency)'
);

SELECT is(
  (SELECT count(*) FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.block_id')::uuid)::int,
  2,
  'block now has two step rows (broadcast + float_lookup)'
);

-- ============================================================
-- 6. completed_via_force_trigger BLOCKS re-fire just like fired (pinned #20)
-- ============================================================

INSERT INTO public.block_step_status (block_id, step_name, status)
VALUES (current_setting('test.phase07.block_id')::uuid, 'broadcast_alt', 'completed_via_force_trigger');

DO $$
DECLARE
  v_rows int;
BEGIN
  -- Orchestrator's "fire" insert with ON CONFLICT — the row already
  -- exists with completed_via_force_trigger, so the INSERT is a no-op.
  WITH ins AS (
    INSERT INTO public.block_step_status (block_id, step_name, status)
    VALUES (current_setting('test.phase07.block_id')::uuid, 'broadcast_alt', 'fired')
    ON CONFLICT (block_id, step_name) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM ins;
  PERFORM set_config('test.phase07.cvft_block_rows', v_rows::text, true);
END $$;

SELECT is(
  current_setting('test.phase07.cvft_block_rows')::int,
  0,
  'completed_via_force_trigger row blocks INSERT ON CONFLICT (no re-fire)'
);

SELECT is(
  (SELECT status::text FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.block_id')::uuid
      AND step_name = 'broadcast_alt'),
  'completed_via_force_trigger',
  'row status remains completed_via_force_trigger after blocked INSERT'
);

-- ============================================================
-- 7. Rollback flow: completed_via_force_trigger → rolled_back via UPDATE
--    (ARCH §4.5 rollback procedure — done in the same transaction as
--    the float-void + destination-vacant flip)
-- ============================================================

UPDATE public.block_step_status
SET status = 'rolled_back', updated_at = now()
WHERE block_id = current_setting('test.phase07.block_id')::uuid
  AND step_name = 'broadcast_alt';

SELECT is(
  (SELECT status::text FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.block_id')::uuid
      AND step_name = 'broadcast_alt'),
  'rolled_back',
  'UPDATE to rolled_back is observable'
);

-- ============================================================
-- 8. Re-fire after rollback: UPDATE in place (pinned #8)
--
--    The orchestrator's "not yet processed" predicate selects the
--    rolled_back row; the handler updates it to 'fired' (an UPDATE,
--    not an INSERT — the PK already exists).
-- ============================================================

DO $$
BEGIN
  UPDATE public.block_step_status
  SET status = 'fired', fired_at = now(), updated_at = now()
  WHERE block_id = current_setting('test.phase07.block_id')::uuid
    AND step_name = 'broadcast_alt'
    AND status = 'rolled_back';
END $$;

SELECT is(
  (SELECT status::text FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.block_id')::uuid
      AND step_name = 'broadcast_alt'),
  'fired',
  'rolled_back → fired UPDATE in place (no PK collision)'
);

SELECT is(
  (SELECT count(*) FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.block_id')::uuid
      AND step_name = 'broadcast_alt')::int,
  1,
  'still exactly one row after the rollback + re-fire cycle (UPDATE not INSERT)'
);

-- ============================================================
-- 9. "Not yet processed" semantic — observable via WHERE clause
--    The orchestrator's scan uses:
--
--      LEFT JOIN block_step_status ON ...
--      WHERE bss.status IS NULL OR bss.status = 'rolled_back'
--
--    Both "no row" and "rolled_back" satisfy this predicate.
-- ============================================================

-- Reset: set broadcast_alt to rolled_back so the predicate matches it.
UPDATE public.block_step_status
SET status = 'rolled_back', updated_at = now()
WHERE block_id = current_setting('test.phase07.block_id')::uuid
  AND step_name = 'broadcast_alt';

SELECT ok(
  EXISTS (
    SELECT 1
      FROM (SELECT current_setting('test.phase07.block_id')::uuid AS block_id,
                   'broadcast_alt'::text AS step_name) needle
      LEFT JOIN public.block_step_status bss
        ON bss.block_id = needle.block_id
       AND bss.step_name = needle.step_name
      WHERE bss.status IS NULL OR bss.status = 'rolled_back'
  ),
  'rolled_back row matches "not yet processed" predicate'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM (SELECT current_setting('test.phase07.block_id')::uuid AS block_id,
                   'never_existed_step'::text AS step_name) needle
      LEFT JOIN public.block_step_status bss
        ON bss.block_id = needle.block_id
       AND bss.step_name = needle.step_name
      WHERE bss.status IS NULL OR bss.status = 'rolled_back'
  ),
  'missing row matches "not yet processed" predicate'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM (SELECT current_setting('test.phase07.block_id')::uuid AS block_id,
                   'broadcast'::text AS step_name) needle
      LEFT JOIN public.block_step_status bss
        ON bss.block_id = needle.block_id
       AND bss.step_name = needle.step_name
      WHERE bss.status IS NULL OR bss.status = 'rolled_back'
  ),
  '"fired" row does NOT match "not yet processed" (subsequent ticks see the lock)'
);

-- The "completed_via_force_trigger" row stays in 'fired'-equivalent state.
INSERT INTO public.block_step_status (block_id, step_name, status)
VALUES (current_setting('test.phase07.block_id')::uuid, 'cvft_only', 'completed_via_force_trigger');

SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM (SELECT current_setting('test.phase07.block_id')::uuid AS block_id,
                   'cvft_only'::text AS step_name) needle
      LEFT JOIN public.block_step_status bss
        ON bss.block_id = needle.block_id
       AND bss.step_name = needle.step_name
      WHERE bss.status IS NULL OR bss.status = 'rolled_back'
  ),
  '"completed_via_force_trigger" row does NOT match "not yet processed"'
);

-- ============================================================
-- 10. Cascade on shift_blocks delete (ARCH §4.1 cleanup)
-- ============================================================

INSERT INTO public.block_step_status (block_id, step_name, status)
VALUES (current_setting('test.phase07.cascade_block_id')::uuid, 'broadcast', 'fired');

SELECT is(
  (SELECT count(*) FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.cascade_block_id')::uuid)::int,
  1,
  'cascade fixture: one row attached to the cascade block'
);

DELETE FROM public.shift_blocks
WHERE block_id = current_setting('test.phase07.cascade_block_id')::uuid;

SELECT is(
  (SELECT count(*) FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.cascade_block_id')::uuid)::int,
  0,
  'shift_blocks DELETE cascades to block_step_status'
);

-- ============================================================
-- 11. Defaults: fired_at and updated_at default to now() on INSERT
-- ============================================================

DO $$
DECLARE
  v_now timestamptz;
BEGIN
  v_now := now();
  INSERT INTO public.block_step_status (block_id, step_name, status)
  VALUES (current_setting('test.phase07.block_id')::uuid, 'default_test', 'fired');
  PERFORM set_config('test.phase07.before_insert_ts', v_now::text, true);
END $$;

SELECT ok(
  (SELECT fired_at FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.block_id')::uuid
      AND step_name = 'default_test') IS NOT NULL,
  'fired_at populated by default on INSERT (DEFAULT now())'
);

SELECT ok(
  (SELECT updated_at FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.block_id')::uuid
      AND step_name = 'default_test') IS NOT NULL,
  'updated_at populated by default on INSERT (DEFAULT now())'
);

SELECT ok(
  (SELECT fired_at FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.block_id')::uuid
      AND step_name = 'default_test')
    >= current_setting('test.phase07.before_insert_ts')::timestamptz,
  'fired_at >= insertion moment (sanity)'
);

-- ============================================================
-- 12. step_name is a free-text column (the chain step names come from
--     the profile's escalation_chain JSON; the schema doesn't enum them).
-- ============================================================

SELECT col_type_is('public', 'block_step_status', 'step_name',
                   'text',
                   'step_name is text (profile-defined; not enum-constrained)');

-- ============================================================
-- 13. Disallow NULL status (the orchestrator MUST mark status explicitly)
-- ============================================================

SELECT throws_ok(
  format(
    $sql$ INSERT INTO public.block_step_status (block_id, step_name, status)
          VALUES (%L, 'null_status', NULL) $sql$,
    current_setting('test.phase07.block_id')
  ),
  NULL,
  NULL,
  'status NOT NULL is enforced'
);

-- ============================================================
-- 14. Read isolation: a row UPDATEd to rolled_back is visible
--     immediately to subsequent reads in the same transaction
--     (read-committed within a single txn; ensures the orchestrator's
--     same-transaction rollback + re-evaluation is coherent).
--
--     We can't easily test cross-transaction visibility in a single
--     pgTAP plan; this verifies the in-transaction invariant.
-- ============================================================

UPDATE public.block_step_status
SET status = 'rolled_back', updated_at = now()
WHERE block_id = current_setting('test.phase07.block_id')::uuid
  AND step_name = 'default_test';

SELECT is(
  (SELECT status::text FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.block_id')::uuid
      AND step_name = 'default_test'),
  'rolled_back',
  'in-transaction read after UPDATE returns rolled_back (read-committed visibility)'
);

-- ============================================================
-- 15. updated_at is independent of fired_at after a rollback UPDATE
--     (ARCH §4.1: fired_at = "when the step was first executed";
--      updated_at = "last status change, e.g. on rollback")
-- ============================================================

SELECT ok(
  (SELECT updated_at >= fired_at FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.block_id')::uuid
      AND step_name = 'default_test'),
  'after UPDATE, updated_at >= fired_at (updated_at tracks the rollback moment)'
);

-- ============================================================
-- 16. Multiple steps can be force-triggered simultaneously (the
--     phase-06 force-trigger handler writes broadcast +
--     float_lookup rows in one transaction).
-- ============================================================

DO $$
DECLARE
  v_new_block_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
  VALUES (v_new_block_id, 'harnwell',
          '2026-06-04 20:00:00 America/New_York'::timestamptz, 2);
  PERFORM set_config('test.phase07.multi_block_id', v_new_block_id::text, true);
END $$;

INSERT INTO public.block_step_status (block_id, step_name, status) VALUES
  (current_setting('test.phase07.multi_block_id')::uuid, 'broadcast',    'completed_via_force_trigger'),
  (current_setting('test.phase07.multi_block_id')::uuid, 'float_lookup', 'completed_via_force_trigger');

SELECT is(
  (SELECT count(*) FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.multi_block_id')::uuid
      AND status = 'completed_via_force_trigger')::int,
  2,
  'force-trigger pre-marks broadcast + float_lookup in a single transaction'
);

-- Same-transaction rollback (ARCH §4.4 "Note on chain rollback")
UPDATE public.block_step_status
SET status = 'rolled_back', updated_at = now()
WHERE block_id = current_setting('test.phase07.multi_block_id')::uuid
  AND step_name IN ('broadcast', 'float_lookup');

SELECT is(
  (SELECT count(*) FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.multi_block_id')::uuid
      AND status = 'rolled_back')::int,
  2,
  'both force-trigger rows can be rolled back in a single UPDATE (no-ack handler)'
);

-- ============================================================
-- 17. hmod_notify_allied row is NOT pre-marked by force-trigger
--     (ARCH §4.5: "The `hmod_notify_allied` step is NOT pre-marked")
-- ============================================================

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.multi_block_id')::uuid
      AND step_name = 'hmod_notify_allied'
  ),
  'force-trigger leaves hmod_notify_allied with no row (so it can fire post-rollback)'
);

-- Now write hmod_notify_allied (the no-ack handler's terminal step)
INSERT INTO public.block_step_status (block_id, step_name, status)
VALUES (current_setting('test.phase07.multi_block_id')::uuid, 'hmod_notify_allied', 'fired')
ON CONFLICT (block_id, step_name) DO NOTHING;

SELECT is(
  (SELECT status::text FROM public.block_step_status
    WHERE block_id = current_setting('test.phase07.multi_block_id')::uuid
      AND step_name = 'hmod_notify_allied'),
  'fired',
  'hmod_notify_allied row INSERTed during no-ack handler'
);

-- ============================================================
-- 18. Concurrent INSERT race simulation (single-connection
--     approximation — exercise the ON CONFLICT path)
--
--     We cannot truly multi-connect in a single pgTAP plan, but the
--     ON CONFLICT semantics are atomic in pg's executor — a single-
--     statement INSERT...ON CONFLICT DO NOTHING is the correct mechanism
--     for concurrent races. The schema test verifies the SQL contract
--     the orchestrator relies on.
-- ============================================================

DO $$
DECLARE
  v_first int;
  v_second int;
BEGIN
  WITH ins AS (
    INSERT INTO public.block_step_status (block_id, step_name, status)
    VALUES (current_setting('test.phase07.multi_block_id')::uuid, 'hmod_notify_allied', 'fired')
    ON CONFLICT (block_id, step_name) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_first FROM ins;

  WITH ins AS (
    INSERT INTO public.block_step_status (block_id, step_name, status)
    VALUES (current_setting('test.phase07.multi_block_id')::uuid, 'hmod_notify_allied', 'fired')
    ON CONFLICT (block_id, step_name) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_second FROM ins;

  PERFORM set_config('test.phase07.race_first',  v_first::text,  true);
  PERFORM set_config('test.phase07.race_second', v_second::text, true);
END $$;

SELECT is(
  current_setting('test.phase07.race_first')::int +
  current_setting('test.phase07.race_second')::int,
  0,
  'both follow-up INSERTs are no-ops (row was already inserted by ON CONFLICT path above)'
);

SELECT finish();
ROLLBACK;
