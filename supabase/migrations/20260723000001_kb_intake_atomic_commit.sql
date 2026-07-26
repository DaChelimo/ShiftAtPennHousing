-- KB intake: atomic embed+commit (fixes silently-stranded intakes).
--
-- BUG (surfaced 2026-07-23): approveIntake (apps/web/lib/actions/kbIntake.ts) wrote the
-- kb_documents row, then the kb_chunks rows, then the kb_intake status update as THREE
-- separate PostgREST calls from Node. A dev-server crash between the first and third call
-- (observed: mid-run interruption, likely a machine sleep/wake taking the whole local
-- Docker stack down with it) left kb_intake stuck at status='embedding' forever -- nothing
-- times it out or retries it -- with an orphaned kb_documents row (zero chunks, never
-- linked via kb_intake.document_id) as a side effect. A naive retry that just re-ran
-- approveIntake would have created a SECOND orphaned document alongside the first.
--
-- Fix: move the write half of the commit (document insert, chunk insert, status update)
-- into one Postgres function. A single function invocation is one transaction, so a crash
-- or error at any point now rolls back the whole thing -- either the intake goes fully
-- live with its chunks, or nothing lands and kb_intake is untouched, safe to retry with no
-- cleanup. The embedding call itself (Voyage AI, an external HTTP request) has to stay in
-- Node; only the DB writes that follow it move here.
create or replace function commit_kb_intake(
  p_intake_id uuid,
  p_title text,
  p_source_type da_source_type_enum,
  p_source_ref text,
  p_house_scope text,
  p_sensitivity da_sensitivity_enum,
  p_allowed_roles text[],
  p_temporality da_temporality_enum,
  p_effective_from date,
  p_effective_until date,
  p_chunks jsonb,
  p_metrics jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_document_id uuid;
  v_chunk_count int;
begin
  insert into kb_documents (
    title, source_type, source_ref, house_scope, sensitivity, allowed_roles,
    temporality, effective_from, effective_until
  ) values (
    p_title, p_source_type, p_source_ref, p_house_scope, p_sensitivity, p_allowed_roles,
    p_temporality, p_effective_from, p_effective_until
  )
  returning document_id into v_document_id;

  insert into kb_chunks (
    document_id, chunk_index, content, embedding, house_scope, sensitivity,
    allowed_roles, token_count, temporality, effective_from, effective_until
  )
  select
    v_document_id,
    (elem->>'chunkIndex')::int,
    elem->>'content',
    (elem->>'embedding')::vector,
    nullif(elem->>'houseScope', ''),
    (elem->>'sensitivity')::da_sensitivity_enum,
    coalesce(
      array(select jsonb_array_elements_text(elem->'allowedRoles')),
      array[]::text[]
    ),
    (elem->>'tokenCount')::int,
    (elem->>'temporality')::da_temporality_enum,
    nullif(elem->>'effectiveFrom', '')::date,
    nullif(elem->>'effectiveUntil', '')::date
  from jsonb_array_elements(p_chunks) as elem;

  get diagnostics v_chunk_count = row_count;

  update kb_intake
  set status = 'live',
      status_detail = 'Live',
      document_id = v_document_id,
      metrics = p_metrics
  where intake_id = p_intake_id;

  return jsonb_build_object('document_id', v_document_id, 'chunk_count', v_chunk_count);
end;
$$;

REVOKE ALL ON FUNCTION commit_kb_intake(
  uuid, text, da_source_type_enum, text, text, da_sensitivity_enum, text[],
  da_temporality_enum, date, date, jsonb, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION commit_kb_intake(
  uuid, text, da_source_type_enum, text, text, da_sensitivity_enum, text[],
  da_temporality_enum, date, date, jsonb, jsonb
) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS commit_kb_intake(
--   uuid, text, da_source_type_enum, text, text, da_sensitivity_enum, text[],
--   da_temporality_enum, date, date, jsonb, jsonb
-- );
