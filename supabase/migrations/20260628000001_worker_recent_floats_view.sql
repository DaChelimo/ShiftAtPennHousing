-- ---------------------------------------------------------------------------
-- worker_recent_floats — the authenticated worker's RESOLVED float assignments
-- from the last 24h (acknowledged / declined / voided), one row per float, with
-- the destination house, the float WINDOW (start AND end), the terminal status,
-- and the resolution time. Drives the collapsible "Recent float requests" history
-- section under the My-Shifts float carousel: once a float resolves it drops out
-- of the prominent carousel and lands here as a de-emphasized, auto-aging record.
--
-- Why NOT security_invoker (worker_pending_floats IS): a declined or voided float
-- has its destination blocks reset to vacant (user_id = NULL) by decline_float /
-- process_no_ack_float, so the worker no longer owns those blocks and an invoker
-- view could not read them to aggregate the window. This view instead runs as its
-- OWNER (bypassing RLS) and self-scopes with `fa.user_id = auth.uid()`, so it
-- returns ONLY the caller's own floats and never leaks another worker's rows.
-- An anonymous caller (auth.uid() IS NULL) matches nothing.
--
-- Bounded to a handful of recent rows, so (like worker_pending_floats) it is immune
-- to PostgREST's db-max-rows (1000) truncation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW worker_recent_floats AS
SELECT
  fa.float_id,
  fa.user_id,
  sb.house_id                                                AS destination_house_id,
  h.name                                                     AS destination_house_name,
  min(sb.block_start_at)                                     AS float_start,
  max(sb.block_start_at) + interval '30 minutes'             AS float_end,
  fa.status::text                                            AS status,
  COALESCE(fa.acknowledged_at, fa.declined_at, fa.no_ack_at) AS resolved_at
FROM float_assignments fa
JOIN shift_block_assignments sba
  ON sba.assignment_id = ANY (fa.destination_assignment_ids)
JOIN shift_blocks sb USING (block_id)
JOIN houses h ON h.id = sb.house_id
WHERE fa.user_id = auth.uid()
  AND fa.status IN ('acknowledged', 'declined', 'voided')
  AND COALESCE(fa.acknowledged_at, fa.declined_at, fa.no_ack_at)
      > now() - interval '24 hours'
GROUP BY fa.float_id, fa.user_id, sb.house_id, h.name, fa.status,
         fa.acknowledged_at, fa.declined_at, fa.no_ack_at;

GRANT SELECT ON worker_recent_floats TO anon, authenticated, service_role;

-- rollback:
-- DROP VIEW IF EXISTS worker_recent_floats;
