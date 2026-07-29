BEGIN;
SELECT plan(16);

-- A real multi-block Harnwell shift, far enough out that all three lead times are future.
CREATE TEMP TABLE fx AS
SELECT sba.user_id,
       min(sb.block_start_at) AS run_start,
       count(*)::int          AS blocks
FROM shift_block_assignments sba
JOIN shift_blocks sb USING (block_id)
WHERE sba.status = 'scheduled'
  AND sb.house_id = 'harnwell'
  AND sb.block_start_at > now() + interval '3 hours'
GROUP BY sba.user_id, (sb.block_start_at AT TIME ZONE 'America/New_York')::date
HAVING count(*) >= 6
ORDER BY 2
LIMIT 1;

-- ---------------------------------------------------------------------------
-- Defaults. "Never opened Settings" must equal "kept the defaults".
-- ---------------------------------------------------------------------------
SELECT is(worker_shift_reminder_offsets((SELECT user_id FROM fx)), ARRAY[60],
          'a worker with no stored row gets the 1 hour default');

SELECT ok(is_valid_shift_reminder_offsets(ARRAY[120, 60, 30]), 'all three lead times is valid');
SELECT ok(is_valid_shift_reminder_offsets(ARRAY[]::integer[]),
          'NONE is a valid choice, not an error');
SELECT ok(NOT is_valid_shift_reminder_offsets(ARRAY[60, 60]), 'duplicates are rejected');
SELECT ok(NOT is_valid_shift_reminder_offsets(ARRAY[45]),
          'a lead time the UI does not offer is rejected');

-- ---------------------------------------------------------------------------
-- One reminder per SHIFT per lead time, never one per 30-minute block.
-- ---------------------------------------------------------------------------
INSERT INTO notification_preferences (user_id, shift_reminder_offsets)
SELECT user_id, ARRAY[120, 60, 30] FROM fx;

SELECT is(
  (SELECT count(*)::int
   FROM worker_shift_runs((SELECT run_start FROM fx), (SELECT run_start FROM fx) + interval '12 hours')
   WHERE user_id = (SELECT user_id FROM fx)),
  1,
  'a multi-block shift resolves to exactly ONE contiguous run');

SELECT is(
  (SELECT block_count
   FROM worker_shift_runs((SELECT run_start FROM fx), (SELECT run_start FROM fx) + interval '12 hours')
   WHERE user_id = (SELECT user_id FROM fx)),
  (SELECT blocks FROM fx),
  'the run carries every one of its blocks');

SELECT ok(enqueue_shift_reminders() > 0, 'the producer queues reminders');

SELECT is(
  (SELECT count(*)::int FROM notifications n
   WHERE n.type = 'shift_reminder'
     AND n.recipient_user_id = (SELECT user_id FROM fx)
     AND (n.payload->>'shift_start_at')::timestamptz = (SELECT run_start FROM fx)),
  3,
  'THREE reminders for the shift, one per lead time, not one per block');

-- ---------------------------------------------------------------------------
-- Each fires at the moment it says it will.
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT bool_and(n.scheduled_for
                   = (n.payload->>'shift_start_at')::timestamptz
                     - make_interval(mins => (n.payload->>'offset_minutes')::int))
   FROM notifications n
   WHERE n.type = 'shift_reminder' AND n.recipient_user_id = (SELECT user_id FROM fx)),
  'every reminder is scheduled exactly its lead time before the shift');

SELECT ok(
  (SELECT n.payload->>'title' = 'Your shift starts in 30 minutes'
   FROM notifications n
   WHERE n.type = 'shift_reminder'
     AND n.recipient_user_id = (SELECT user_id FROM fx)
     AND (n.payload->>'offset_minutes')::int = 30
   LIMIT 1),
  'the copy names the lead time the worker chose');

SELECT ok(
  (SELECT bool_and(n.payload->>'body' NOT LIKE '%' || chr(8212) || '%'
                   AND n.payload->>'body' NOT LIKE '%' || chr(8211) || '%')
   FROM notifications n
   WHERE n.type = 'shift_reminder'),
  'reminder copy contains no em or en dash');

-- ---------------------------------------------------------------------------
-- Idempotent: the hourly producer must not re-queue what it already queued.
-- ---------------------------------------------------------------------------
SELECT is(enqueue_shift_reminders(), 0, 'a second pass queues nothing');

-- ---------------------------------------------------------------------------
-- Do not remind someone about a shift they no longer hold.
-- ---------------------------------------------------------------------------
SELECT ok(
  EXISTS (
    SELECT 1 FROM pending_notification_deliveries(now() + interval '30 days') d
    WHERE d.type = 'shift_reminder' AND d.recipient_user_id = (SELECT user_id FROM fx)
  ),
  'a reminder for a shift the worker still holds is deliverable');

-- A vacant seat must carry a real vacancy_origin (valid_vacancy_origin), so this
-- mirrors what a temporary drop actually writes rather than inventing a row shape.
UPDATE shift_block_assignments
SET user_id = NULL, status = 'vacant', vacancy_origin = 'temporary_drop'
WHERE assignment_id IN (
  SELECT (n.payload->>'assignment_id')::uuid FROM notifications n
  WHERE n.type = 'shift_reminder' AND n.recipient_user_id = (SELECT user_id FROM fx)
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pending_notification_deliveries(now() + interval '30 days') d
    WHERE d.type = 'shift_reminder' AND d.recipient_user_id = (SELECT user_id FROM fx)
  ),
  'once the worker no longer holds the shift, the queued reminder is suppressed');

-- ---------------------------------------------------------------------------
-- Turning reminders off means none are queued at all.
-- ---------------------------------------------------------------------------
-- Clear the bookkeeping too, so a zero result means "the producer chose not to queue",
-- not "the producer was deduped against its own earlier pass".
DELETE FROM shift_reminder_sends;
DELETE FROM notifications WHERE type = 'shift_reminder';
INSERT INTO notification_preferences (user_id, shift_reminder_offsets)
SELECT user_id, ARRAY[]::integer[] FROM users
ON CONFLICT (user_id) DO UPDATE SET shift_reminder_offsets = ARRAY[]::integer[];

SELECT is(enqueue_shift_reminders(), 0,
          'with every worker opted out, the producer queues nothing');

SELECT * FROM finish();
ROLLBACK;
