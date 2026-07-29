BEGIN;
SELECT plan(14);

-- Fixtures: two Harnwell workers with future seats.
CREATE TEMP TABLE fx AS
SELECT sba.user_id, sba.assignment_id,
       row_number() OVER (PARTITION BY sba.user_id ORDER BY sb.block_start_at) rn,
       dense_rank() OVER (ORDER BY sba.user_id) ur
FROM shift_block_assignments sba
JOIN shift_blocks sb USING (block_id)
WHERE sba.status = 'scheduled' AND sb.block_start_at > now() AND sb.house_id = 'harnwell';

CREATE TEMP TABLE parties AS
SELECT (SELECT user_id FROM fx WHERE ur = 1 LIMIT 1) AS a,
       (SELECT assignment_id FROM fx WHERE ur = 1 AND rn = 1) AS a_seat,
       (SELECT user_id FROM fx WHERE ur = 2 LIMIT 1) AS b,
       (SELECT assignment_id FROM fx WHERE ur = 2 AND rn = 1) AS b_seat;

-- 1. swap_requests is live for Realtime, with FULL replica identity.
SELECT ok(
  EXISTS (SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'swap_requests'),
  'swap_requests is in the supabase_realtime publication');
SELECT is(
  (SELECT relreplident FROM pg_class WHERE relname = 'swap_requests'), 'f',
  'swap_requests has REPLICA IDENTITY FULL so an UPDATE RLS-checks correctly');

-- 2. Creating a request notifies the COUNTERPARTY, and only them.
INSERT INTO swap_requests (swap_type, initiator_user_id, counterparty_user_id,
  initiator_assignment_ids, counterparty_assignment_ids, expires_at)
SELECT 'shift_swap', a, b, ARRAY[a_seat], ARRAY[b_seat], now() + interval '1 day' FROM parties;

SELECT is((SELECT count(*)::int FROM notifications n, parties p
           WHERE n.payload->>'kind' = 'swap_requested' AND n.recipient_user_id = p.b), 1,
          'the counterparty is notified of a new swap request');
SELECT is((SELECT count(*)::int FROM notifications n, parties p
           WHERE n.payload->>'kind' = 'swap_requested' AND n.recipient_user_id = p.a), 0,
          'the initiator is not notified of their own request');
SELECT ok((SELECT n.payload->>'body' LIKE '%Respond by%' FROM notifications n
           WHERE n.payload->>'kind' = 'swap_requested' LIMIT 1),
          'the request notification carries the deadline');
SELECT ok((SELECT n.payload->>'body' NOT LIKE '%' || chr(8212) || '%' FROM notifications n
           WHERE n.payload->>'kind' = 'swap_requested' LIMIT 1),
          'notification copy contains no em dash');

-- 3. Both seats carry a live-calendar mark, naming both parties.
SELECT is((SELECT count(*)::int FROM pending_swap_seat_marks), 2,
          'both sides of the exchange are marked on the live calendar');
SELECT is((SELECT count(DISTINCT side)::int FROM pending_swap_seat_marks), 2,
          'the two marks identify which side each seat is');
SELECT ok((SELECT bool_and(initiator_name IS NOT NULL AND awaiting_name IS NOT NULL)
           FROM pending_swap_seat_marks),
          'each mark names who proposed it and who owes an answer');

-- 4. Declining notifies the INITIATOR (the bug: a decline reached nobody).
UPDATE swap_requests SET status = 'rejected'
WHERE swap_id = (SELECT swap_id FROM swap_requests ORDER BY created_at DESC LIMIT 1);

SELECT is((SELECT count(*)::int FROM notifications n, parties p
           WHERE n.payload->>'kind' = 'swap_declined' AND n.recipient_user_id = p.a), 1,
          'declining notifies the worker who proposed the swap');
SELECT is((SELECT count(*)::int FROM pending_swap_seat_marks), 0,
          'a resolved swap leaves no live-calendar mark');

-- 5. Preference defaults, and the missing-row case behaving like the defaults.
SELECT ok(wants_open_shift_notification((SELECT a FROM parties), 'harnwell'),
          'with no stored row, a worker still hears about their own house');
SELECT ok(NOT wants_open_shift_notification((SELECT a FROM parties), 'rodin'),
          'with no stored row, other houses stay opt-in');

INSERT INTO notification_preferences (user_id, open_shifts_home_house, open_shifts_other_houses)
SELECT a, false, true FROM parties;
SELECT ok(
  NOT wants_open_shift_notification((SELECT a FROM parties), 'harnwell')
  AND wants_open_shift_notification((SELECT a FROM parties), 'rodin'),
  'a stored preference overrides both defaults independently');

SELECT * FROM finish();
ROLLBACK;
