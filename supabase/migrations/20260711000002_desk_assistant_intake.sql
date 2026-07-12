-- Desk Assistant KB Intake — schema (part 2 of 2). INTAKE_PLAN Phase 3 + section 4a.
--
-- Additive. Adds: temporal validity columns to the knowledge base, the intake staging
-- table + its lifecycle status enum, a private uploads bucket, and a temporal-aware
-- rewrite of match_kb_chunks. Nothing here touches the staffing engine.

-- ---------------------------------------------------------------------------
-- Temporality + intake status enums (new types; usable in this same transaction)
-- ---------------------------------------------------------------------------

-- Validity class of a knowledge item (INTAKE_PLAN section 4a). Mirrors packages/core
-- Temporality. `durable` = timeless rule; `until_superseded` = standing note with an
-- open end; `expires` = a dated announcement that drops out of retrieval past its end.
CREATE TYPE da_temporality_enum AS ENUM ('durable', 'until_superseded', 'expires');

-- Lifecycle of a document moving through the intake pipeline (INTAKE_PLAN section 6.2).
CREATE TYPE da_intake_status_enum AS ENUM (
  'uploaded',
  'normalizing',
  'proposed',
  'in_review',
  'approved',
  'embedding',
  'live',
  'rejected',
  'failed'
);

-- ---------------------------------------------------------------------------
-- Temporal validity columns on the knowledge base (denormalized parent -> chunk)
-- ---------------------------------------------------------------------------
-- Default 'durable' / NULL bounds means "always in effect", so every existing row is
-- unchanged and every legacy ingest keeps working without setting these.
ALTER TABLE kb_documents
  ADD COLUMN temporality    da_temporality_enum NOT NULL DEFAULT 'durable',
  ADD COLUMN effective_from date,
  ADD COLUMN effective_until date;

ALTER TABLE kb_chunks
  ADD COLUMN temporality    da_temporality_enum NOT NULL DEFAULT 'durable',
  ADD COLUMN effective_from date,
  ADD COLUMN effective_until date;

-- Ordered bounds: a set end must not precede a set start.
ALTER TABLE kb_documents ADD CONSTRAINT kb_documents_effective_order
  CHECK (effective_from IS NULL OR effective_until IS NULL OR effective_until >= effective_from);
ALTER TABLE kb_chunks ADD CONSTRAINT kb_chunks_effective_order
  CHECK (effective_from IS NULL OR effective_until IS NULL OR effective_until >= effective_from);

-- Retrieval filters chunks by the as-of window; index the end bound (the selective one).
CREATE INDEX kb_chunks_effective_until_idx ON kb_chunks (effective_until);

-- ---------------------------------------------------------------------------
-- kb_intake — staging row per uploaded document (INTAKE_PLAN section 4.1)
-- ---------------------------------------------------------------------------
CREATE TABLE kb_intake (
  intake_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_storage_path text NOT NULL,
  original_filename     text NOT NULL,
  input_format          text NOT NULL CHECK (input_format IN ('markdown', 'text', 'pdf')),
  normalized_text       text,
  proposed_meta         jsonb,          -- ProposedDoc (packages/core propose.ts)
  representations       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                da_intake_status_enum NOT NULL DEFAULT 'uploaded',
  status_detail         text,           -- current step, or the reason on 'failed'
  document_id           uuid REFERENCES kb_documents (document_id) ON DELETE SET NULL,
  created_by            uuid NOT NULL REFERENCES users (user_id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX kb_intake_status_idx  ON kb_intake (status);
CREATE INDEX kb_intake_created_idx ON kb_intake (created_at DESC);

-- keep updated_at fresh so the admin queue's live status is trustworthy
CREATE OR REPLACE FUNCTION kb_intake_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER kb_intake_touch
  BEFORE UPDATE ON kb_intake
  FOR EACH ROW EXECUTE FUNCTION kb_intake_touch_updated_at();

-- ---------------------------------------------------------------------------
-- da_is_kb_admin — the intake admin gate (HM / BM / RSM / admin)
-- ---------------------------------------------------------------------------
-- Intake is an admin pipeline (INTAKE_PLAN section 2.2): only house-admin tier users
-- may upload, review, and approve. This is the bucket-level "any admin" gate (no house
-- argument), distinct from the per-house da_can_read_item read matrix.
CREATE OR REPLACE FUNCTION da_is_kb_admin(check_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    user_is_admin(check_user_id)
    OR user_is_rsm(check_user_id)
    OR EXISTS (
      SELECT 1 FROM user_roles r
      WHERE r.user_id = check_user_id AND r.role IN ('hm', 'bm')
    );
$$;
REVOKE ALL ON FUNCTION da_is_kb_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION da_is_kb_admin(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- kb_intake RLS
-- ---------------------------------------------------------------------------
ALTER TABLE kb_intake ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON kb_intake
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "kb admin read" ON kb_intake
  FOR SELECT TO authenticated
  USING (da_is_kb_admin(auth.uid()));

CREATE POLICY "kb admin insert" ON kb_intake
  FOR INSERT TO authenticated
  WITH CHECK (da_is_kb_admin(auth.uid()) AND created_by = auth.uid());

CREATE POLICY "kb admin update" ON kb_intake
  FOR UPDATE TO authenticated
  USING (da_is_kb_admin(auth.uid()))
  WITH CHECK (da_is_kb_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage bucket for original uploads (private; admin-only via storage.objects RLS)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('kb-uploads', 'kb-uploads', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "kb uploads admin read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'kb-uploads' AND da_is_kb_admin(auth.uid()));

CREATE POLICY "kb uploads admin write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'kb-uploads' AND da_is_kb_admin(auth.uid()));

CREATE POLICY "kb uploads admin update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'kb-uploads' AND da_is_kb_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- match_kb_chunks — temporal-aware rewrite (INTAKE_PLAN section 4a.3)
-- ---------------------------------------------------------------------------
-- Adds p_as_of: a NY-local calendar date the question is "as of". When set, a chunk is
-- only a candidate if its validity window is in effect on that date, so an expired
-- announcement can never ground an answer. p_as_of NULL keeps the durable-only behavior.
-- Also returns the temporal window + parent updated_at so packages/core can apply the
-- recency-supersession tiebreak. Return signature changes, so DROP then CREATE.
DROP FUNCTION IF EXISTS match_kb_chunks(uuid, vector, int);

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
  house_scope      text,
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
