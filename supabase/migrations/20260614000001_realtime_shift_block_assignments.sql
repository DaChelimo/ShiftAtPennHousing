-- Enable Realtime for shift_block_assignments.
--
-- The worker mobile app subscribes to postgres_changes on this table
-- (WorkerShiftsRepository: channel "worker-shifts-<userId>", table
-- "shift_block_assignments") so any assignment change triggers a refetch
-- ("no manual refresh"). Without the table in the supabase_realtime
-- publication, the server rejects the subscription with
-- "Unable to subscribe to changes with given parameters", which the
-- Kotlin/Native (iOS) client surfaces as an uncaught coroutine exception
-- and aborts the app right after login. Mirror the notifications setup
-- (20260601000001): REPLICA IDENTITY FULL + idempotent publication add.

ALTER TABLE shift_block_assignments REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'shift_block_assignments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE shift_block_assignments;
  END IF;
END;
$$;

-- Rollback (manual):
-- ALTER PUBLICATION supabase_realtime DROP TABLE shift_block_assignments;
