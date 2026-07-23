-- Desk Assistant — add an `app_guide` source_type for in-app how-to content.
--
-- The onboarding program authors task-oriented "how do I ... in the app" guides
-- (dropping a shift, proposing a swap, claiming an open shift, break shifts, etc.)
-- and ingests them into the KB so the assistant can answer navigation / how-to
-- questions directly and concisely. These are production content, distinct from
-- the synthetic `fixture` corpus and from house policy `house_binder`s, so they
-- get their own category. Retrieval filters on scope / sensitivity / temporality
-- (never source_type), so this value is purely for clean categorization and for
-- the citation label the assistant shows back ("per the Shift app guide").
--
-- Mirrors the intake-enum pattern (20260711000001): ADD VALUE IF NOT EXISTS runs
-- as its own statement, idempotent on re-application.

ALTER TYPE da_source_type_enum ADD VALUE IF NOT EXISTS 'app_guide';
