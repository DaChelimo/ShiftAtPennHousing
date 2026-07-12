-- Desk Assistant KB Intake — enum values (part 1 of 2). INTAKE_PLAN Phase 3.
--
-- `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that adds it,
-- and the Supabase migration runner wraps each file in its own transaction. So the
-- two new source types are added here, alone; every USE of them lands in the next
-- file (20260711000002 = the next transaction). Do not merge these two migrations.
--
-- 'email'      — a forwarded RSM/house email ingested through the intake queue.
-- 'pdf_upload' — a PDF (binder page, exported email, guide) uploaded by an admin.
-- Both are purely additive; existing source types and rows are untouched.

ALTER TYPE da_source_type_enum ADD VALUE IF NOT EXISTS 'email';
ALTER TYPE da_source_type_enum ADD VALUE IF NOT EXISTS 'pdf_upload';

-- rollback: enum values cannot be dropped in Postgres without recreating the type
-- and re-casting every dependent column/function (out of scope for a down-migration).
