-- Desk Assistant KB: house_scope becomes multi-house (text[]) instead of one house or
-- null. Product need: the intake review UI is moving from a single house-or-shared
-- dropdown to a checkbox picker over all houses, so a document can be scoped to an
-- explicit SUBSET of houses (not just one, not just "all"). NULL keeps meaning "shared,
-- applies to all 13 houses" -- unchanged, and still the cheap/common representation
-- instead of writing out all 13 ids.
--
-- This also closes the gap behind the 2026-07-24 "HARN" incident: a single free-text
-- house_scope with only an FK constraint let the proposer's guess reach kb_documents
-- with an id that doesn't exist, surfacing as a raw FK violation with no useful message
-- at approve time. The validation trigger below rejects an unknown id (or an empty,
-- non-null array) with a clear message before the row can ever be written, for BOTH
-- the direct-write and the array cases -- not just relying on app-layer validation.

-- ---------------------------------------------------------------------------
-- 1) da_can_read_item: p_house_scope text -> text[]. Created under a new signature
--    first (coexists with the old one) so the column ALTER below can bind to it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION da_can_read_item(
  check_user_id   uuid,
  p_house_scope   text[],
  p_sensitivity   da_sensitivity_enum,
  p_allowed_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- house gate: shared corpus (NULL) is universal; an overlay is readable by a
    -- home-house worker of ANY listed house, that house's HM/BM, any RSM
    -- (cross-house read), or admin.
    (
      p_house_scope IS NULL
      OR EXISTS (
        SELECT 1 FROM users u
        WHERE u.user_id = check_user_id AND u.home_house_id = ANY (p_house_scope)
      )
      OR EXISTS (
        SELECT 1 FROM unnest(p_house_scope) AS h(house_id)
        WHERE user_has_house_admin_role(check_user_id, h.house_id)
      )
      OR user_is_rsm(check_user_id)
      OR user_is_admin(check_user_id)
    )
    -- sensitivity gate (placeholder ranks): general = all; internal = any active
    -- staff user; restricted = admin or any house-admin (hm/bm).
    AND (
      p_sensitivity = 'general'
      OR (
        p_sensitivity = 'internal'
        AND EXISTS (SELECT 1 FROM users u WHERE u.user_id = check_user_id AND u.is_active)
      )
      OR (
        p_sensitivity = 'restricted'
        AND (
          user_is_admin(check_user_id)
          OR EXISTS (
            SELECT 1 FROM user_roles r
            WHERE r.user_id = check_user_id AND r.role IN ('hm', 'bm')
          )
        )
      )
    )
    -- role gate: empty allowed_roles = every role; otherwise the user must hold one.
    AND (
      p_allowed_roles = '{}'
      OR EXISTS (
        SELECT 1 FROM user_roles r
        WHERE r.user_id = check_user_id AND r.role::text = ANY (p_allowed_roles)
      )
    );
$$;

REVOKE ALL ON FUNCTION da_can_read_item(uuid, text[], da_sensitivity_enum, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION da_can_read_item(uuid, text[], da_sensitivity_enum, text[])
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Convert the columns. Postgres refuses to ALTER a column's type while an RLS
--    policy expression depends on it, so drop + recreate the two "scoped read"
--    policies verbatim around the ALTER (same USING text; it resolves to the new
--    text[] da_can_read_item overload once the column type changes).
-- ---------------------------------------------------------------------------
DROP POLICY "scoped read" ON kb_documents;
DROP POLICY "scoped read" ON kb_chunks;

ALTER TABLE kb_documents DROP CONSTRAINT kb_documents_house_scope_fkey;
DROP INDEX IF EXISTS kb_documents_house_scope_idx;
ALTER TABLE kb_documents
  ALTER COLUMN house_scope TYPE text[]
  USING (CASE WHEN house_scope IS NULL THEN NULL ELSE ARRAY[house_scope] END);
CREATE INDEX kb_documents_house_scope_idx ON kb_documents USING gin (house_scope);

ALTER TABLE kb_chunks DROP CONSTRAINT kb_chunks_house_scope_fkey;
DROP INDEX IF EXISTS kb_chunks_scope_idx;
ALTER TABLE kb_chunks
  ALTER COLUMN house_scope TYPE text[]
  USING (CASE WHEN house_scope IS NULL THEN NULL ELSE ARRAY[house_scope] END);
CREATE INDEX kb_chunks_scope_idx ON kb_chunks USING gin (house_scope);

CREATE POLICY "scoped read" ON kb_documents
  FOR SELECT TO authenticated
  USING (da_can_read_item(auth.uid(), house_scope, sensitivity, allowed_roles));
CREATE POLICY "scoped read" ON kb_chunks
  FOR SELECT TO authenticated
  USING (da_can_read_item(auth.uid(), house_scope, sensitivity, allowed_roles));

-- Now safe to drop: no policy resolves to the old scalar overload any more.
DROP FUNCTION IF EXISTS da_can_read_item(uuid, text, da_sensitivity_enum, text[]);

-- ---------------------------------------------------------------------------
-- 3) Deterministic validation: Postgres cannot FK an array column's elements, so a
--    trigger enforces the same guarantee the old scalar FK gave us -- every id in
--    house_scope must be a real house, and a non-null house_scope must be non-empty
--    (an intentionally-empty "applies to no house" state has no meaning here; use
--    NULL for shared instead).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_kb_house_scope() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_unknown text;
BEGIN
  IF NEW.house_scope IS NULL THEN
    RETURN NEW;
  END IF;

  IF array_length(NEW.house_scope, 1) IS NULL THEN
    RAISE EXCEPTION 'house_scope must be null (shared) or a non-empty array of house ids';
  END IF;

  SELECT string_agg(DISTINCT h.house_id, ', ' ORDER BY h.house_id)
  INTO v_unknown
  FROM unnest(NEW.house_scope) AS h(house_id)
  WHERE NOT EXISTS (SELECT 1 FROM houses WHERE houses.id = h.house_id);

  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'house_scope contains unknown house id(s): %. Valid ids: %',
      v_unknown,
      (SELECT string_agg(id, ', ' ORDER BY id) FROM houses);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER kb_documents_house_scope_valid
  BEFORE INSERT OR UPDATE OF house_scope ON kb_documents
  FOR EACH ROW EXECUTE FUNCTION validate_kb_house_scope();

CREATE TRIGGER kb_chunks_house_scope_valid
  BEFORE INSERT OR UPDATE OF house_scope ON kb_chunks
  FOR EACH ROW EXECUTE FUNCTION validate_kb_house_scope();

-- ---------------------------------------------------------------------------
-- 4) match_kb_chunks: house_scope column changes to text[] (return-type change,
--    so DROP then CREATE). Everything else (temporal filter, p_as_of) unchanged
--    from 20260711000002.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS match_kb_chunks(uuid, vector, int, date);

CREATE OR REPLACE FUNCTION match_kb_chunks(
  p_user_id         uuid,
  p_query_embedding vector(1024),
  p_top_k           int DEFAULT 24,
  p_as_of           date DEFAULT NULL
)
RETURNS TABLE (
  chunk_id         uuid,
  document_id      uuid,
  content          text,
  source_ref       text,
  house_scope      text[],
  sensitivity      da_sensitivity_enum,
  allowed_roles    text[],
  temporality      da_temporality_enum,
  effective_from   date,
  effective_until  date,
  source_updated_at timestamptz,
  similarity       double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.chunk_id,
    c.document_id,
    c.content,
    d.source_ref,
    c.house_scope,
    c.sensitivity,
    c.allowed_roles,
    c.temporality,
    c.effective_from,
    c.effective_until,
    d.updated_at AS source_updated_at,
    1 - (c.embedding <=> p_query_embedding) AS similarity
  FROM kb_chunks c
  JOIN kb_documents d ON d.document_id = c.document_id
  WHERE c.embedding IS NOT NULL
    AND da_can_read_item(p_user_id, c.house_scope, c.sensitivity, c.allowed_roles)
    AND (
      p_as_of IS NULL
      OR (
        (c.effective_from IS NULL OR c.effective_from <= p_as_of)
        AND (c.effective_until IS NULL OR c.effective_until >= p_as_of)
      )
    )
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT GREATEST(p_top_k, 1);
$$;

REVOKE ALL ON FUNCTION match_kb_chunks(uuid, vector, int, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_kb_chunks(uuid, vector, int, date) TO service_role;

-- ---------------------------------------------------------------------------
-- 5) commit_kb_intake: p_house_scope text -> text[]; the per-chunk jsonb payload's
--    houseScope field is now a JSON array or null (was a JSON string or null), so the
--    per-chunk extraction switches from nullif(text) to a jsonb-array unnest.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS commit_kb_intake(
  uuid, text, da_source_type_enum, text, text, da_sensitivity_enum, text[],
  da_temporality_enum, date, date, jsonb, jsonb
);

CREATE OR REPLACE FUNCTION commit_kb_intake(
  p_intake_id uuid,
  p_title text,
  p_source_type da_source_type_enum,
  p_source_ref text,
  p_house_scope text[],
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
    case
      when jsonb_typeof(elem->'houseScope') = 'array'
        then (select array_agg(x) from jsonb_array_elements_text(elem->'houseScope') x)
      else null
    end,
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
  uuid, text, da_source_type_enum, text, text[], da_sensitivity_enum, text[],
  da_temporality_enum, date, date, jsonb, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION commit_kb_intake(
  uuid, text, da_source_type_enum, text, text[], da_sensitivity_enum, text[],
  da_temporality_enum, date, date, jsonb, jsonb
) TO service_role;

-- rollback:
-- DROP TRIGGER IF EXISTS kb_documents_house_scope_valid ON kb_documents;
-- DROP TRIGGER IF EXISTS kb_chunks_house_scope_valid ON kb_chunks;
-- DROP FUNCTION IF EXISTS validate_kb_house_scope();
-- (reverting the column types requires collapsing multi-house rows back to one
-- house first; not safely automatable, so no down-migration is provided.)
