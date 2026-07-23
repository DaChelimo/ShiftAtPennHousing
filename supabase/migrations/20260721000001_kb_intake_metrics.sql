-- kb_intake dev-mode instrumentation: persist per-upload timing/cost telemetry.
--
-- Additive only. `metrics` holds a snapshot of extraction/propose/embed/commit
-- durations, token usage, and estimated USD cost for one intake run (see
-- IntakeMetrics in apps/web/lib/actions/kbIntake.ts). NULL for any intake that
-- predates this column or that failed before a stage recorded its metrics.

ALTER TABLE kb_intake ADD COLUMN metrics jsonb;
