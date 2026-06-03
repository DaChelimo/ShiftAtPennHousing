# e2e-lifecycle — realistic environment (chunk S2)

The non-destructive, deterministic seed + greedy allocator that produces a **published
schedule with intentional gaps** for the end-to-end lifecycle program. See
`tests/e2e-lifecycle/PLAN.md` (source of truth) and `STATUS.md` (ledger).

## Run

```bash
supabase db reset          # clean seed.sql baseline (config + phase-13b fixtures)
pnpm e2e:lifecycle:seed    # layer the e… environment + allocate + publish (idempotent)
pnpm e2e:lifecycle:seed:check   # assert the S2 exit gate (8 checks)
```

The seed talks to Postgres **directly as the `postgres` superuser** via `DB_URL` (`pg`), the
most robust path for raw setup — it writes the `auth` schema like `supabase/seed.sql`, calls the
SECURITY DEFINER RPCs (`generate_blocks_for_range`, `publish_schedule`), and bypasses
PostgREST/RLS while business triggers still fire. (S3's RLS-visibility harness will add a
supabase-js service client + `asUser` helper.)

## Files

| File                   | Role                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `roster.ts`            | Pure fixtures: houses, headcounts, build week, `e…` worker/admin roster, the deterministic preference (archetype) model. No DB/clock/RNG. |
| `allocate.ts`          | Pure greedy template allocator (4 × 4h shift templates → contiguous ≥4-block runs, headcount-capped, never a `cannot`).                   |
| `seed.ts`              | Orchestrator: users → calendar → blocks → targets → prefs → drafts → publish, one transaction, idempotent.                                |
| `checks/seed-check.ts` | Exit-gate assertions (read-only).                                                                                                         |
| `env.ts`               | Local-stack connection details (read at runtime; documented local fallbacks).                                                             |

## Locked facts (PLAN §1, §2)

- **Namespace**: every row is `e…`-UUID / `e.*@pennhousing.test`. Never touch the a/b/c/d…
  phase-13b fixtures or `supabase/seed.sql`.
- **Build week**: Mon **2026-03-02** … Sun **2026-03-08** (inside Spring-2026; clear of the
  2026-02-02 phase-13b blocks; contains the 2026-03-08 DST spring-forward for S5).
- **Period**: reuse `c0000000-…-000000000001` (the `regular_school_year` overlap constraint
  forbids a second overlapping period).
- **Builder**: one BM (`e.builder@…`) holds a `(bm, house)` role for all 13 houses, so it is the
  authorized `created_by` + `publish_schedule` publisher everywhere.

## Side effects to know (S3+)

- Publishing all 13 houses flips the period-wide `scheduling_periods.published_at` (desired —
  S3 scenario 1 asserts it set).
- `publish_schedule` is per-house and loops **all** in-period blocks for that house, so
  publishing `quad` also gives the seeded 2026-02-02 fixture blocks their vacant seats. This is
  inert (the harness operates on the 2026-03-02…08 build week) and wiped by `db reset`; it never
  reaches the phase-13b suites, which always run against a fresh reset.
