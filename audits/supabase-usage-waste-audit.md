# Supabase Usage / Cost Waste Audit

**Date:** 2026-07-26
**Branch:** `feat/ui-float-polish`
**Scope:** every metered Supabase axis — DB egress, query volume / compute, Realtime
messages and connections, Edge Function invocations, pg_cron + pg_net, Auth round trips,
and AI/embedding spend riding on DB paths.
**Posture:** read-only investigation. No source file was modified other than this document.
No DDL, no writes, no `db reset`.

**Measurement environment:** local Supabase (`postgresql://127.0.0.1:54322`), real seeded
data — 14 houses, 123 users, **35,290 `shift_blocks`**, **41,836 `shift_block_assignments`
of which 35,956 are `vacant`**, 10,315 `preferences`, 97 `kb_chunks`. Numbers labelled
**MEASURED** come from `EXPLAIN (ANALYZE, BUFFERS)` or `pg_stat_statements` on that data.
Numbers labelled **ESTIMATED** are derived by reading source and counting round trips.

**Two scale points are quoted throughout, per the agreed projection:**

- **Pilot** — Harnwell only (`launch_state = 'live'`), ~10-15 concurrent workers, 2-3 web
  admins. This is the state the seed reproduces exactly.
- **Full** — all 13 houses live, ~46 workers, a full semester of generated blocks.

---

## ⚠️ Read this before anything else

Nothing here is so severe that it must be fixed before this document is finished — the app
is not in production, and no meter is currently running. **But three findings would begin
burning money from the first hour of the Harnwell launch, and one of them (F-03) has an
unbounded, monotonically-growing cost curve that does not self-correct.** They are F-01,
F-02 and F-03. If the launch date is close, treat those three as the gate.

One further item is a **correctness** concern surfaced by the cost analysis, not a cost
concern per se, and it is flagged here because it changes what the "idle" cost of the
system actually is: **the orchestrator has no house-launch-state filter** (F-04). Under a
staggered launch, the 12 not-yet-live houses still have generated blocks whose seats are
100% vacant, and the orchestrator will scan them and fire escalation chain steps
(broadcast → float → Allied notify) against them every minute. That is both the dominant
idle cost and, plausibly, real Allied pages for desks nobody has launched. Worth a decision
before launch day regardless of the cost angle.

---

## 1. Executive summary — the five most expensive things at launch

| #    | Finding                                                                 | One-line cost mechanism                                                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-01 | `worker_open_shifts` is an unbounded CROSS JOIN over all future vacancy | One mobile read = **3,195 ms and 132,015 shared buffers (~1.03 GB of buffer traffic)** producing 16,359 rows, of which PostgREST discards 15,358 at the 1000-row cap. MEASURED.                                          |
| F-02 | Unfiltered Realtime subscription with an undebounced full refetch       | Every single `shift_block_assignments` row change anywhere in the system makes **every connected client re-run F-01 + F-05** (×2 concurrent collectors on iOS). A bulk write multiplies that by the number of rows.      |
| F-03 | `dispatch-push` failure is an infinite, unbounded retry loop            | `delivered_at` is only stamped on the success path; a throw (e.g. `FIREBASE_SERVICE_ACCOUNT_JSON` unset, which is a documented deploy-time requirement) re-POSTs that notification **every 60 s forever**, cumulatively. |
| F-04 | `orchestrator-tick` N+1 over vacant seats, with no launch-state filter  | **3 DB round trips per vacant assignment row per minute**, un-cached and un-deduped — ~60 rows in one measured 3h05m window ⇒ ~180 round trips/tick ⇒ ~260k round trips/day, almost entirely for unlaunched houses.      |
| F-05 | `worker_my_shifts` RLS predicate evaluates per row                      | **1,165 ms and 30,478 buffers** for 394 returned rows; the policy's `SubPlan 5` runs `loops=5261` and contains a **`Seq Scan on users`**. MEASURED. Rides on every F-02 refetch.                                         |

**Corroboration from real historical usage.** `pg_stat_statements` on this database, with
only development traffic, already ranks these at the top:

```
calls    total_ms   mean_ms   query
162704   1345621      8.27    realtime WAL decode  (SELECT wal->>$5 as type, ...)
   200    231153   1155.80    worker_open_shifts   (PostgREST)
   202    111064    549.80    worker_my_shifts     (PostgREST)
    29     25566    881.60    worker_open_shifts   (narrow column list)
    22     22006   1000.30    worker_my_shifts     (PostgREST)
```

The **single most expensive statement in the entire database is Realtime WAL decoding**, at
22.4 minutes of cumulative execution across 162,704 calls — on a dev box with one or two
clients. That is F-02's meter, already visible.

---

## 2. Caller inventory — every recurring or automatic caller

### 2.1 pg_cron jobs

Six jobs, all registered defensively behind `to_regprocedure('cron.schedule(...)')`.
**`pg_cron` is not installed on the local stack** (verified: `cron.job` does not exist;
`pg_extension` lists `pg_net` but not `pg_cron`), so **none of these has ever executed in
this environment.** Every cron cost below is therefore ESTIMATED from the function bodies,
not measured. That is itself worth flagging: the six schedulers are the least-exercised code
in the system and they are the ones that run 1,440 times a day.

| Job                       | Interval       | Registered at                                                                                        | Trigger condition | Idle cost (nothing to do)                                                                       | Busy cost                                                                    |
| ------------------------- | -------------- | ---------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `orchestrator-tick`       | `* * * * *`    | `20260528000002_phase_07_orchestrator.sql:90`                                                        | unconditional     | ≥7 DB round trips + 1 EF invocation, **plus 3 round trips per vacant seat in the 3h05m window** | grows with vacant seats × chain steps; float step adds ~4 queries per source |
| `deliver-notifications`   | `* * * * *`    | `20260601000001_phase_12_notifications.sql:327`                                                      | unconditional     | 1 seq scan of `notifications` (see F-08)                                                        | 1 `net.http_post` **per undelivered notification** ⇒ 1 EF invocation each    |
| `swap-expiry`             | `* * * * *`    | `20260530000001_phase_09_swaps.sql:575`, **re-registered** at `20260611000007_dev_sim_clock.sql:254` | unconditional     | 1 `UPDATE ... WHERE status='pending'`                                                           | one UPDATE                                                                   |
| `break-phase-transitions` | `*/15 * * * *` | `20260531000002_phase_11_break_claim.sql:542`                                                        | unconditional     | `execute_due_break_transitions()`                                                               | proportional to due breaks                                                   |
| `preference-reminders`    | `0 * * * *`    | `20260527000005_schedule_builder.sql:769`                                                            | unconditional     | scan of `scheduling_periods` with a deadline                                                    | notification insert per eligible worker                                      |
| `apply-house-transfers`   | `15 * * * *`   | `20260719000001_house_transfers.sql:527`                                                             | unconditional     | `apply_due_house_transfers()` scan                                                              | per-transfer reopen + float void                                             |

**Overlap risk.** `cron.schedule` in pg_cron does **not** prevent a second run from starting
while the first is still going. `orchestrator-tick` is the exposed one: `net.http_post` is
fire-and-forget, so the cron row completes instantly and cannot overlap itself, but the
**Edge Function invocations it triggers absolutely can** — F-04's measured per-tick work is
on the order of a second or more of DB time at pilot scale, and there is no advisory lock,
no `orchestrator_health.last_tick_at` guard, and no in-flight marker anywhere in
`supabase/functions/orchestrator-tick/index.ts`. Two concurrent ticks both scan, both
`loadProfileForBlock`, both `loadStepStatus`. Correctness is protected (the step claims use
`block_step_status` upserts and `FOR UPDATE` RPCs), but **the cost is duplicated.**

**Dev-only cron shipping to production:** `20260611000007_dev_sim_clock.sql` lives in
`supabase/migrations/` and will apply to every environment. It does not add a new cron; it
**replaces** the `swap-expiry` job so the UPDATE reads `app_now()` instead of `now()`
(`:254-258`). Cost impact is negligible (`app_now()` is called once per statement, not per
row — verified: it appears in the `WHERE` as a scalar), but it means the simulated-clock
surface is live in production. See F-15.

### 2.2 Realtime subscriptions

Only two tables are in the publication, both with `REPLICA IDENTITY FULL` (verified against
`pg_publication_tables` and `pg_class.relreplident`):

| Table                     | Replica identity | Subscribed by                                                                                                                      | Server-side filter     |
| ------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `shift_block_assignments` | FULL             | `WorkerShiftsRepository.kt:786-791` — **1 channel per collector**; Android 1 collector, **iOS 2** (`ContentView.swift:58`, `:122`) | **none**               |
| `notifications`           | FULL             | `WorkerShiftsRepository.kt:1006-1011`                                                                                              | **none** (INSERT only) |

`REPLICA IDENTITY FULL` means the WAL carries the **entire old row** on every UPDATE and
DELETE, not just the key. That is the direct input to the 1.35-million-ms WAL-decode
statement above, and it doubles the bytes Realtime must decode and RLS-check per change.

No web surface subscribes to Realtime at all (grep for `channel(`/`postgresChangeFlow` under
`apps/web` returns nothing) — see §6.

### 2.3 Client polling

| Location                                               | Interval | Gate                                                                    | Cost per fire                                                      |
| ------------------------------------------------------ | -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/web/components/knowledge/KnowledgeIntake.tsx:85` | **3 s**  | `inFlight` — only while a KB doc is mid-pipeline                        | full `router.refresh()` ⇒ whole RSC tree re-renders and re-queries |
| `apps/web/components/builder/AiSchedulePanel.tsx:106`  | timer    | AI generation in flight                                                 | UI-only elapsed tick (verified: no fetch)                          |
| `apps/web/components/DevClockCard.tsx:69`              | timer    | dev clock card mounted                                                  | UI-only tick                                                       |
| `apps/web/components/knowledge/KnowledgeIntake.tsx:97` | 1 s      | `isUploading`                                                           | UI-only `setNow` tick                                              |
| `apps/mobile` — **none**                               | —        | grep for `setInterval`/timer-driven refetch in `apps/mobile` finds none | mobile is push-driven via Realtime only                            |

Mobile has **zero** polling. That is correct and deliberate; the cost is all in F-02 instead.

### 2.4 Edge Function → DB fan-out

Counted by grepping `.from(` + `.rpc(` per function. The user-action functions are
genuinely lean and I want that stated plainly rather than left as a silent gap:

| Function                | DB round trips                             | Verdict                                            |
| ----------------------- | ------------------------------------------ | -------------------------------------------------- |
| `drop-shift`            | 1                                          | thin wrapper over one RPC — correct                |
| `acknowledge-float`     | 1                                          | correct                                            |
| `claim-shift`           | 2                                          | correct                                            |
| `break-claim`           | 3                                          | correct                                            |
| `accept-swap`           | 4                                          | correct                                            |
| `create-swap`           | 6                                          | acceptable (validation reads)                      |
| `permanent-pickup`      | 6                                          | acceptable                                         |
| `da-ask`                | 6-9 + 1 Voyage embed + 1-2 Anthropic calls | see F-17                                           |
| `dispatch-push`         | 5                                          | correct shape, **but see F-03 for the retry loop** |
| **`orchestrator-tick`** | **unbounded**                              | **see F-04** — the only function with an N+1       |

**No client invokes more than one Edge Function per user action.** I checked the mobile
write paths (`WorkerShiftsRepository` claim/drop/ack) and the web server actions; each maps
to a single EF call. That class of waste is absent.

---

## 3. Findings

Severity is (money at launch) × (growth rate), not (how wrong it looks).

---

### F-01 — `worker_open_shifts` is an unbounded CROSS JOIN over all future vacancy

**Severity: Critical**
**Meters: DB egress · query volume · compute**

**Evidence.** `supabase/migrations/20260724000004_permanent_occurrence_weekly_claim.sql`:

- `:74-104` — CTE `vacant_seats` selects **every** `shift_block_assignments` row with
  `status = 'vacant'` and `sb.block_start_at > now()`. There is **no upper time bound and no
  house filter.**
- `:132` — CTE `candidate_users` selects every active `sw`/`sm`/`hm`.
- `:190` — `CROSS JOIN candidate_users cu`
- `:194` — the **only** join predicate is the Harnwell training constraint:
  `WHERE ob.house_id <> 'harnwell' OR cu.home_house_id = 'harnwell'`.

So the view's logical cardinality is `|open_blocks| × |candidate_users|`. On the seeded data
that is 35,956 × ~46 ≈ **1.65 million rows**.

This is long-standing, not a recent regression: `CROSS JOIN candidate_users cu` is present in
every revision of the view — `20260605000001_worker_read_model_views.sql:143`,
`20260617000004:129`, `20260627000001:327`, and the current `20260724000004:190`. It has
simply never been measured against a full schedule.

**Measured cost, as one real Harnwell worker under RLS** (`SET ROLE authenticated` with a
matching `request.jwt.claims`), reproducing exactly the query
`WorkerShiftsRepository.kt:753-763` issues:

```
Sort  (actual rows=16359)  Buffers: shared hit=132015
  -> Nested Loop Semi Join (actual rows=16359)
       -> Hash Join (actual rows=16359)
            -> Seq Scan on shift_block_assignments (actual rows=35956)
Execution Time: 3194.945 ms
```

**With PostgREST's `LIMIT 1001` applied** (`supabase/config.toml:18` sets `max_rows = 1000`):

```
Limit (actual rows=1001)   Buffers: shared hit=132015
  -> Sort (actual rows=1001)
       -> Nested Loop Semi Join (actual rows=16359)
Execution Time: ~1490 ms
```

The `LIMIT` caps **egress** but not **compute**: all 16,359 rows are still materialised and
sorted, and 15,358 of them are computed and thrown away. Buffer traffic is identical at
132,015 either way — roughly **1.03 GB touched per single read.**

Per-row correlated work compounds it: `regular_school_year` and `weekly_visible` are `EXISTS`
subqueries over `operating_calendar`/`break_periods` evaluated per vacant seat, the latter
calling `break_claim_phase(bp.break_id, now())` per row; and `:161-163` re-scans
`shift_block_assignments` a second time per row to count permanent-drop occurrences, using
`EXTRACT(isodow FROM ... AT TIME ZONE ...)` — non-sargable, so no index can serve it.

**Growth curve.** For one user the cost is O(all future vacant seats across all houses). At
**pilot**, that is the measured 16,359 rows / 3.2 s — and it is _worst-case at pilot_,
because the 12 unlaunched houses contribute 100%-vacant blocks that no Harnwell worker can
ever claim. At **full** scale, per-house vacancy falls as schedules get published, but the
number of live houses and the semester depth both rise; the honest projection is
**same order of magnitude, not better** — 10k-20k rows and 1-3 s per read — and it is
multiplied by 46 workers instead of 12.

**Disproof attempted.** Is it cached? No — PostgREST issues it fresh per request; there is
no materialised view, no `pg_cron` refresh, no HTTP cache header on the mobile path. Is it
bounded? The client adds `gte("start_at", windowStart)` where `windowStart` is _Monday of
last week_ (`WorkerShiftsRepository.kt:740`, `navigableWindowStart` `:712-716`) — that is a
**lower** bound only, and the code comment at `:730-732` explicitly documents that a second
filter on the same column is dropped by supabase-kt, so **there is deliberately no upper
bound.** Is the CROSS JOIN optimised away? No — the planner pushes the `eligible_user_id`
predicate into a semi-join, which is why it is 16,359 rows and not 1.65 M, but the
`Seq Scan on shift_block_assignments (rows=35956)` underneath is real and measured.
The finding stands.

**Fix direction (sketch only).** Two independent levers. (a) Give the view a hard upper time
bound — the client only ever navigates last-week…+4, so a `block_start_at < now() +
interval '5 weeks'` in `vacant_seats` would cut the row count by roughly the ratio of the
navigable window to the remaining semester, without changing any eligibility semantics.
(b) Restructure so eligibility is a predicate rather than a product: the `CROSS JOIN` exists
only to project the Harnwell rule and `home_house` onto each row, and both are computable
from a single `eligible_user_id` parameter — a set-returning function taking the user id, or
an RLS-scoped view keyed on `auth.uid()`, would evaluate the Harnwell rule once instead of
once per (block × user) pair. **Note (b) touches the Harnwell training invariant's read-path
expression** — it must stay exactly equivalent, and the pgTAP coverage in
`supabase/tests/` is the guard. See also the deliberate-and-correct list: the
**dual-emission of permanent-drop occurrences is intentional** and must survive any rewrite.

---

### F-02 — Unfiltered Realtime subscription triggers an undebounced full refetch

**Severity: Critical**
**Meters: Realtime messages · concurrent connections · query volume · egress**

**Evidence.**
`apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/data/WorkerShiftsRepository.kt`:

```kotlin
786  val channel = supabase.channel("worker-shifts-$userId-${Random.nextLong()}")
787  val changes =
788      channel.postgresChangeFlow<PostgresAction>(schema = "public") {
789          table = "shift_block_assignments"      // <- no filter, no event-type narrowing
790      }
791  channel.subscribe()
792  try {
793      changes.collect { emit(fetchWorkerWeek(userId, now)) }   // <- no debounce, no coalesce
```

`fetchWorkerWeek` (`:736-766`) issues **two** queries, both with a bare `.select()` (i.e.
`select *` on a wide view): `worker_my_shifts` (F-05: 1,165 ms / 30,478 buffers) and
`worker_open_shifts` (F-01: 1,490-3,195 ms / 132,015 buffers).

**So one Realtime event costs ≈ 2.7 s of DB time and ≈ 162,000 buffer hits (~1.3 GB of
buffer traffic) per subscribed client.** MEASURED, by summing the two measured plans.

**Collector count.** iOS runs **two** independent collectors —
`apps/mobile/iosApp/iosApp/ContentView.swift:58` (Shifts) and `:122` (Calendar) — each
opening its own channel (the `Random.nextLong()` topic suffix at `:786` guarantees they do
not share). The Calendar collector additionally issues `fetchPendingSwaps()` **inside the
loop** (`ContentView.swift:~124`), a third query per event. **An iOS client therefore holds
2 Realtime connections and performs 5 queries per event.** Android holds 1 and performs 2.

**Blast radius.** With N connected workers in the system, one `shift_block_assignments` write
produces N Realtime deliveries and, on iOS, **2N refetch cycles = 5N queries**. At **pilot**
(12 iOS workers) a single claim costs ~60 queries and ~30 s of aggregate DB time. At **full**
(46 workers) it is ~230 queries and ~2 minutes of aggregate DB time — **for one person
claiming one shift.**

**Bulk-write detonation.** The write amplifiers are the real hazard, because there is no
coalescing anywhere in the chain:

- `publish_schedule` stamps a template week across a whole semester
  (`20260614000002_publish_recurring_weekly_pattern.sql:125-170`: an `UPDATE` plus two
  `INSERT`s per block).
- `apply_compiled_season` reconciles every future block **row by row inside a PL/pgSQL loop** —
  `20260709000003_season_downsize_cancel_excess.sql:265`, `:272`, `:280`, `:294` are each
  `UPDATE ... WHERE block_id = v_blk.block_id` inside `FOR v_phase`/`FOR v_house` loops.
- Block generation (`20260527000004_shift_blocks_calendar_generation.sql:277`).

On the seeded data a summer season spans ~35,000 blocks. Each assignment row touched emits a
WAL record (with the **full old row**, per `REPLICA IDENTITY FULL`), which Realtime decodes,
RLS-checks per subscriber, and delivers. **Every delivery a client receives triggers another
2.7 s refetch, with no debounce window and no backoff.** A season apply during business hours
would put the database into a sustained refetch storm for as long as the fan-out takes to
drain, and the storm _is_ the failure mode described in the brief: a small-looking admin
action causing an unbounded recomputation.

**Disproof attempted.** _Is it filtered server-side?_ No — `schema = "public"`, `table =
"shift_block_assignments"`, nothing else. `apps/mobile/AGENTS.md` documents this as
deliberate ("RLS scopes rows to the authed worker and any change triggers a refetch"). RLS
does scope the _payload_, so a worker does not learn about other workers' rows — but the RLS
evaluation itself is per-subscriber-per-change server-side work, and the refetch it triggers
reads the worker's _entire_ window regardless of what changed. _Is there a lifecycle gate?_
Android yes — `collectAsStateWithLifecycle` (`MainActivity.kt:353`) stops collection below
STARTED. **iOS no** — `activateLive` (`ContentView.swift:52-68`) starts a raw `Task`, the
`scenePhase` handler at `iOSApp.swift:169-178` only re-syncs the sim clock and never cancels
`liveTask`, and `liveTask?.cancel()` appears only in `deinit` (`:81-83`). _Is there a
debounce?_ No — `changes.collect { emit(...) }` is 1:1. _Does the app at least reuse one
channel?_ No — the `Random.nextLong()` suffix is a deliberate fix for a supabase-kt crash and
guarantees one channel per collector. The finding stands on all counts.

**Fix direction (sketch only).** Three separable moves, in increasing order of risk.
(i) **Debounce/conflate the refetch** — collect the change flow through a
`debounce(~300-500 ms)` + `conflate()` so a 35,000-row bulk write produces one refetch per
client rather than thousands. This is pure client-side and touches no invariant.
(ii) **Narrow what a change means** — the flow currently accepts every `PostgresAction`;
most schedule churn a worker cares about is INSERT/UPDATE on rows that are already theirs,
and the notifications channel already carries the "something happened to you" signal.
(iii) **Give iOS a foreground gate and a single shared collector** so it stops paying 2×.
None of these collide with a documented invariant — the mobile client is explicitly told to
consume server-authoritative claimability rather than re-derive it, and debouncing a refetch
does not change what the server says. The one thing to preserve is that a float assigned at
T-2h must still surface promptly; a sub-second debounce does not threaten that.

---

### F-03 — `dispatch-push` failure is an unbounded, permanent retry loop

**Severity: Critical**
**Meters: EF invocations · pg_net · query volume**

**Evidence.** The delivery contract is: `deliver_pending_notifications()` selects everything
still undelivered and fires one `net.http_post` per row
(`20260601000001_phase_12_notifications.sql:260-276`), once a minute. A notification leaves
that set **only** when `delivered_at` is stamped, which happens **only** at
`supabase/functions/dispatch-push/index.ts:181-184`, the last statement of the handler.

Before it, at `:153-166`:

```ts
153  if (attemptedTokens.length > 0) {
154    const messaging = firebaseMessaging();      // <- throws if env is missing
155    for (const batch of chunk(attemptedTokens, TOKEN_BATCH_SIZE)) {
156      const result = await messaging.sendEachForMulticast({ ... });
```

and `firebaseMessaging()` at `:39-48`:

```ts
41    const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
42    if (serviceAccountJson === undefined) {
43      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured');
```

**There is no `try`/`catch` around `:153-178`.** The throw propagates out of `Deno.serve`,
the function 500s, `deliver_notification` at `:181` never runs, `delivered_at` stays NULL,
and the notification is re-selected and re-POSTed **60 seconds later, forever.**

There is no attempt counter, no dead-letter column, no backoff, and no cap on
`pending_notification_deliveries` (`:71-95`).

**Why this is not theoretical.** `FIREBASE_SERVICE_ACCOUNT_JSON` is listed in
`supabase/AGENTS.md` under "Required deploy configuration" as something every environment
**must** set or "behavior silently degrades". It is exactly the kind of secret that is missing
or wrong on day one of a new project. And the guard at `:153` means the loop triggers
**only for users who have successfully registered a push token** — i.e. precisely the real,
launched users, never the empty test accounts.

**Cost curve.** Let `U` = notifications stuck undelivered. Each minute costs `U` pg_net
requests, `U` Edge Function invocations, and `~4U` DB queries (the EF does 4 reads before the
throw). `U` **only ever grows**, because every new notification joins the stuck set.
At **pilot**, a Harnwell evening producing 20 notifications with Firebase misconfigured
reaches 20 × 1,440 = **28,800 EF invocations on day 1**, 57,600 on day 2 (day-1 backlog plus
day-2's own), and so on — a triangular growth curve. At **full** scale multiply by ~13.
This is the only finding in this document whose cost does not stabilise.

**Disproof attempted.** _Does the re-check suppress it?_ No — the `pending_notification_
deliveries` re-check at `:117-126` returns the row (it is genuinely still pending), so the
handler proceeds to the throw. _Does the "already delivered" early-out at `:102-104` help?_
No — `delivered_at` is null by construction. _Is there a token-less escape?_ Yes, and it
works: with zero tokens the `if` at `:153` is skipped and `:181` stamps the row — which is
exactly why the loop is invisible in any test environment without registered devices, and
appears only in production. _Is at-least-once delivery the intended behaviour here?_ The
documented intent (`supabase/AGENTS.md`, "Notifications") is that a notification whose
dispatch _straddles a minute boundary_ may push twice. That is a bounded, once-or-twice
duplication and it is correct. **An unbounded loop on a hard failure is a different thing and
is not what that decision sanctioned.**

**Fix direction (sketch only).** Add failure accounting without weakening the at-least-once
guarantee: an `attempt_count` + `last_attempt_at` on `notifications`, incremented by the EF
in a `catch`, with `pending_notification_deliveries` applying exponential backoff on
`last_attempt_at` and excluding rows past a generous ceiling into an operator-visible
dead-letter state. Critically, **`delivered_at` must still not be stamped before the send** —
that is the documented invariant and it stays. The fix is to stop _re-selecting_ a
known-failing row every 60 s, not to pretend it succeeded.

---

### F-04 — `orchestrator-tick` N+1 over vacant seats, with no house-launch filter

**Severity: Critical**
**Meters: query volume · compute · EF invocations**

**Evidence.** `supabase/functions/orchestrator-tick/index.ts`:

- `:939-949` — `processVacantBlocks` selects every `vacant` assignment whose block starts
  within `LOOKAHEAD_MINUTES` (3h05m, `:4`). **No `house_id` filter. No launch-state filter.**
- `:964` — `for (const row of data ?? [])` iterates **assignment rows**, not distinct blocks.
- `:981` — `loadProfileForBlock(supabase, block.blockStartAt)` — **2 queries**
  (`operating_calendar` then `operating_profiles`, `:304-318`), **with no memoisation**. Every
  row in the window resolves to the same one or two NY dates, so these two queries are
  re-issued near-identically for every row.
- `:986` — `loadStepStatus(supabase, block.blockId)` — **1 more query per row.**

That is **3 DB round trips per vacant assignment row, every minute, before any step fires.**

**Measured window size.** Reproducing the `:939-949` query against the seed at a populated
timestamp:

```
EXPLAIN (ANALYZE, BUFFERS) ... block_start_at > '2026-07-15 18:00' AND <= '2026-07-15 21:05'
  -> Bitmap Index Scan on shift_blocks_live_idx (rows=60)
Execution Time: 476.147 ms
```

**60 vacant rows in one 3h05m window** ⇒ **~180 extra round trips per tick** ⇒
**~259,000 round trips per day**, plus 1,440 EF invocations, plus the scan itself.
MEASURED (row count and scan time); the multiplication is arithmetic.

**The launch-gate gap.** `grep -n "launch" supabase/functions/orchestrator-tick/index.ts`
returns **nothing**. The gate exists — `houses.launch_state`, `house_is_live(p_house_id)`,
`is_staggered_launch_enabled()` in `20260712000001_house_launch_state.sql:21-60` — and the
orchestrator never consults it. Under a staggered launch the 12 pre-launch houses still have
generated blocks whose seats are **100% vacant** (verified in the seed: `du-bois`, `gutmann`,
`hill`, `lauder`, `mayer` etc. show `blocks = seats = vacant`, while `harnwell` shows
1,995 seats / 60 vacant). **Essentially the entire 180-round-trip-per-minute cost is being
spent on houses that are not live** — and, since the chain steps are not gated either, those
blocks will also fire `broadcast` → `float_lookup` → `hmod_notify_allied` against unlaunched
desks. That second consequence is a correctness question, flagged at the top of this
document, not something to resolve inside a cost audit.

**Growth curve.** Linear in (houses × vacant seats per 3-hour window). **Pilot: ~180
round-trips/tick, ~95% of it wasted on pre-launch houses.** **Full: 12/13 of that waste
converts into real work as houses go live**, so the number does not fall — it stays at
roughly 180 and becomes legitimate. The waste is a launch-window problem specifically, which
is the window this audit exists for.

**Secondary N+1s inside the same function**, all real but smaller:

- `:534` — `loadVacantGap` calls `loadCoveredBlockIds` on the gap's blocks, but
  `processVacantBlocks` already called it at `:959` for the whole window. **The same rows are
  read twice per tick.**
- `:595-697` — `buildFloatLookupSnapshot` issues **4 queries per source route** (source rows,
  `users`, `user_roles`, conflict rows). Under the documented summer universal all-pairs
  routing that is up to 12 sources for one destination ⇒ **~48 queries for one `float_lookup`
  step**, and `users`/`user_roles` are re-read per route for overlapping candidate sets.
- `:1107-1153` — `processNoAckFloats`; broken out separately as F-06.

**Disproof attempted.** _Is `loadProfileForBlock` cached?_ No — it is a plain `async function`
called inside the loop with no memo, and `operating_calendar`/`operating_profiles` are read
fresh each time. _Does the covered-block skip at `:965` short-circuit the 3 queries?_ Yes, and
that is a genuine mitigation — but it only helps blocks whose desk is _already staffed_. A
pre-launch house's blocks are entirely vacant, so **none of them are skipped**; the skip is
exactly inoperative in the case that matters. _Are the per-row queries at least indexed?_
Yes — `operating_calendar_pkey` on `date`, `block_step_status_pkey` on `(block_id, step_name)`.
They are cheap individually; the cost is 180 round trips of latency and connection churn per
minute, not per-query time.

**Fix direction (sketch only).** Three cheap, invariant-safe moves. (i) **Join the launch
gate into the scan** at `:939-949` so pre-launch houses are excluded — this is the single
biggest win and it also resolves the correctness concern. (ii) **Memoise
`loadProfileForBlock` per NY date within a tick** — a `Map<string, Profile>`; the window spans
at most two dates. (iii) **Batch `loadStepStatus`** into one `.in('block_id', chunk)` over the
window's distinct blocks, reusing the existing `CHUNK = 100` pattern already present at
`:466-468`. None of these change _which_ steps fire or _when_: the chain evaluation at
`:987-992` is unchanged, so escalation timing, the coverage floor, and the one-way pickup lock
are all untouched. **Do not** "optimise" by widening `LOOKAHEAD_MINUTES` or by skipping the
`loadCoveredBlockIds` call at `:959` — that call is what enforces the coverage-floor-of-one
invariant.

---

### F-05 — `worker_my_shifts` RLS predicate is evaluated per row, with a seq scan inside it

**Severity: High**
**Meters: compute · query volume**

**Evidence.** Measured as a real worker under RLS:

```
Sort (actual rows=394)   Buffers: shared hit=30478
  ...
  SubPlan 5
    -> Index Scan using shift_blocks_pkey (actual rows=1 loops=5261)
         Filter: (hashed SubPlan 4) OR user_can_build_schedule(...)
         Buffers: shared hit=16570
         SubPlan 4
           -> Seq Scan on users (actual rows=1 loops=1)
                Rows Removed by Filter: 122
                Buffers: shared hit=771
Execution Time: 1164.986 ms
```

**1,165 ms and 30,478 buffers to return 394 rows.** `SubPlan 5` — the house-admin arm of the
`shift_block_assignments` SELECT policy — executes **5,261 times**, consuming 16,570 of those
buffers. `user_can_build_schedule` is a `SECURITY DEFINER` helper invoked per row.

The view itself (`security_invoker=true`) also carries a correlated `EXISTS` over
`operating_calendar ⋈ break_periods` per output row to compute `break_shift`.

`pg_stat_statements` confirms the steady-state: **202 calls, 549.8 ms mean**, and a second
shape at **22 calls, 1000.3 ms mean**.

**Growth curve.** The `loops=5261` figure tracks the number of candidate assignment rows
scanned before filtering, which grows with **the worker's own accumulated schedule history**,
because the client's only bound is `start_at >= Monday-of-last-week` and there is no upper
bound. So this **worsens monotonically over a semester for every individual worker**,
independent of house count. Pilot ≈ 1.2 s; full-semester full-scale, extrapolating from the
5,261:394 ratio, plausibly 2-4 s.

**Disproof attempted.** _Is `auth.uid()` wrapped so it evaluates once?_ Partly — the plan
shows the JWT extraction inlined as `COALESCE(NULLIF(current_setting('request.jwt.claim.sub'
...)))` **inside the per-row filter**, not hoisted into an InitPlan. It is a `STABLE`
expression so Postgres _may_ fold it, but the measured plan shows it re-evaluated in the
`Filter` at `loops=5261`. _Is the expensive arm short-circuited for ordinary workers?_ The
policy is `own-assignment OR home-house OR house-admin` (documented as three OR-ed policies
in `supabase/AGENTS.md`), and Postgres does short-circuit `OR`, so a plain `sw` matching the
first arm should skip `SubPlan 5` — **but the measurement above was taken as a plain worker
and `SubPlan 5` still ran 5,261 times**, so the short-circuit is not happening in practice
here. That is the finding. _Is `SubPlan 4`'s seq scan on `users` avoidable?_ It is a
`hashed SubPlan` executed once (`loops=1`, 771 buffers) — real but not the dominant term.

**Fix direction (sketch only).** The standard Supabase remedy applies: wrap `auth.uid()` in a
scalar subselect — `(SELECT auth.uid())` — so the planner hoists it to an InitPlan and
evaluates it once per query rather than once per row, and mark the helper predicates `STABLE`
so they are cacheable within a statement. Separately, the three OR-ed policies could be
ordered so the cheap `user_id = auth.uid()` arm is the one the planner tries first.
**This must not collapse the three policies into fewer** — `supabase/AGENTS.md` is explicit
that the own-assignment clause is load-bearing for float-out and cross-house-pickup rows,
which attach to non-home-house blocks and would otherwise vanish from the personal calendar.
Rewriting the _expressions_ is safe; removing an _arm_ is a data-visibility bug.

---

### F-06 — `processNoAckFloats` scans every pending float every minute, then N+1s over them

**Severity: High**
**Meters: query volume · compute**

**Evidence.** `orchestrator-tick/index.ts:1107-1153`:

```ts
1107  const { data: floats, error } = await supabase
1108    .from('float_assignments')
1109    .select('float_id, destination_assignment_ids')
1110    .eq('status', 'pending')
1111    .is('acknowledged_at', null)
1112    .is('declined_at', null);
```

**No time bound whatsoever.** Then `:1119-1121` — for **each** returned float —
`loadAssignmentBlocks` issues another query (`:1063-1066`), and only _then_ is the
lookahead filter applied client-side at `:1128-1131`.

So the ordering is backwards: the cheap temporal filter that would eliminate almost every
row is applied **after** paying a round trip per row. The code comment at `:1104-1106` claims
it is a "pre-filter … by lookahead", which the query does not do.

**Index gap.** `pg_indexes` on `float_assignments` shows
`float_assignments_user_status_idx (user_id, status)` — leading column `user_id`, which this
query does not constrain. There is **no index on `status` alone**, so this is a seq scan of
`float_assignments` every 60 seconds.

**No retention.** `float_assignments.expires_for_cleanup_at` exists with a supporting index
(`20260528000001_phase_06_float_assignments.sql:16`, `:44`), but a repo-wide
`grep -rn "DELETE FROM float_assignments" supabase/ packages/ apps/` returns **nothing**. The
cleanup column was created and the cleanup job was never written. **The table grows forever
and this seq scan gets slower forever.**

**Growth curve.** Floats live in `pending` from assignment (T-2h) until acknowledged or
voided (T-15m), so the steady-state pending set at **pilot** is small (single digits) and at
**full** scale is perhaps 10-40 during peak escalation hours ⇒ 10-40 extra round trips per
minute ⇒ up to ~58,000/day. The seq scan itself, however, grows with the **all-time** float
count because of the missing retention.

**Disproof attempted.** _Does the status filter make it selective enough to not matter?_
Selectivity is fine; the problem is (a) the missing index makes it a seq scan regardless, and
(b) the N+1 is over the _selected_ rows, so selectivity does not help it. _Is the RPC at
`:1139` doing the real work anyway?_ It re-validates under `FOR UPDATE` (correctly), but it is
only reached after the per-row `loadAssignmentBlocks`, so the wasted round trip is already
spent. _Is the local `float_assignments` count of 0 evidence it is cheap?_ No — that is an
artefact of the seed having no floats, which is precisely why this has never shown up.

**Fix direction (sketch only).** Push the lookahead into SQL. The destination block start is
reachable via `shift_block_assignments.parent_float_id → float_assignments.float_id` (a true
FK per `supabase/AGENTS.md`), so a single joined query can return only the floats whose
earliest destination block starts within `noAckLookaheadMinutes`, eliminating both the scan
breadth and the N+1 entirely. Add a partial index on `float_assignments (status) WHERE
acknowledged_at IS NULL AND declined_at IS NULL`. Separately, write the missing retention job
against `expires_for_cleanup_at`. **None of this touches the no-takeback invariant** — the
`process_no_ack_float` RPC and its `FOR UPDATE` re-validation are unchanged; only the
_discovery_ of candidates gets cheaper.

---

### F-07 — Web `getSessionUser()` is not memoised: 3 Auth round trips + 4 DB queries per navigation

**Severity: High**
**Meters: Auth API · query volume · compute**

**Evidence.** `apps/web/lib/auth.ts:16-45`:

```ts
16  export async function getSessionUser(): Promise<SessionUser | null> {
17    const supabase = await createClient();
20    } = await supabase.auth.getUser();          // network round trip to GoTrue
23    const { data: profile } = await supabase.from('users')...
30    const { data: roleRows } = await supabase.from('user_roles')...
```

**Not wrapped in React `cache()`.** So every call = 1 GoTrue HTTP round trip + 2 DB queries.

It is called **84 times across the codebase**, and critically **both the layout and the page
call it on every render**: `apps/web/app/(app)/layout.tsx` and `apps/web/app/(app)/page.tsx`
both appear in the caller list, as do all 17 `(app)/admin/*` pages and all 8 `(worker)/home/*`
pages plus `(worker)/layout.tsx`.

On top of that, `apps/web/proxy.ts:33-35` calls `supabase.auth.getUser()` again on **every**
matched request, and the matcher (`:50-53`) is
`'/((?!_next/static|_next/image|favicon.ico|.*\\.svg).*)'` — i.e. everything including RSC
navigation payloads and API routes.

**Per page navigation, before a single byte of page data:**

| Layer  | GoTrue calls | DB queries |
| ------ | ------------ | ---------- |
| proxy  | 1            | 0          |
| layout | 1            | 2          |
| page   | 1            | 2          |
| **Σ**  | **3**        | **4**      |

**Growth curve.** Linear in navigations, **not** in data size — so it does not explode, but it
is a constant tax on every click by every admin, and `getUser()` is a _network_ call to the
Auth service, so it also adds latency to every page. At **pilot** (3 admins × ~200
navigations/day) ≈ 1,800 GoTrue calls + 2,400 DB queries/day. At **full** (~15 admins +
worker portal users) ≈ 5-10× that. Server actions add more: `kbIntake.ts` calls it 7 times,
`builder.ts` 5, `worker/swaps.ts` and `worker/shifts.ts` 4 each — each of those a fresh
GoTrue round trip **within a single action**.

**Disproof attempted.** _Does Next.js dedupe it automatically?_ No. Automatic request
deduplication in the App Router applies to `fetch()` calls the framework instruments; a
`supabase-js` call through `@supabase/ssr` is not deduped, and `getSessionUser` is a plain
async function with no `cache()` wrapper — verified by reading the whole function. _Is the
proxy call free?_ No — `createServerClient(...).auth.getUser()` contacts `/auth/v1/user` to
validate the JWT; that is the whole point of using `getUser()` rather than `getSession()`.
_Is the redundancy needed for the security model?_ The proxy call is needed (it is the
redirect gate). The **layout + page duplication is not** — they are in the same render pass
and want the same answer.

**Fix direction (sketch only).** Wrap `getSessionUser` in React's `cache()` so all callers
within one render pass share one result — a one-line change that removes 1 GoTrue call and 2
DB queries per navigation and, in the multi-call server actions, most of the rest.
`getSessionUser` is read-only and per-request, so `cache()` is semantically exact here. The
proxy's own `getUser()` should stay: it is the auth gate and its result is not shareable
across the proxy/render boundary. **The role-scoping logic must not be cached across
requests** — `cache()` is per-request, which is the correct granularity; a cross-request
cache would be a genuine authorization bug given `writeHouseId`/`canBuildForHouse` read from
this object.

---

### F-08 — `pending_notification_deliveries` is an unindexed seq scan every minute over a table with no retention

**Severity: High**
**Meters: compute · query volume**

**Evidence.** `20260601000001_phase_12_notifications.sql:71-95`:

```sql
78    SELECT notifications.*
79    FROM notifications
80    WHERE notifications.delivered_at IS NULL
81      AND (notifications.scheduled_for IS NULL OR notifications.scheduled_for <= p_now)
82      AND NOT ( ... NOT EXISTS (SELECT 1 FROM float_assignments ...) )
94    ORDER BY notifications.scheduled_for NULLS FIRST, notifications.notification_id;
```

`pg_indexes` on `notifications` shows only `notifications_pkey` and
`notifications_recipient_scheduled_idx (recipient_user_id, scheduled_for)`. This query has
**no `recipient_user_id` predicate**, so the composite index is unusable. **There is no index
supporting `delivered_at IS NULL`.** Seq scan, once a minute, plus a correlated `NOT EXISTS`
against `float_assignments` per candidate row.

`grep -rn "DELETE FROM notifications" supabase/migrations/` returns **nothing** — no retention,
no archival, no partitioning. The table only grows.

Two categories of row are permanently stuck in the scanned set:

1. **Suppressed ack reminders.** The `:82-93` clause excludes an `ack_reminder` whose float is
   no longer pending. Excluded means _never enqueued_, which also means **never stamped
   `delivered_at`**. Every acknowledged float leaves a permanent tombstone that the scan must
   re-filter every minute forever.
2. **F-03's failed deliveries**, which are also permanently `delivered_at IS NULL`.

**Growth curve.** O(all notifications ever created), scanned 1,440×/day. At **pilot** this is
trivial (5 rows locally). At **full** scale over one semester — 46 workers × escalation
chains, ack reminders, shift-cancelled and float-cancelled notices — a six-figure row count
is entirely plausible, at which point the every-minute seq scan becomes a standing compute
charge that nothing ever relieves.

**Disproof attempted.** _Is the table small enough not to matter?_ Today yes (5 rows), which
is exactly why it is invisible; the finding is about the growth curve, and the absence of any
retention mechanism is what makes the curve unbounded rather than steady-state. _Does the
`ORDER BY` at least use the existing index?_ No — the leading column of the only candidate
index is `recipient_user_id`, which the query does not filter or order by.

**Fix direction (sketch only).** A partial index — `ON notifications (scheduled_for)
WHERE delivered_at IS NULL` — converts the scan to an index scan over only the live queue, and
its size is bounded by the queue rather than by history. Then give the suppressed-ack-reminder
case a terminal state so those rows leave the partial index instead of accumulating in it
(a `suppressed_at` stamp, or stamping `delivered_at` on the suppression path — the latter is
safe here precisely because the row is being _deliberately not sent_, which is different from
F-03's "stamp before sending" prohibition). Add retention for delivered rows past a
sensible horizon.

---

### F-09 — Bulk write paths update row-by-row and detonate every Realtime subscriber

**Severity: High**
**Meters: Realtime messages · compute · query volume (via F-02)**

**Evidence.** `20260709000003_season_downsize_cancel_excess.sql` — `apply_compiled_season`:

- `:89` `FOR v_phase IN SELECT * FROM jsonb_array_elements(p_payload -> 'phases')`
- `:121` `FOR v_house IN SELECT * FROM jsonb_array_elements(v_phase -> 'houses')`
- `:265` `UPDATE shift_blocks SET voided_at = v_now WHERE block_id = v_blk.block_id;`
- `:272`, `:280`, `:294` — three more single-row `UPDATE ... WHERE block_id = v_blk.block_id`

These are per-block statements inside nested PL/pgSQL loops, not set-based updates. On the
seeded data a summer season covers ~35,000 blocks across 13 houses.

`publish_schedule` has the same shape at
`20260614000002_publish_recurring_weekly_pattern.sql:125` (`UPDATE`), `:136` and `:167`
(`INSERT`s) — a template week stamped across a whole semester.

**The Realtime coupling is what makes this expensive rather than merely slow.**
`shift_block_assignments` is in the `supabase_realtime` publication with
`REPLICA IDENTITY FULL`, so each touched assignment row emits a WAL record carrying the full
old row, which Realtime decodes and RLS-checks per subscriber. **And per F-02, every delivered
message triggers a 2.7-second refetch on the receiving client.**

**Cost per invocation (ESTIMATED).** A season apply touching ~35,000 blocks: ~35,000 separate
UPDATE statements (compute + WAL), an unknown but same-order number of assignment-row writes,
and a Realtime fan-out of that magnitude to every connected client. With 12 iOS clients
connected, the _follow-on query_ cost alone — before counting the Realtime messages — is
bounded above by 35,000 × 12 × 2 collectors × 2.7 s of refetch, which is not a number the
database can absorb; in practice the debounce-free `collect` will simply queue and the
database will saturate.

**Growth curve.** Linear in (blocks in the season × connected clients). At **pilot** with 12
clients it is already a saturation event. At **full** with 46 clients it is ~4× worse.

**Disproof attempted.** _Are these admin-only and therefore rare?_ Yes — `apply_compiled_season`
is admin-gated (`/admin/operations`) and `publish_schedule` is manager-gated. Rarity is why
this is High and not Critical. But rarity does not bound the cost of a single invocation, and
"apply the summer season" is exactly the kind of thing an admin does once, during the day,
while workers are connected. _Is there a dry-run that avoids the cost?_ Yes, and it is well
designed — the dry-run is a rolled-back subtransaction (`RAISE SQLSTATE 'PT001'`), which
means **preview costs the same compute as apply** but emits no WAL and no Realtime fan-out.
That is a mitigation for the fan-out, not for the compute. _Could the loop be set-based?_
That is the fix direction, but see the caveat below.

**Fix direction (sketch only).** The single highest-leverage change is **F-02's debounce**,
which caps the follow-on refetch cost regardless of how many rows a bulk write touches — fix
that first and this finding drops to Medium on its own. Beyond that, the per-block `UPDATE`s
at `:265-294` are candidates for set-based `UPDATE ... FROM (VALUES ...)` batching. **Handle
with care:** the headcount-decrease cut order (external floaters first, then shortest shift,
then `assignment_id`) is a documented invariant with pgTAP coverage in
`supabase/tests/apply-compiled-season.sql`, and the `enforce_block_occupied_headcount`
trigger is deliberately grandfathering-aware. A set-based rewrite must preserve both. Given
that risk and the rarity of the operation, **this is the lowest-priority of the High
findings** — see the ranked backlog.

---

### F-10 — Swap expiry runs twice a minute, from two independent schedulers

**Severity: Medium**
**Meters: query volume**

**Evidence.** Two callers do the same work every minute:

1. The `swap-expiry` cron —
   `20260530000001_phase_09_swaps.sql:578`
   (`UPDATE swap_requests SET status='expired' WHERE status='pending' AND expires_at <= now()`),
   re-registered against `app_now()` at `20260611000007_dev_sim_clock.sql:257`.
2. `orchestrator-tick/index.ts:1178-1197` — `expirePendingSwaps`, the identical UPDATE with
   `.lte('expires_at', now)` and a `.select('swap_id')` on top, invoked at `:1301` on every
   tick.

The second is strictly more expensive: `.select('swap_id')` forces a `RETURNING` and ships the
rows back to the Edge Function purely so `summary.swapsExpired` can be populated.

**Cost.** One redundant UPDATE (plus RETURNING egress) per minute, 1,440/day. Small in
absolute terms; listed because it is unambiguous waste and trivially removable.

**Disproof attempted.** _Do they differ meaningfully?_ Only in the clock source — the cron
uses `app_now()`, the EF uses the `app_now()` value it fetched at `:1263`. They race, and
whichever runs second updates zero rows. _Is the EF copy a fallback for when pg_cron is
absent?_ Plausibly — the code comment at `:1189-1192` explains the error swallow as tolerance
for `swap_requests` not existing yet, not as a deliberate double-schedule. Given `pg_cron` is
genuinely absent locally, the EF copy is what makes manual orchestration work in dev. So this
is _defensible_ in dev and redundant in prod.

**Fix direction (sketch only).** Keep one. The cron is the better home (it is pure SQL, no EF
invocation, no RETURNING egress); the EF copy could be dropped or gated on an env flag so dev
keeps it. If the EF copy stays, drop the `.select('swap_id')` and use the affected-row count.

---

### F-11 — iOS holds two Realtime channels and two refetch loops per user, with no background gate

**Severity: Medium**
**Meters: concurrent connections · Realtime messages · query volume**

**Evidence.** `apps/mobile/iosApp/iosApp/ContentView.swift:58` (Shifts) and `:122` (Calendar)
each call `repo.observeWorkerWeek(...)`. Because
`WorkerShiftsRepository.kt:786` appends `Random.nextLong()` to the channel topic, these are
**two distinct Realtime connections**, deliberately (the comment at `:781-785` documents that
a shared name crashed the app).

The Calendar collector additionally calls `fetchPendingSwaps()` **inside** the emission loop
(`ContentView.swift:~124`), so it is 3 queries per event to the Shifts collector's 2.

`activateLive` (`:52-56`) guards with `guard !live else { return }` and starts a bare `Task`.
`liveTask?.cancel()` appears only in `deinit` (`:81-83`). The app's `scenePhase` observer
(`iosApp/iOSApp.swift:169-178`) handles **only** `.active` and only to re-sync the sim clock —
it never tears down the subscription on background.

Android, by contrast, uses `collectAsStateWithLifecycle` (`MainActivity.kt:353`), which does
stop collection below STARTED. **The platforms are not at parity here.**

**Cost.** iOS clients cost **2× the connections and 2.5× the queries** of Android clients for
identical behaviour. At **pilot** with 12 iOS workers that is 24 concurrent Realtime
connections instead of 12. At **full**, 92 instead of 46 — which starts to matter against
plan connection limits, not just message counts.

**Disproof attempted.** _Does iOS suspend the socket on background anyway?_ In practice yes,
eventually — the OS suspends network activity for a backgrounded app, so the connection does
die without explicit teardown. **But that is the OS's behaviour, not the app's**, it is not
immediate, and on resume the flow re-emits and refetches with no coalescing. The defensible
claim is narrow and I will state only that: **there is no explicit lifecycle gate on iOS, and
Android has one.** _Is the second channel avoidable?_ The `Random.nextLong()` suffix works
around a supabase-kt constraint ("cannot call postgresChangeFlow after joining the channel"),
which is a real constraint — but that argues for **one shared upstream flow fanned out to two
consumers**, not for two sockets.

**Fix direction (sketch only).** Share one hot flow between the Shifts and Calendar consumers
(a `SharedFlow`/`StateFlow` with `WhileSubscribed`), which collapses 2 channels → 1 and 2
refetches → 1 without touching the supabase-kt constraint. Add a `scenePhase` gate that
cancels `liveTask` on `.background` and re-activates on `.active`, matching Android.
Move `fetchPendingSwaps()` out of the per-emission path or fold it into the shared snapshot.

---

### F-12 — `select *` on wide views across the mobile read path

**Severity: Medium**
**Meter: DB egress**

**Evidence.** `WorkerShiftsRepository.kt:744` and `:756` both use a bare `.select()` with no
`Columns.list(...)`, i.e. `select *` on `worker_my_shifts` (11 columns) and
`worker_open_shifts` (wider). `fetchNotifications` at `:807-809` is the same. By contrast
`fetchIncomingSwaps` at `:823` **does** use `Columns.list("swap_id", "swap_type",
"created_at", "expires_at")` — so the narrow pattern is known and used inconsistently.

`pg_stat_statements` shows both shapes in production-like use: a `worker_open_shifts` `.*`
query at 200 calls / 1,155 ms mean, and a narrow-column variant at 29 calls / 881 ms mean.

**Cost.** Egress only — the compute is dominated by F-01/F-05 either way. But egress is a
metered axis and this rides on the F-02 refetch path, so it is multiplied by every Realtime
event × every client.

**Disproof attempted.** _Does the 1000-row cap bound it?_ It bounds rows, not row width.
_Is every column actually consumed?_ The `MyShiftRow`/`OpenShiftRow` decoders would need
auditing to say for certain, and I did not verify column-by-column consumption — so this is
stated as a pattern finding at Medium, not a quantified one. That is the honest bar.

**Fix direction (sketch only).** Use `Columns.list(...)` on the two hot feeds, matching the
pattern already established at `:823`. Purely mechanical; no invariant implications.

---

### F-13 — `KnowledgeIntake` polls `router.refresh()` every 3 seconds

**Severity: Medium**
**Meters: compute · query volume · Auth API**

**Evidence.** `apps/web/components/knowledge/KnowledgeIntake.tsx:83-88`:

```tsx
83  const inFlight = initial.rows.some((r) => BUSY_STATUSES.includes(r.status));
84  useEffect(() => {
85    if (!inFlight) return;
86    const t = setInterval(() => router.refresh(), 3000);
```

`router.refresh()` re-renders the entire server component tree for that route. Per F-07 that
alone costs 3 GoTrue round trips + 4 DB queries, **plus** whatever the knowledge page's own
data loaders issue.

**Cost.** ~20 full RSC re-renders per minute while any KB document is mid-pipeline. A large
PDF ingest running several minutes ⇒ low hundreds of full page re-renders.

**Disproof attempted.** _Is it gated?_ Yes — `if (!inFlight) return`, and the interval is
cleaned up on unmount and on `inFlight` going false. That gating is why this is Medium and not
High: it cannot run when the page is idle. _Is it acknowledged as temporary?_ Yes — the comment
at `:81-82` says "A Supabase Realtime subscription is the follow-on; polling keeps the status
honest for v1." The author already knows.

**Fix direction (sketch only).** Either lengthen the interval substantially (3 s is far tighter
than an embedding pipeline's actual state-change rate) or complete the acknowledged plan and
subscribe to the intake row instead. Fixing F-07 also cuts this one's per-poll cost by more
than half for free.

---

### F-14 — No retention on `float_assignments` or `notifications`

**Severity: Medium**
**Meters: compute · storage**

**Evidence.** `float_assignments.expires_for_cleanup_at` is `NOT NULL`
(`20260528000001_phase_06_float_assignments.sql:16`) and carries a dedicated index (`:44`);
`float_retention_days` is a live runtime config read by the orchestrator
(`orchestrator-tick/index.ts:154-157`) and threaded into
`process_float_lookup_assignment` at `:845`. **Every piece of the retention mechanism exists
except the job that deletes anything:** a repo-wide
`grep -rn "DELETE FROM float_assignments\|DELETE FROM notifications" supabase/ packages/ apps/`
returns nothing.

**Cost.** This is the multiplier under F-06 and F-08 rather than a cost in its own right: it
converts two every-minute scans from steady-state into monotonically degrading. Also storage,
which is metered.

**Disproof attempted.** _Is retention handled outside migrations?_ I grepped
`supabase/migrations/` specifically; a cleanup living in an Edge Function would still need a
caller, and no cron references one. _Is `expires_for_cleanup_at` used for filtering instead of
deletion?_ It is written on insert and indexed, but no read path in the orchestrator filters
on it. The column is currently write-only.

**Fix direction (sketch only).** A low-frequency (daily, not per-minute) cron deleting
`float_assignments WHERE expires_for_cleanup_at < now()` and archiving/deleting delivered
notifications past a horizon. **Check the no-takeback invariant is not implicated** — it
governs _revoking a live float_, not deleting a long-expired historical row, but the
retention horizon should be comfortably past any window in which a float could still be
acted on, and `shift_block_assignments.parent_float_id` is `ON DELETE SET NULL`, so deletes
will silently null out historical linkage. That last point is a product decision, not an
engineering one — see Open Questions.

---

### F-15 — The dev sim-clock migration ships to production

**Severity: Low (cost) — flagged for awareness**
**Meter: none directly**

**Evidence.** `supabase/migrations/20260611000007_dev_sim_clock.sql` sits in the main
migrations directory and will apply everywhere. It replaces the `swap-expiry` cron so the
expiry UPDATE reads `app_now()` (`:254-258`), and `app_now()` is consumed on real paths —
`orchestrator-tick/index.ts:1223-1234` sources the tick's entire notion of "now" from it, and
`apply_compiled_season` gates future-block reconciliation on `block_start_at > app_now()`.

**Cost.** Negligible. I checked the concern directly: `app_now()` appears as a **scalar in
`WHERE` clauses, not as a per-row expression**, so it does not add per-row function-call
overhead to any hot query. The `orchestrator-tick` call is one RPC per tick.

**Why it is listed at all.** It is a dev affordance with a production blast radius: anything
that can set the sim-clock offset in production moves every escalation deadline in the
system. That is a security/operations question rather than a cost one, and it is out of scope
here, but a cost audit that noticed it and said nothing would be doing the reader a
disservice.

**Disproof attempted.** _Does it cost per-row?_ No — verified by reading the call sites; it is
scalar. _Is the offset zero in prod?_ By default yes, and `app_now()` equals `now()` at
offset 0 (documented at `orchestrator-tick/index.ts:1219-1222`). The finding is about the
surface existing, not about it being active.

---

### F-16 — KB intake re-embeds with no content-hash guard

**Severity: Low**
**Meter: AI spend (Voyage)**

**Evidence.** `apps/web/lib/actions/kbIntake.ts:235` calls
`voyageEmbed(chunkInputs.map((c) => c.content))` on the approve path with **all** chunks.
Grepping the file for `content_hash`/`contentHash`/`unchanged`/`existing` finds no dedupe
guard — the only `already` match (`:92`) is about whether a _proposal_ exists, not whether
_content_ changed.

**Cost.** `voyage-3` at $0.06/M input tokens (`apps/web/lib/ai/pricing.ts:41-48`). Re-approving
a large document re-pays the full embed. With 97 chunks locally the absolute number is cents;
the finding is about the absence of the guard, not today's bill.

**Disproof attempted.** _Is it gated by admin action?_ Yes — approval is an explicit admin
step, so this cannot run in a loop. That is why it is Low. _Does the pipeline at least measure
the spend?_ Yes, and well: `embedMetrics` captures tokens and `costUsd` per run
(`:234-243`), which is exactly the per-feature attribution the project's own API-key
convention asks for.

**Fix direction (sketch only).** Store a content hash per chunk and skip unchanged chunks on
re-approve. Low priority given the gate.

---

### F-17 — Desk Assistant: one embed + one vector search per message, plus broad context reads

**Severity: Low**
**Meters: AI spend · query volume**

**Evidence.** `supabase/functions/da-ask/index.ts` — per question:
`:469` `voyageEmbed([question])`, `:473` `supabase.rpc('match_kb_chunks', ...)`, plus
`:201` (`users`), `:212` (`da_conversations`), `:228` (`da_messages`), `:275`
(`system_config`), `:308`/`:506` (`routing_rules`), `:342` (`users` again), and on the
personal-schedule branch `:396` (`assistant_my_shifts`). Then 1-2 Anthropic calls
(`:430`, `:595`).

**Assessment: this is fine, and I want to say so explicitly rather than pad the count.**
Vector search is **per submitted message**, not per keystroke — I checked the web caller
(`apps/web/app/api/assistant/ask/route.ts`) and the mobile `AssistantRepository`; neither
issues a search on input change. The scope filtering is pushed into `match_kb_chunks` via
`da_can_read_item` rather than being done by fetching everything and filtering in TS, which
is the right shape. The `users` table being read twice (`:201`, `:342`) is a minor
redundancy on different branches.

**Cost.** Bounded by human typing speed. One embed (~tens of tokens) + one ANN search + one
Claude call per message.

**Disproof attempted.** _Is context assembled by broad table reads?_ No — the RAG path is a
vector search with a `k`, and the personal-schedule path uses a purpose-built RPC
(`assistant_my_shifts`) rather than the wide worker views. This is the one AI surface that
does **not** exhibit the pattern the brief was worried about.

---

### F-18 — Missing indexes on hot predicates

**Severity: Low individually, Medium in aggregate**
**Meter: compute**

Verified against `pg_indexes` for the hot tables. What exists and is doing its job:

- `shift_blocks_live_idx (block_start_at) WHERE voided_at IS NULL` — **used** by the
  orchestrator scan (confirmed in the plan). Good.
- `shift_block_assignments_block_status_idx (block_id, status)` — **used** for the
  nested-loop probe. Good.
- `shift_blocks_house_id_block_start_at_key (house_id, block_start_at)` — serves
  `loadVacantGap`'s house+range predicate.
- `block_step_status_pkey (block_id, step_name)`, `operating_calendar_pkey (date)` — serve
  the F-04 per-row lookups.

What is missing, each tied to a predicate found in this audit:

| Missing index                                                                      | Predicate it would serve                                  | Finding |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------- | ------- |
| `notifications (scheduled_for) WHERE delivered_at IS NULL`                         | `pending_notification_deliveries` — every minute          | F-08    |
| `float_assignments (status) WHERE acknowledged_at IS NULL AND declined_at IS NULL` | `processNoAckFloats` — every minute                       | F-06    |
| `shift_block_assignments (status) WHERE status = 'vacant'` (partial)               | the `Seq Scan ... rows=35956` inside `worker_open_shifts` | F-01    |

The third is speculative — with 35,956 of 41,836 rows vacant the planner may correctly prefer
a seq scan, and it will become useful only once most seats are scheduled. I flag it as
"revisit after F-01's row count is bounded", not as a change to make now.

---

## 4. Ranked remediation backlog

Ordered by (money saved) ÷ (risk of breaking a documented invariant). **Do not implement any
of this from this document — it is a sketch, and the fixes belong in a separate session.**

| Rank | Finding                                                     | Effort | Invariant risk                                                       | Why here                                                                                                               |
| ---- | ----------------------------------------------------------- | ------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1    | **F-02(i)** debounce/conflate the mobile refetch            | XS     | **None.** Client-side only; server truth unchanged.                  | Single highest ratio in the document. Caps F-01, F-05 **and** F-09's follow-on cost at once.                           |
| 2    | **F-03** failure accounting on push delivery                | S      | **Low, if done right.** Must NOT stamp `delivered_at` pre-send.      | The only unbounded, self-compounding cost. Everything else stabilises; this does not.                                  |
| 3    | **F-04(i)** join the launch gate into the orchestrator scan | S      | **None for cost; resolves a correctness gap.**                       | Removes ~95% of pilot-window idle cost and stops escalations against unlaunched desks.                                 |
| 4    | **F-07** wrap `getSessionUser` in `cache()`                 | XS     | **None.** `cache()` is per-request, the correct granularity.         | One line, removes 1 Auth round trip + 2 DB queries per navigation and most of the multi-call server actions' overhead. |
| 5    | **F-18** the two confirmed partial indexes                  | XS     | **None.**                                                            | Pure additive DDL; converts two every-minute seq scans to index scans.                                                 |
| 6    | **F-04(ii,iii)** memoise profile lookup, batch step-status  | S      | **None.** Chain evaluation untouched.                                | Removes the remaining per-row round trips without touching escalation timing.                                          |
| 7    | **F-01(a)** upper time bound on `worker_open_shifts`        | S      | **Low.** Must preserve dual-emission (see §5).                       | Biggest single-query win. Bound to the navigable window the client already uses.                                       |
| 8    | **F-06** push the lookahead into SQL + index                | M      | **None.** `process_no_ack_float`'s `FOR UPDATE` path unchanged.      | Removes an every-minute N+1.                                                                                           |
| 9    | **F-11** shared flow + iOS `scenePhase` gate                | M      | **None.**                                                            | Halves iOS connection and query cost; brings platforms to parity.                                                      |
| 10   | **F-05** hoist `auth.uid()`, order the policy arms          | M      | **⚠️ Real.** Must not collapse the three OR-ed SELECT policies.      | Big win but touches RLS. The own-assignment arm is load-bearing for float-out/cross-house-pickup visibility.           |
| 11   | **F-14** retention jobs                                     | S      | **⚠️ Check.** `parent_float_id` is `ON DELETE SET NULL`.             | Stops F-06/F-08 degrading forever. Needs a product call on history (see Open Questions).                               |
| 12   | **F-12** narrow the `select *` calls                        | XS     | **None.**                                                            | Mechanical egress win; low absolute value.                                                                             |
| 13   | **F-10** de-duplicate swap expiry                           | XS     | **None.**                                                            | Trivially removable, trivially small.                                                                                  |
| 14   | **F-13** lengthen or replace the 3 s KB poll                | XS     | **None.**                                                            | Already gated; F-07 halves its cost for free.                                                                          |
| 15   | **F-01(b)** restructure the CROSS JOIN                      | L      | **⚠️⚠️ High.** Touches the Harnwell training constraint's read path. | Largest theoretical win, largest risk. Do only after (a), and only with the pgTAP suite green.                         |
| 16   | **F-09** set-based bulk writes                              | L      | **⚠️⚠️ High.** Downsize cut order + headcount trigger are specified. | Rank 1 already caps the expensive half. Rare, admin-gated operation. Lowest ratio of any real finding.                 |
| 17   | **F-16** KB content-hash guard                              | S      | **None.**                                                            | Cents today.                                                                                                           |

### Fixes that would collide with a hard invariant — flagged explicitly

- **F-03**: the fix must **not** stamp `delivered_at` before sending. `supabase/AGENTS.md`
  is explicit that §10.1 personal notifications are mandatory and a rare duplicate beats a
  lost push. Add attempt-counting and backoff _around_ that rule, not through it.
- **F-05**: must **not** collapse the three OR-ed `shift_block_assignments` SELECT policies.
  The own-assignment arm is what makes float-out and cross-house-pickup rows visible on the
  personal calendar; removing it is a data-visibility bug that looks like a performance win.
- **F-01(b)**: the Harnwell training constraint is expressed in the view's join predicate
  (`:194`). Any restructure must keep it exactly equivalent — no worker whose home house is
  not Harnwell may ever see a claimable Harnwell seat.
- **F-04**: must **not** be "optimised" by removing the `loadCoveredBlockIds` call at
  `:959`/`:534`. That call _is_ the coverage-floor-of-one enforcement; without it the
  over-floating bug returns. Likewise do not widen `LOOKAHEAD_MINUTES` or raise
  `MAX_ALLIED_COVERAGE_BLOCKS` to reduce tick frequency — the 8-block Allied cap is a
  stakeholder decision.
- **F-09**: the headcount-decrease cut order (external floaters → shortest shift →
  `assignment_id`) and the grandfathering-aware `enforce_block_occupied_headcount` trigger are
  both specified behaviour with pgTAP coverage.
- **F-14**: deleting `float_assignments` rows nulls `shift_block_assignments.parent_float_id`
  via `ON DELETE SET NULL`. Confirm no audit or history surface depends on that linkage before
  choosing a horizon.

---

## 5. Deliberate-and-correct list

Things that look wasteful and are not. **A future session must not "optimise" these.**

1. **At-least-once push delivery.** `delivered_at` is stamped only after a successful send
   (`dispatch-push/index.ts:181`). A dispatch straddling a minute boundary can push twice.
   This is a documented decision — mandatory personal notifications make a rare duplicate
   strictly better than a lost push. **Keep it.** F-03 is about an _unbounded_ loop on hard
   failure, which is a different thing.
2. **`loadCoveredBlockIds` skipping already-staffed blocks** (`orchestrator-tick:959`, `:534`).
   Looks like a redundant pre-query; it is the coverage-floor-of-one invariant, and it is also
   what stops the multi-tick fill-to-headcount loop. **Keep both call sites** (the _duplication_
   between them is F-04's minor sub-item; the _existence_ of the check is not negotiable).
3. **`MAX_ALLIED_COVERAGE_BLOCKS = 8`** (`orchestrator-tick:20`) and the capped
   `loadVacantGap` window. This deliberately does **less** work per pass and re-escalates the
   remainder. It looks like unnecessary re-work; it is a stakeholder-decided 4-hour Allied cap.
4. **Dry-run as a rolled-back subtransaction** in `apply_compiled_season`. Preview costs the
   same compute as apply, which looks wasteful. It is what guarantees preview and apply share
   identical logic. **Do not fork them to make preview cheaper.**
5. **Unique per-collector Realtime channel topics** (`WorkerShiftsRepository.kt:786`). The
   `Random.nextLong()` suffix looks like a leak. It fixes a real supabase-kt crash. F-11's fix
   is to share the _flow_, not to share the _topic_.
6. **Dual emission of permanent-drop occurrences** by `worker_open_shifts` (the `UNION ALL` at
   `:105`/`:128`). A permanent-drop occurrence inside 30 days is emitted twice, by design —
   card identity is `(feed, assignment_id)`. It looks like a duplication bug. It is not.
   Any F-01 rewrite must preserve it.
7. **No upper time bound on the client's `start_at` filter**
   (`WorkerShiftsRepository.kt:730-732`). This looks like the obvious client-side fix for F-01.
   It was tried: supabase-kt **drops a second filter on the same column**, which is why the
   bound has to move into the view instead.
8. **The ascending sort + lower bound on `fetchWorkerWeek`** (`:749`). Looks arbitrary; it is
   the fix for the 1000-row-cap truncation that made freshly-assigned floats invisible.
9. **`REVOKE ... FROM PUBLIC` followed by explicit `GRANT ... TO service_role`** on the
   notification functions (`20260601000001:302-310`). Verbose, and necessary — a bare REVOKE
   does not strip Supabase's default `anon`/`authenticated` grants.
10. **Edge Functions being thin RPC wrappers** (1-6 DB calls each). This is the correct shape
    and it is consistently applied outside `orchestrator-tick`. No action needed; noted so a
    future audit does not re-derive it.

---

## 6. Subsystems audited with nothing to report

Stating these explicitly, per the brief's instruction that silence must mean "audited and
clean", not "skipped".

- **Web Realtime.** `apps/web` contains **no** Realtime subscription at all (no `channel(`,
  no `postgresChangeFlow`). The web surface is request/response only. Nothing to report.
- **Mobile polling.** No `setInterval`, no timer-driven refetch, no refetch-on-focus anywhere
  in `apps/mobile`. Mobile is entirely push-driven. Nothing to report.
- **Per-user-action EF fan-out.** No client action invokes more than one Edge Function.
  Checked across `WorkerShiftsRepository` write paths and `apps/web/lib/actions/`.
- **The 25 non-orchestrator Edge Functions.** Counted DB round trips for all of them
  (§2.4). Range 1-6, each a thin wrapper over a purpose-built RPC. No N+1, no state
  re-derivation that the caller already had. This is the healthiest part of the system.
- **`selectByBlockIdChunks`.** The 414-URI-too-long workaround
  (`apps/web/lib/data/blockChunks.ts`, mirrored at `orchestrator-tick:466-468`) is correctly
  applied at the call sites I traced in `calendar.ts:628`, `:637`. It is a symptom of large
  id sets, but the chunking itself is right and I found no unchunked sibling.
- **`worker_pending_floats`.** Bounded, per the earlier 1000-row-cap remediation. Confirmed it
  is not re-read on a hot path beyond the ack flow.
- **Storage.** No Supabase Storage usage on any hot path; KB documents go through the intake
  action, not a repeated download. Nothing to report.
- **Auth token refresh.** Mobile `createAppSupabaseClient` (`SupabaseClient.kt:29-33`) uses
  library defaults; no refresh loop found. The web's per-request `getUser()` is F-07 and is
  about _duplication_, not a refresh loop.
- **Vector search per keystroke.** Checked and **absent** — `da-ask` is invoked per submitted
  message on both platforms. See F-17.

**Not audited, and I want that on the record rather than implied:** I did not measure the
`house_schedule_grid` / `house_schedule_grid_any` views or `worker_directory` under load, nor
the `assistant_my_shifts` / `house_roster_as_of` / `membership_house_for_date` functions. They
are on admin and lower-frequency paths, they are not on the Realtime refetch path, and the
time was better spent on the every-minute and every-event surfaces. **They are the obvious
next target if a second pass happens** — `house_schedule_grid` in particular, since the house
tab is a primary admin surface and the memory index records a prior 1000-row-cap incident
there.

---

## 7. Open questions — these are product decisions, not engineering ones

1. **Freshness vs. cost on the mobile refetch (F-02).** A 300-500 ms debounce is invisible to
   a human. A 5-second one would cut bulk-write storms by another order of magnitude but would
   be perceptible when a float lands at T-2h. **What is the acceptable staleness ceiling for a
   worker seeing a newly-assigned float?** I would default to 500 ms unless you say otherwise.
2. **Open-shift horizon (F-01).** The client navigates last-week…+4. Is there any product
   reason a worker needs to see claimable shifts **beyond** ~5 weeks out? If not, bounding the
   view is nearly free. If permanent-pickup genuinely needs a longer horizon, the two feeds
   should get different bounds rather than sharing the widest one.
3. **Pre-launch houses (F-04).** Should the orchestrator skip `launch_state = 'pre_launch'`
   houses entirely, or should it run the chain but suppress _outbound_ notifications? These
   have very different costs and very different operational meanings. **I recommend skipping
   entirely** — a desk that is not launched has no one to page — but that is your call, and it
   interacts with whether pre-launch houses should have generated blocks at all.
4. **Notification and float history retention (F-14).** How long must a delivered notification
   and an expired float remain queryable? Deleting floats nulls
   `shift_block_assignments.parent_float_id`, so any historical "why was this shift floated"
   view would lose its linkage. A 90-day horizon with an archive table is the usual answer;
   tell me if compliance or dispute-resolution needs longer.
5. **iOS background behaviour (F-11).** Adding a `scenePhase` teardown means a worker who
   backgrounds the app and returns gets a fresh fetch rather than a live stream that survived.
   That is cheaper and slightly slower on resume. **Acceptable?**
6. **Sim clock in production (F-15).** Is `app_now()`'s offset intended to be settable in the
   production environment, or should the dev-clock surface be gated out of prod builds? This
   has no meaningful cost either way, but it is the kind of thing that should be a decision
   rather than an accident.

---

## Appendix — how to reproduce the measurements

All read-only. Run against the local stack with the seed loaded.

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
SET request.jwt.claims = '{\"sub\":\"fbb00000-0000-4000-8000-000000000001\",\"role\":\"authenticated\"}';
SET ROLE authenticated;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM worker_open_shifts
WHERE eligible_user_id='fbb00000-0000-4000-8000-000000000001'
  AND start_at >= '2026-07-06' ORDER BY start_at ASC LIMIT 1001;"
```

Swap `worker_open_shifts`/`eligible_user_id` for `worker_my_shifts`/`user_id` for F-05.
For the historical picture:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
SELECT calls, round(total_exec_time::numeric,0) tot_ms, round(mean_exec_time::numeric,1) mean_ms,
       left(regexp_replace(query,'\s+',' ','g'),95) q
FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat%'
ORDER BY total_exec_time DESC LIMIT 12;"
```
