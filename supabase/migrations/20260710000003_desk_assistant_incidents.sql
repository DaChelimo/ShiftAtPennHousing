-- Desk Assistant v1 — Phase D: incident redaction (two representations, V1_SCOPE §7.2).
--
-- The RAW incident record is access-controlled and is NEVER placed in the
-- retrievable index (kb_chunks). Only a de-identified LESSON is indexed (as a
-- kb_documents row with source_type='incident_lesson'); disciplinary/private
-- incidents produce NO lesson at all. Rationale: if raw sensitive text is not in the
-- store the retriever reads, no retrieval bug or injection can surface it. The
-- retrieval-time guardrail (containsIncidentLeakage / looksLikeIncidentProbe) is
-- defense in depth on top of this structural control.
--
-- SECURITY: kb_incidents_raw gets a service-role bypass policy and NOTHING ELSE.
-- There is deliberately no authenticated/anon SELECT policy, so with RLS enabled the
-- raw table is unreadable by any client. Only the redaction script (service role)
-- touches it. The pgTAP desk-assistant-incidents.sql pins "zero non-service policies".

CREATE TABLE kb_incidents_raw (
  incident_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_content        text NOT NULL,
  occurred_on        date,
  house_id           text REFERENCES houses (id),
  classification     text NOT NULL DEFAULT 'pending'
    CHECK (classification IN ('pending', 'lesson_extracted', 'private_no_lesson')),
  lesson_document_id uuid REFERENCES kb_documents (document_id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX kb_incidents_raw_classification_idx ON kb_incidents_raw (classification);

ALTER TABLE kb_incidents_raw ENABLE ROW LEVEL SECURITY;

-- The ONLY policy: service-role bypass. No authenticated/anon read path exists.
CREATE POLICY "service-role bypass" ON kb_incidents_raw
  TO service_role USING (true) WITH CHECK (true);
