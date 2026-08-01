-- Add the `shift_opened` notification type.
--
-- Deliberately alone in its own migration, for the same reason as
-- 20260728000002: `ALTER TYPE ... ADD VALUE` may run inside a transaction on
-- PG12+, but the new label cannot be USED in that same transaction, and
-- 20260729000013 both defines and exercises functions that reference it. Each
-- migration file is its own transaction, so splitting them is what makes the
-- next one safe.
--
-- WHY A NEW TYPE RATHER THAN REUSING `broadcast` (decided 2026-07-29): the two
-- now coexist and mean different things to the worker.
--
--   `shift_opened` — "someone just gave up a shift." Fires the instant the seat
--                    is vacated, at any distance from the shift.
--   `broadcast`    — "this seat is still uncovered with 3 hours to go." Fires
--                    from the escalation chain, only when the desk would
--                    otherwise be EMPTY.
--
-- Keeping them as one type would make them indistinguishable in the Updates
-- feed and would force one set of copy onto two different moments.

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'shift_opened';

-- rollback: none. Postgres cannot remove an enum label without recreating the type.
