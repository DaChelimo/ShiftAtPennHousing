-- Migration: Administrator role — enum value (part 1 of 2).
--
-- Introduces the top-level Administrator (`admin`): a house-agnostic superuser,
-- operated by the project owner in v1 and grantable to others later. The admin
-- authors the operating configuration (which houses are active on which dates,
-- per-house headcount over time, whether floating is on, float routing) that
-- every lower role (BM, HM, RSM, SM, SW) then consumes through the existing
-- runtime paths. See docs/operating-seasons/PLAN.md and BSpec §2.7.
--
-- `ALTER TYPE ... ADD VALUE` must be committed before the new value can be
-- referenced by a constraint, policy, or function literal. Postgres forbids
-- using a freshly-added enum value in the SAME transaction that adds it, and the
-- Supabase migration runner wraps each file in its own transaction — so the value
-- is added here, on its own, and every USE of it lands in 20260702000002 (the
-- next file = the next transaction). Do not merge these two migrations. This
-- mirrors the RSM enum-add pattern (20260617000005 / 20260617000006).
--
-- Placed AFTER 'bm' so the enum reads sw < sm < hm < rsm < bm < admin; enum
-- ordering is cosmetic (no ORDER BY on the role column) but keeps the tier
-- legible. Idempotent via IF NOT EXISTS.

ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'admin' AFTER 'bm';

-- rollback: enum values cannot be dropped in Postgres without recreating the
-- type. To revert, recreate user_role_enum without 'admin' and re-cast every
-- dependent column/function (out of scope for an automated down-migration).
