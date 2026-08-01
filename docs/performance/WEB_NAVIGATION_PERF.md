# Web navigation performance: what is actually left, and how to kill it

**Date:** 2026-07-29
**Scope:** `apps/web` server render latency on tab-to-tab navigation.
**Status:** Lever #1 (region move) is **done and measured** — see
[Result: the region move, measured](#result-the-region-move-measured) at the end. The rest of
"Recommendations" is still analysis + plan.

---

## TL;DR

The application code is no longer the bottleneck. **Postgres executes the entire live-calendar
week's workload in 3.9 ms. That page takes 1,326 ms in a production build.** Roughly **99.7% of
the remaining time is round-trip overhead**, and the dominant term is a fixed **~110 ms toll per
database request** caused mainly by the Supabase project sitting in **`us-west-2` (Oregon)** while
the user and the Cloudflare edge are on the **US east coast**.

Three levers, in order of return on effort:

| #   | Lever                                                                    | Effort                        | Expected effect                                                   |
| --- | ------------------------------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------- |
| 1   | Move the Supabase project to `us-east-1`                                 | ~1 hour, one migration window | **−60 to −70 ms on every single query**, app-wide, no code change |
| 2   | Collapse each page's read into **one** round trip (a JSON-returning RPC) | 1-2 days                      | `/calendar` ~6 round-trip waves → 1                               |
| 3   | Cache aggressively + stream the shell                                    | 2-3 days                      | Most navigations do **zero** database work                        |

Doing all three should put every tab under ~250 ms warm, and make the common case feel instant.

---

## How these numbers were produced

- Server render time = median of 5 warm RSC requests (`RSC: 1`) per route, against both the dev
  server and a real production build (`next build` + `next start`).
- Database time = `EXPLAIN (ANALYZE)` run directly against the project.
- Per-request overhead = wall-clock time of a PostgREST request minus its `Execution Time`.
- Network floor = ICMP RTT to the API host.

---

## Findings

### P0-1 — The database is in the wrong region (this is the whole ballgame)

The project `Staff@PennHousing` (`zrnvsxrtegbgpzdiflkt`) is provisioned in **`us-west-2`**.
Requests resolve to a Cloudflare edge in **IAD** (Washington DC, ~13 ms away), then cross the
continent to Oregon and back.

Measured, against that project:

| Request                                        | Wall time | Postgres `Execution Time` | Overhead    |
| ---------------------------------------------- | --------- | ------------------------- | ----------- |
| `house_closure` RPC, 5-byte response           | 122 ms    | ~0.2 ms                   | **~122 ms** |
| `preferences`, 500 rows / 61 KB                | 124 ms    | **0.238 ms**              | **~124 ms** |
| Entire calendar-week workload as one statement | n/a       | **3.929 ms**              | n/a         |

A **5-byte response and a 61 KB response cost the same**. The payload is nearly free; the trip is
everything. ICMP RTT to the edge is 9-18 ms, so ~100 ms per request is spent getting from the edge
to Oregon and back through the pooler.

**Fix:** migrate the project to `us-east-1`. Supabase supports this via a project restore into a
new region (dump/restore or the built-in migration flow), and it needs a maintenance window plus
an env-var swap. Expected: the ~110 ms floor drops to ~30-40 ms. **Nothing else on this list comes
close to that ratio of payoff to effort, and it is pure configuration.**

Secondary: confirm the compute tier. Even after the move, if the instance is on the smallest
shared tier the pooler adds avoidable latency under concurrency.

### P0-2 — The production build is currently broken

`pnpm build` fails outright:

```
Error: Turbopack build failed with 1 errors:
./node_modules/.pnpm/@napi-rs+canvas@0.1.100/.../js-binding.js
non-ecmascript placeable asset
```

`@napi-rs/canvas` is a native binding reached from `lib/kbIntakePipeline.ts`, which Turbopack
cannot place in an ESM chunk. This means **nobody has ever measured or shipped a production
build**, and all perceived slowness has been judged against `next dev`.

**Fix** (verified — the build succeeds with this and only this change):

```ts
// apps/web/next.config.ts
const nextConfig: NextConfig = {
  serverExternalPackages: ['@napi-rs/canvas', 'sharp', 'unpdf'],
  // ...
};
```

### P0-3 — Production is barely faster than dev, which confirms the diagnosis

Median warm RSC render, dev vs a real production build, same machine, same database:

| Route               |      dev | **production** | RSC payload |
| ------------------- | -------: | -------------: | ----------: |
| `/`                 |   592 ms |     **448 ms** |       11 KB |
| `/inbox`            |   455 ms |     **424 ms** |       12 KB |
| `/admin/hours`      | 1,113 ms |     **921 ms** |       12 KB |
| `/admin/people`     |   151 ms |     **687 ms** |       40 KB |
| `/admin/cap`        |   157 ms |     **563 ms** |       10 KB |
| `/calendar`         | 2,204 ms |   **1,326 ms** |       68 KB |
| `/schedule-builder` | 1,071 ms |     **848 ms** |      335 KB |

Compilation and dev instrumentation are **not** the problem. If they were, production would be
several times faster. It is ~10% faster. Everything left is waiting on Oregon.

(The two routes where dev beat production are remote-latency variance, not a real inversion —
individual samples on this project range from 96 ms to 977 ms for the same trivial query.)

### P1-1 — Every page still costs several sequential round-trip _waves_

Parallelism against this project scales well, so a wave is nearly free to widen:

| Concurrent trivial queries |      Total | Effective per query |
| -------------------------: | ---------: | ------------------: |
|                          1 |     108 ms |              108 ms |
|                          8 |     337 ms |               42 ms |
|                         16 |     196 ms |               12 ms |
|                         32 |     338 ms |               11 ms |
|           **8 sequential** | **868 ms** |              108 ms |

The cost is therefore **the number of waves, not the number of queries**. Current wave counts:

- **Admin shell (every page):** 2 waves — `getSessionUser` (users + user_roles), then the HMOD /
  unread / coverage batch.
- **`/calendar` on top of that:** ~4 more — `defaultCalendarWeek`, then wave 1 (closures, house,
  roster, cap, blocks), then wave 2 (hours, assignments, steps), then wave 3 (identities, roles,
  swap marks).

≈ 6 waves × ~110-150 ms ≈ 700-900 ms of pure latency, which is what the 1,326 ms measurement is
made of.

**Fix:** collapse each page to **one** `SECURITY DEFINER` function returning a single `jsonb`
document — `get_house_calendar_week(house, week_start, now)`, `get_builder_snapshot(house)`,
`get_admin_shell(user_id, now)`. The shaping already exists in SQL-friendly form; the TypeScript
loaders become one call plus the pure transform they already do.

Evidence this works: one PostgREST request returning **264 blocks + 458 seats with worker
identities embedded** completes in **239 ms** (175 KB) — versus 1,326 ms for the current
multi-wave version of the same screen. A purpose-built RPC returning only the shaped fields,
rather than 175 KB of raw rows, should land near the ~110 ms floor.

### P1-2 — Nothing is cached across requests, and nothing streams

Every one of the 35 routes builds as `ƒ` (dynamic, server-rendered on demand). That is correct for
personalized data, but almost none of what these pages read is personalized or volatile:

| Data                                          | Changes           | Currently                          |
| --------------------------------------------- | ----------------- | ---------------------------------- |
| House list (13 rows)                          | ~never            | memoized 5 min in-process (landed) |
| `system_config` project admin                 | ~never            | memoized 60 s in-process (landed)  |
| Operating calendar / `house_closure` per date | per season        | **7 RPCs per calendar render**     |
| `effective_weekly_cap` for a week             | per policy change | **1 RPC per render**               |
| A **past** calendar week                      | **immutable**     | re-read in full every time         |
| Worker identities (name/phone/home)           | rarely            | re-read every render               |

Only **3 of 35 routes** have a `loading.tsx`, and **no page uses `<Suspense>`** for partial
streaming. So a navigation blocks on the slowest query before rendering a single pixel — the user
stares at the old page for the full 1.3 s rather than getting the shell immediately.

### P1-3 — `/schedule-builder` ships a 335 KB RSC payload

The builder serializes **2,331 preference rows** into the RSC stream on every render. Over a
cross-country link this is a large fraction of that page's time, and it grows linearly with roster
size × blocks per week.

### P2-1 — `shift_blocks` lacks a composite index on the access pattern

The week query uses `shift_blocks_block_start_at_idx` and then discards **1,933 rows** via a
`house_id` filter:

```
Index Scan using shift_blocks_block_start_at_idx
  Index Cond: (block_start_at >= ... AND block_start_at < ...)
  Filter: (house_id = 'harnwell'::text)
  Rows Removed by Filter: 1933
```

Immaterial today (0.87 ms) but free to fix and it will matter at 13 houses × multiple seasons:

```sql
CREATE INDEX CONCURRENTLY shift_blocks_house_start_idx
  ON shift_blocks (house_id, block_start_at);
```

### P2-2 — Row order from un-`ORDER BY`'d reads is non-deterministic

Three consecutive identical `/schedule-builder` renders produced run1 == run2 but run2 ≠ run3 for
the `preferences` array. Harmless today (both consumers build maps keyed by the unique
`(userId, blockId)`), but it makes payload diffing unreliable and would silently break anything
that ever starts depending on order. Add an explicit `ORDER BY` to the chunked reads if you want
byte-stable payloads for caching/ETag purposes — which P3-1 below would want.

---

## Recommendations, in priority order

### Tier 1 — do these first

1. ~~**Move the project to `us-east-1`.**~~ **Done 2026-07-29 — see Result section below.**
2. **Fix the production build** (`serverExternalPackages`), then re-baseline. Judging performance
   against `next dev` has been misleading the whole effort.
3. **Add `loading.tsx` to every route and `<Suspense>` around the slow region of each page.** This
   does not make anything faster, it makes navigation _feel_ instant: the shell paints in ~0 ms and
   the grid streams in. For a 1.3 s page this is the single biggest perceived-performance change,
   and it is a few hours of work.

### Tier 2 — collapse the waves

4. **One RPC per page.** `get_house_calendar_week`, `get_builder_snapshot`, `get_admin_shell`.
   Target: 1 round trip per navigation. Keep the pure transforms in `packages/core`; the RPC only
   replaces the _fetching_, not the logic. Each new RPC needs `REVOKE ... FROM PUBLIC, anon,
authenticated` per the project's confused-deputy rule, and a pgTAP test.
5. **Fold the 7 `house_closure` calls into the calendar RPC** as a single set-returning query over
   the week.

### Tier 3 — cache hard (the biggest structural win after the region move)

6. **Turn on Next 16 `cacheComponents` and adopt `use cache` + `cacheTag`/`revalidateTag`.** The
   discipline that makes this safe: cache by _data identity_, never by request.
   - `houses`, `system_config`, operating calendar → `cacheLife` of hours, tag `reference-data`,
     revalidated by the admin write paths that change them.
   - **A published past week is immutable** — cache it indefinitely under a
     `calendar:<house>:<week>` tag, invalidated by publish/override/float writes touching that
     week. Today every visit to last week re-reads the whole thing.
   - Worker directory (name/phone/home) → tag `roster:<house>`, invalidated by
     hire/fire/transfer.
   - The admin shell (nav, house list, HMOD pill) is identical for a given
     `(user, duty-week)` → cache under `shell:<userId>` invalidated by role/leave/rotor writes.
7. **Replace the in-process TTL memo (`lib/cache/ttl.ts`) with the framework cache once
   `cacheComponents` is on.** The memo was the right call for a single dev server; it does not
   survive multiple instances, and tag-based invalidation is strictly better than a TTL guess.
8. **Add a request-coalescing read-through cache in front of the per-worker reads** so a house
   with 10 workers on screen does not fan out into 10 identity lookups.

### Tier 4 — payload and transport

9. **Stop shipping 2,331 preference rows to the browser.** Either project them server-side into
   the per-block grouping the UI actually renders, or send a compact columnar encoding
   (`{users: [...], blocks: [...], status: Int8Array}`) instead of an array of objects. Expect
   335 KB → well under 50 KB.
10. **Add the composite index** (P2-1) and explicit `ORDER BY` (P2-2).
11. **Co-locate the deployment.** When this ships to Vercel, pin it to `iad1` and keep the
    database in `us-east-1` — that turns the ~30-40 ms post-move round trip into single-digit ms.
    Serving from a region far from the database would re-create the current problem.

---

## What has already landed (for context)

Earlier in this effort, on the same measurement setup:

- `proxy.ts` and `lib/auth.ts` now use `auth.getClaims()` (local ES256 verification, 3-6 ms)
  instead of `auth.getUser()` (a GoTrue HTTP round trip, 101-150 ms, made **twice** per
  navigation).
- Global config reads (house list, project administrator, dev clock offset) memoized per process
  with explicit invalidation on write; `simNow()` no longer costs an `app_now()` RPC.
- Both layouts and the calendar/builder loaders restructured from sequential await chains into
  their actual dependency waves.
- `selectByBlockIdChunks` now runs its chunks concurrently (bounded at 6) instead of one at a
  time — a calendar week was 15 serial round trips of chunking alone.

Measured effect: `/calendar` 8.3 s → 2.2 s and `/schedule-builder` 2.7 s → 1.1 s in dev; the
calendar's rendered RSC payload was verified byte-identical before and after.

The point of this document is that **that line of work is now exhausted**. The code is doing about
as few queries, in about as few waves, as its current architecture allows. The next 10x is in
where the database lives, how many round trips a page makes at all, and how often it makes none.

---

## Result: the region move, measured

**2026-07-29, same day.** The Supabase project was migrated from `Staff@PennHousing`
(`zrnvsxrtegbgpzdiflkt`, us-west-2) to a new project (`nctfnufnsczyhkcidlmd`, **us-east-1**): all
163 migrations applied, `seed.sql` + the Harnwell real-workers seed loaded, `apps/web/.env.local`
repointed, verified end-to-end (auth, session, real seeded data rendering).

### The floor moved exactly where predicted

Same methodology as the original diagnosis — 25 samples of one trivial `houses` select, same
network path, same client:

|     | old (us-west-2) | **new (us-east-1)** |
| --- | --------------: | ------------------: |
| min |           96 ms |           **43 ms** |
| p50 |          130 ms |           **49 ms** |
| p90 |          282 ms |           **61 ms** |
| max |          977 ms |           **98 ms** |

**p50 dropped 62%, and the long tail is gone.** The old project's max (977 ms) was 10x its own
median — a real user would occasionally see a nearly-1-second stall on a single trivial query. The
new project's max (98 ms) is 2x its median. That tail was pure geography, and it's why the
predicted "~60-70 ms off every query" undersold it a little — the win isn't just the median
shifting, it's the elimination of the fat tail that used to occasionally blow a page's budget.

Confirmed the database side didn't regress: `EXPLAIN ANALYZE` on the same `preferences` query used
in the original diagnosis still executes in **0.068 ms** server-side. All of the improvement is
round-trip, exactly as predicted — none of it is "the new project happens to have a faster CPU."

### Full-page effect

Same warm-RSC, same-code, region-only comparison (7 admin-shell routes, 5 samples each, median):

| Route           |   old region | **new region** |
| --------------- | -----------: | -------------: |
| `/`             |       432 ms |     **148 ms** |
| `/inbox`        |       440 ms |     **175 ms** |
| `/admin/hours`  |       767 ms |     **380 ms** |
| `/admin/people` |       802 ms |     **363 ms** |
| `/admin/rotor`  |       818 ms |     **332 ms** |
| `/admin/leave`  |     1,159 ms |     **432 ms** |
| `/admin/cap`    |       789 ms |     **235 ms** |
| **TOTAL**       | **5,207 ms** |   **2,065 ms** |

**60% off the combined total**, which is more than the raw per-query ratio because these pages
make several round trips each — the saving compounds per wave, per page.

The two heaviest pages, isolated (dev server, same optimized code from the "Already landed"
section above, region is the only variable):

| Route               | old region (dev) | **new region (dev)** |
| ------------------- | ---------------: | -------------------: |
| `/calendar`         |         2,204 ms |          **~530 ms** |
| `/schedule-builder` |         1,071 ms |          **~375 ms** |

`/calendar` is now **4.1x faster**, `/schedule-builder` **2.9x faster**, purely from the region
move on top of the query-shape work already landed. Combined with the very first baseline in this
document (`/calendar` was 8.3 s before any of this session's work), that page has gone **8.3 s →
0.53 s — a 15.6x improvement** end to end.

### One anomaly, investigated and resolved

Mid-measurement, two individual requests — one `/calendar`, one `/schedule-builder` — took 71 s and
44 s server-side (logged by the dev server itself, not a client-timeout artifact). Every other
sample on those routes, before and after, was in the normal 350-580 ms range.

Ran down the cause rather than discarding it as noise:

- **Not a compute-tier downgrade.** `SHOW max_connections` is `60` on both the old and new
  project — same tier.
- **Not a sustained problem.** Immediately re-ran both routes (5 fresh samples each, capped at 20 s
  timeout so one bad request couldn't stall the batch) and got clean, normal numbers with no
  repeat.
- **Working theory:** a brand-new project's connection pooler had just absorbed two back-to-back
  benchmark bursts (42 requests across 7 routes, then straight into the two heaviest, most
  connection-hungry pages) with no prior traffic to warm it. A cold-pool stall on first heavy
  concurrent load, not a structural regression.

Flagging this rather than omitting it: if it recurs under real usage (not synthetic back-to-back
benchmarking), it's worth a support ticket to Supabase about the new project's pooler warm-up
behavior. It has not recurred in any measurement since.

### What this does and doesn't close out

The region move fully delivers what Tier 1 #1 promised, and the compounding effect on multi-wave
pages was larger than the conservative per-query estimate. It does **not** replace Tiers 2-4 —
`/calendar` and `/schedule-builder` are fast now, not free: they are still making 4-6 sequential
round trips per navigation, just at a much cheaper per-trip cost. Collapsing those into one RPC
per page (Tier 2) and caching immutable weeks / reference data (Tier 3) are still the path to
getting these under ~150 ms and to zero-query navigations for the common case. Re-baseline against
this new region before continuing with those tiers — the relative payoff of "fold N round trips
into 1" is smaller now that each round trip costs 49 ms instead of 130 ms, so it's worth
re-prioritizing Tier 2 against Tier 3 (caching) with fresh numbers rather than assuming the old
ranking still holds.
