-- One-sided handoff (BEHAVIORAL_SPECIFICATION.md §8.5) — a directed, peer-consented
-- ONE-WAY transfer: worker A hands their shift to a specific worker B (give-only), or
-- takes over B's shift (take-only). Unlike drop→open-feed (anyone may claim) it targets
-- a specific person; unlike a symmetric swap one side gives nothing back.
--
-- The new swap_type value lives in its OWN migration: Postgres forbids using a newly
-- added enum value in the same transaction that adds it, so the CHECK constraints and
-- accept_swap branch that reference 'handoff' go in the next migration.
ALTER TYPE swap_type_enum ADD VALUE IF NOT EXISTS 'handoff';
