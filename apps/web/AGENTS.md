<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# apps/web/ — Next.js Admin and Worker Portal

Everything above this line is managed by Next.js tooling; leave it alone. Everything below is
this project's guidance, and assumes you have read the root `AGENTS.md`.

This is the **admin** surface (SM / RSM / HM / BM / admin) plus a worker portal. The mobile
app is worker-only, so any manager-facing capability lands here first.

## Cross-house write paths

The elevated tier (HM, BM, RSM) may modify **any** house's schedule; SM is own-house
everywhere. This is easy to get wrong, because the acting admin's own house is rarely the
house being edited.

**Always target the viewed house, never the actor's own:**

- Pages: `writeHouseId(user, requested, validHouseIds)` (schedule-builder, preferences).
- Actions: `canBuildForHouse(user, houseId)` (builder publish, override `authorizeForBlocks`,
  force-trigger).

Both live in `lib/auth.ts`. The house switcher unlock and `canViewOtherHouses` take an
`isScheduleAdmin` flag (hm/bm/rsm). The force-trigger EF and validator take an
`isScheduleAdmin` initiator flag.

**People admin, HM leave, and weekly cap stay own-house** for hm/bm/rsm, gated by
`user_has_house_admin_role`. Do not widen that branch. The top-level `admin` role is the one
exception. See `supabase/AGENTS.md` for the full predicate table.

`/admin/operations` and `/admin/launch` are admin-gated (`isAdmin`).

## House context

House context persists across navigation via `?house=` on every nav link. People and Hours
follow cross-house selection **only** for an admin or an on-duty HMOD.

The house tab is the **Excel-style week grid** (`buildHouseGridWeek`, frozen rail). This is
settled; do not reintroduce the day-roster layout. If the grid renders sparse chips, suspect
the PostgREST 1000-row cap, not the layout.

## Performance

From the 2026-07-29 perf audit (`docs/performance/WEB_NAVIGATION_PERF.md`), which found the
region move alone cut the per-query floor 130ms → 49ms and the query-shape work cut `/calendar`
2.2s → 0.53s on top of that. Two of these are now hooks (`loading-state-guard.js`,
`supabase-getuser-guard.js`); the rest are judgment calls a hook cannot make.

- **When something feels slow, measure database execution time and round-trip time
  separately before proposing a fix.** `EXPLAIN (ANALYZE)` against the project vs. wall-clock
  time of the same request from the app. The audit's headline finding: Postgres executed an
  entire calendar week's query set in 3.9ms while the page took 1,326ms — 99.7% was round
  trips, not query cost. Optimizing the SQL would have been solving the wrong 0.3%.
- **Batch independent server-side reads into one `Promise.all` wave; never sequence
  `await`s that don't depend on each other's result.** Each unbatched round trip against this
  project's hosted Supabase costs ~50-130ms, not microseconds. `getSessionUser()`,
  `getHouseCalendar()`, and `getBuilderData()` all had 6-10 sequential stages that were really
  2-3 dependency waves; restructuring to match the real dependency graph, not the order someone
  happened to write the code, was most of the win in the June audit.
- **A shared fetch helper that chunks a large `.in()` filter (`selectByBlockIdChunks`-shaped)
  is a single point where a sequential-await mistake silently taxes every caller.**
  `selectByBlockIdChunks` awaited each ~50-id chunk one at a time in a `for` loop; a calendar
  week was 5 chunks × 3 call sites = 15 serial round trips from that one helper alone. Bounded
  concurrency (`Promise.all` over a worker pool) fixed every caller at once. When you touch a
  helper like this, check whether it's iterating sequentially over something with no ordering
  requirement.
- **A process-wide cache (`lib/cache/ttl.ts`) must never be keyed on or derived from the
  signed-in user.** It exists only for data that is identical for every caller (house list,
  `system_config` rows, the dev sim-clock offset). Anything derived from `getSessionUser()`
  stays in React's per-request `cache()`, never a module-level memo — a cross-request cache of
  anything user-scoped is a straightforward authorization bug, not a performance one. This is
  also written as the load-bearing comment at the top of that file; keep it there if you edit it.
- **Verify a data-lifecycle claim ("immutable", "never edited", "append-only") against the
  actual migrations before caching or optimizing around it — do not infer it from what seems
  obviously true.** The audit's first cache design assumed a published past calendar week was
  immutable and safe to cache forever. Migration `20260729000001` (same day) had already
  removed that guarantee — SM/RSM/HM/BM/admin can now correct any past seat, unbounded. Caching
  on the wrong assumption would have shown a manager stale data seconds after they fixed a
  mistake. Cache by tag with invalidation on every write path that touches the data, not by TTL
  alone, for anything a human can edit.
- **`next build` can be silently broken for a long time if nobody runs it.** It was, here —
  `@napi-rs/canvas` (reached from `lib/kbIntakePipeline.ts`) fails Turbopack's production
  bundler, and every perf judgment up to that point had been made against `next dev`, which
  was barely slower than production once measured (dev 5.7s vs. prod 5.2s across 7 routes —
  framework overhead was never the story). Fix is `serverExternalPackages` in
  `next.config.ts`. Run `next build` occasionally, not only when something forces it.
  **If you build for verification while a `pnpm dev` server is running, use a separate
  `distDir`** (`distDir: process.env.NEXT_DIST_DIR ?? '.next'` in `next.config.ts`, or just
  don't build in place) — a prod build sharing `.next` with a live dev server mixes their
  artifacts and can leave the dev server serving a corrupted hybrid state.
- **A new hosted-Supabase project's compute region is a deploy-time decision with an
  outsized, easy-to-miss cost.** This project's DB sat in `us-west-2` while its users are on
  the US east coast: p50 130ms/query with a fat tail (max 977ms). Moving to `us-east-1` cut it
  to p50 49ms/max 98ms — pure geography, confirmed by `EXPLAIN ANALYZE` staying at 0.07ms
  server-side before and after. Check region against primary user geography before seeding a
  new project, the same way you'd check any other deploy-time config.
- Rows from a `SELECT` with no `ORDER BY` are not guaranteed stable between requests (seen on
  `preferences`; harmless today because both consumers key into a `Map`, but it means you
  cannot diff two payloads for equality without normalizing order first, and it would break an
  ETag/caching scheme that assumed stability).

## Known traps

- **Never send an `sb_` API key in BOTH `Authorization` and `apikey`.** Under the
  `sb_publishable_*` / `sb_secret_*` key format the gateway rejects two conflicting API keys
  with HTTP 401 `{"message":"Conflicting API keys"}` in ~2ms, before the Edge Function boots.
  A _user JWT_ in `Authorization` plus the publishable key in `apikey` is the supported
  pairing and is what every worker-facing call site does. Only a call that authenticates AS
  the system is affected: send the secret in `Authorization` **alone**, like the pg_cron
  caller does. This shipped in `lib/actions/devClock.ts` and meant the orchestrator had never
  once run against the hosted project.
- **A server action that reads fields off a response body without checking `res.ok` turns an
  auth failure into a plausible success.** The same action coerced that 401 into
  `0 scanned · 0 fired · 0 voided`, no errors, stamped with `new Date()` because the real
  `tickedAt` was absent. It looked exactly like a healthy tick with nothing to do. Discriminate
  on a field only a genuine response carries (here `tickedAt`), and report anything else.
- **`revalidatePath()` in a server action already re-renders the tree** and streams it back
  with the action result. Adding `router.refresh()` on the client is a second full RSC fetch of
  the same tree, so one button press costs two shell renders against a hosted database. Use one
  or the other.
- **PostgREST `db-max-rows` is 1000.** A query that silently truncates looks like a UI bug (a
  float appearing to no-op on acknowledge). Use bounded views for feeds.
- **URI too long:** a `.in()` filter with a few hundred ids returns HTTP 414. Use the shared
  `selectByBlockIdChunks` helper.
- **Edge runtime down means silent write no-ops.** If a write succeeds in-app but never lands
  in the DB, check `supabase_edge_runtime` (Exit 255); fix with `docker start edge_runtime`.
- **Rebuild `@shift/shared` after regenerating `database.types.ts`**, or the build fails on
  stale types.
- SM builder snapshots go through the service client deliberately; the switcher is the real
  gate.

## Size ceilings

`components/builder/ScheduleBuilder.tsx` (~1,570 lines) is over the 600-line ceiling and
quarantined: do not grow it. New surface goes in a new file, and when you make a substantial
change inside it, extract the section you touched on your way out. `KnowledgeIntake.tsx` and
`SeasonEditor.tsx` are approaching the same territory.

## Parity

`lib/workerColor.ts` has a Kotlin mirror at `apps/mobile/shared/.../house/WorkerColors.kt`. A
worker's colour is a pure hash of their `user_id` with no storage anywhere, so drift silently
recolours people on one platform only. `WorkerColorsTest` pins the Kotlin copy against
reference vectors generated from this file. If you change either, change
`docs/design/worker-colors.md` and both copies.

## Testing

Playwright for e2e. Playwright reuses a foreign server already on `:3000`; pin the port
explicitly (`PORT=3100 E2E_BASE_URL=... pnpm e2e:file`). Quad fixtures age out, so a suite
that passed last month may need fixture dates refreshed before you treat a failure as a
regression.
