-- Migration: RSM role — enum value (part 1 of 2).
--
-- Introduces the Residential Services Manager (RSM): a university employee who
-- sits BELOW the Housing Manager and ABOVE the Student Manager in the house
-- hierarchy. An RSM holds all of an HM's powers EXCEPT serving as HMOD, plus
-- read-only visibility into every house's schedule (BSpec §2.3a).
--
-- `ALTER TYPE ... ADD VALUE` must be committed before the new value can be
-- referenced by a constraint, policy, or function literal. Postgres forbids
-- using a freshly-added enum value in the SAME transaction that adds it, and the
-- Supabase migration runner wraps each file in its own transaction — so the value
-- is added here, on its own, and every USE of it lands in 20260617000006 (the
-- next file = the next transaction). Do not merge these two migrations.
--
-- Placed AFTER 'hm' so the enum order reads sw < sm < hm < rsm < bm; enum
-- ordering is cosmetic here (no ORDER BY on the role column), but it keeps the
-- declared order legible. Idempotent via IF NOT EXISTS.

ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'rsm' AFTER 'hm';

-- rollback: enum values cannot be dropped in Postgres without recreating the
-- type. To revert, recreate user_role_enum without 'rsm' and re-cast every
-- dependent column/function (out of scope for an automated down-migration).
