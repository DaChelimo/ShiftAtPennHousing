-- Migration: surface the HOUSE each side of a pending swap is physically worked at.
--
-- A swap leg's assignment_ids point at shift_block_assignments rows; each row's block
-- (shift_blocks.house_id) is the desk it is PHYSICALLY worked at. For a floated shift the
-- worker's assignment is a `floated_in` row attached to the DESTINATION house's block, so
-- block.house_id is already the real working location — NOT the worker's home house. This
-- is exactly what a counterparty needs to see before accepting: "I'm picking up a shift at
-- Harnwell" must reflect where the shift actually sits, even when the proposer was floated
-- there from elsewhere (BEHAVIORAL: a swap must never silently relocate the acceptor).
--
-- worker_pending_swaps() (20260617000003) computed each side's span from shift_blocks but
-- discarded sb.house_id. This adds initiator/counterparty house id + display name per side.
-- Additive read-model only; no behavior change. Adding OUT columns changes the function's
-- return type, so DROP then recreate (CREATE OR REPLACE cannot widen RETURNS TABLE).

DROP FUNCTION IF EXISTS worker_pending_swaps();

CREATE FUNCTION worker_pending_swaps()
RETURNS TABLE (
  swap_id                     uuid,
  swap_type                   text,
  direction                   text,   -- 'incoming' (I'm counterparty) | 'outgoing' (I'm initiator)
  status                      text,
  created_at                  timestamptz,
  expires_at                  timestamptz,
  other_user_id               uuid,
  other_user_name             text,
  initiator_assignment_ids    uuid[],
  counterparty_assignment_ids uuid[],
  initiator_start             timestamptz,
  initiator_end               timestamptz,
  initiator_blocks            integer,
  initiator_house_id          text,
  initiator_house_name        text,
  counterparty_start          timestamptz,
  counterparty_end            timestamptz,
  counterparty_blocks         integer,
  counterparty_house_id       text,
  counterparty_house_name     text,
  recurring_pattern           jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sr.swap_id,
    sr.swap_type::text,
    CASE WHEN sr.initiator_user_id = auth.uid() THEN 'outgoing' ELSE 'incoming' END,
    sr.status::text,
    sr.created_at,
    sr.expires_at,
    CASE WHEN sr.initiator_user_id = auth.uid() THEN sr.counterparty_user_id ELSE sr.initiator_user_id END,
    CASE WHEN sr.initiator_user_id = auth.uid() THEN cp.name ELSE ini.name END,
    sr.initiator_assignment_ids,
    sr.counterparty_assignment_ids,
    ispan.span_start, ispan.span_end, COALESCE(ispan.block_count, 0),
    ispan.house_id, ih.name,
    cspan.span_start, cspan.span_end, COALESCE(cspan.block_count, 0),
    cspan.house_id, ch.name,
    sr.recurring_pattern
  FROM swap_requests sr
  JOIN users ini ON ini.user_id = sr.initiator_user_id
  LEFT JOIN users cp ON cp.user_id = sr.counterparty_user_id
  LEFT JOIN LATERAL (
    SELECT
      min(sb.block_start_at)                            AS span_start,
      max(sb.block_start_at) + interval '30 minutes'    AS span_end,
      count(*)::integer                                 AS block_count,
      -- A swap leg is one contiguous shift at one desk, so every block shares a house;
      -- min() collapses them deterministically (any() would do — they're identical).
      min(sb.house_id)                                  AS house_id
    FROM shift_block_assignments a
    JOIN shift_blocks sb ON sb.block_id = a.block_id
    WHERE a.assignment_id = ANY (sr.initiator_assignment_ids)
  ) ispan ON true
  LEFT JOIN LATERAL (
    SELECT
      min(sb.block_start_at)                            AS span_start,
      max(sb.block_start_at) + interval '30 minutes'    AS span_end,
      count(*)::integer                                 AS block_count,
      min(sb.house_id)                                  AS house_id
    FROM shift_block_assignments a
    JOIN shift_blocks sb ON sb.block_id = a.block_id
    WHERE a.assignment_id = ANY (COALESCE(sr.counterparty_assignment_ids, ARRAY[]::uuid[]))
  ) cspan ON true
  LEFT JOIN houses ih ON ih.id = ispan.house_id
  LEFT JOIN houses ch ON ch.id = cspan.house_id
  WHERE sr.status = 'pending'
    AND (sr.initiator_user_id = auth.uid() OR sr.counterparty_user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION worker_pending_swaps() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_pending_swaps() TO authenticated;

-- rollback: restore the 20260617000003 definition (without the *_house_id / *_house_name columns).
