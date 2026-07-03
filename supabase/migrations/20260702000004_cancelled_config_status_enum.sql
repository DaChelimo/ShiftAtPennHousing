-- Migration: cancelled_config shift status — enum value (P3, part 1 of 2).
--
-- When the admin applies an operating-season change that CLOSES a house (or its
-- desk hours) on future dates, the reconciler (apply_compiled_season, migration
-- 20260702000006) voids the affected blocks (shift_blocks.voided_at) and moves any
-- OCCUPIED assignment rows to this terminal status. `cancelled_config` is distinct
-- from `vacant` so the worker's "My Shifts" view can show a cancellation (not a
-- silently-freed seat) and history is preserved (rows are never deleted).
--
-- It is deliberately NOT an "occupied" status: the headcount trigger
-- (enforce_block_occupied_headcount) ignores it, and the coverage/present-worker
-- predicates never count it. Added on its own so the value is committed before the
-- reconciler RPC (a later migration = a later transaction) references it — same
-- rule as the rsm/admin role enum adds.

ALTER TYPE shift_status_enum ADD VALUE IF NOT EXISTS 'cancelled_config';

-- rollback: enum values cannot be dropped without recreating the type (out of
-- scope for an automated down-migration).
