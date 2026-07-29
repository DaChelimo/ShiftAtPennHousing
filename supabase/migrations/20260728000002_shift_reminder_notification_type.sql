-- Add the `shift_reminder` notification type.
--
-- Deliberately alone in its own migration. `ALTER TYPE ... ADD VALUE` may run inside a
-- transaction on PG12+, but the new label cannot be USED in that same transaction, and
-- 20260728000003 both defines and exercises functions that reference it. Each migration
-- file is its own transaction, so splitting them is what makes the next one safe.
--
-- WHY THE TYPE DID NOT EXIST (found 2026-07-28): the app has shown a "Shift reminders /
-- Always on (before each shift)" row in Settings since the settings screen was built, and
-- nothing has ever sent one. There was no producer, no type, and no storage. The row
-- described a notification the system does not have.

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'shift_reminder';

-- rollback: none. Postgres cannot remove an enum label without recreating the type.
