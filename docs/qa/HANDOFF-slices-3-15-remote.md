# Handoff: run ship-check slices 3 to 15 (remote-Supabase era)

Supersedes the local-stack assumptions in `HANDOFF-slices-3-15.md`. The app is now powered
solely by the hosted Supabase project. **The QA pass still runs against a LOCAL stack.**

## Why the pass does not run against the hosted project

Not primarily quota. The persona's method is destructive by design, and on this schema the
destruction is irreversible and lands on real people:

- Slice 2 built a two-session race fixture with `pg_sleep` interleaving on
  `shift_block_assignments`. Against prod that is a real double-booking on a real seat.
- `lock_block_coverage` is one-way and **no unlock function exists in any of the 152
  migrations**. A probed block becomes permanently unclaimable; recovery is a manual UPDATE.
- `fire_worker` deactivates a real worker. `apply_compiled_season` cancels real occupants and
  emits `shift_cancelled_config`. `transfer_worker` vacates real seats and voids real floats.
- Slices 5 and 15 drive the escalation chain: real pushes, a real SMOD/CSMOD page to the shared
  duty phone, and real Allied procurement, which is a paid third party. Push delivery is
  deliberately at-least-once and mandatory, so there is no "it probably will not send".

Egress is the fourth-most-important reason. For scale: slice 2 measured 15,910 feed rows for a
single worker.

## Setup, once per session

Grants and RLS are authoritative in the running catalog, not in the migrations, so the local
stack must be checked against prod rather than assumed equivalent.

1. **Local stack from migrations.**

   ```bash
   supabase start
   supabase db reset          # LOCAL ONLY. Never pass --linked. Requires the user's explicit go-ahead.
   ```

2. **Catalog parity against prod, read-only, one query per side.** Create
   `scripts/qa/catalog-parity.sql` if absent:

   ```sql
   SELECT 'table' AS kind, table_name AS obj,
          has_table_privilege('anon', table_name, 'SELECT')::text AS anon,
          has_table_privilege('authenticated', table_name, 'SELECT')::text AS auth
   FROM information_schema.tables WHERE table_schema = 'public'
   UNION ALL
   SELECT 'function', p.oid::regprocedure::text,
          has_function_privilege('anon', p.oid, 'EXECUTE')::text,
          has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
   ORDER BY 1, 2;
   ```

   Run it against both, diff the two files. **Every difference is a finding**: it means the
   migrations and production reality disagree. File those before starting the slices.

3. **Never dump prod rows.** `worker_directory` exposes `email`, so a data dump is real Penn
   student PII in your scratch directory and in an agent's context. Use `supabase/seeds/`
   (`harnwell-real-workers.sql`, `manual-test.sql`, `prod/`). Schema and roles only if you need
   them: `supabase db dump --linked -f supabase/qa/prod-schema.sql` and
   `supabase db dump --linked --role-only -f supabase/qa/prod-roles.sql`.

## The one thing that may touch prod

Read-only catalog introspection: `has_table_privilege`, `has_function_privilege`, `pg_policies`,
`pg_proc`, `pg_get_functiondef`. No writes, no RPC calls, no `SELECT *` over user tables.

**Everything else is local.** If a finding genuinely cannot be established locally, mark it
`needs runtime check` and say so. Do not reach for prod to close the loop.

## Prohibited against the hosted project

Never, regardless of how the finding is phrased or how confident the reasoning is:

- Any `INSERT` / `UPDATE` / `DELETE`, including a fixture you intend to clean up afterward.
- Any RPC invocation, even one expected to fail authorization. `fire_worker` and
  `lock_block_coverage` do damage on the paths that succeed, and you cannot know which those
  are before calling.
- Any orchestrator tick, force-trigger, or cron invocation.
- Any `supabase db reset`, `supabase db push`, or migration apply.

If a probe seems to require one of these against prod, that is the signal to stop and ask the
user, not to find a safer-looking variant of it.

## Everything else

Batching, parallelism, slice definitions, calibration from pass 1, the known-open findings that
must not be re-filed, and the retraction lesson are unchanged. Read
`HANDOFF-slices-3-15.md` and apply all of it, substituting this file's setup and prohibitions
for its `supabase status || supabase start` precondition.
