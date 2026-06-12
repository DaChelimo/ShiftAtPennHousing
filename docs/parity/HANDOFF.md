# Parity Program — Session Handoff

**Read this first.** It is the single entry point to resume the design↔code parity program.
Companions: [`PLAN.md`](PLAN.md) (tracks/chunks), [`STATUS.md`](STATUS.md) (live per-chunk tracker +
verification log + gotchas), [`MATRIX.md`](MATRIX.md) (232 audited feature rows — note: ~4 rows
turned out **stale/already-built**, see below).

> **⟳ 2026-06-12 update:** §3's queue is DONE — CO (`0650231`), T2-11 (`dd5846d`), T2-10
> (`c2ea19d`), T2-12c-mobile (`ecfb458`), T3a-min (`952baf7`), polish (`b116f41`); mobile JVM
> 186→234 green, iOS link green, demo-path emulator spot-check PASS (STATUS verification log).
> **⟳ Later the same day: T3b UNBLOCKED — the user ruled cross-worker contact = FULL
> DIRECTORY — and was BUILT:** T3b-1 backend (`2e7820f`, pgTAP 1280; REVOKE fix for a real
> write-through-view RLS bypass), T3b-2/3 House tab + contact sheet (`39ce2b4`), T3b-4
> calendar week navigation (`36f5779`, indicator polish `6b01c49`); JVM suite 246, second
> emulator spot-check PASS. **ALL TRACKS COMPLETE** — optional remaining = the TB backfill
> track and the §5 Maestro/Playwright debts. The sections below describe the state BEFORE
> this session.

---

## 1. Current state (as of this handoff)

- **Branch:** `design/ui-implementation` — **HEAD `716b054`**, working tree **clean**.
- **What's done:** **All of T1 (worker app fully wired to backend + spot-check-verified live)** and
  **essentially all real T2 gaps**. pgTAP suite grew **997 → 1265**; mobile JVM tests + iOS link green
  throughout; web type-check/lint/build green. See `STATUS.md` for the per-chunk table + commit shas.
- **Local env is UP:** Supabase local stack running (DB at `127.0.0.1:54322`, API `54321`), Android SDK
  - 16G warm Gradle cache. **Emulator is currently KILLED** (good — see gotcha #5).

### Done (commit shas in STATUS.md)

- T1-0..T1-10 (drop/claim/reclaim/float-ack/break/prefs/settings/login/Updates-feed/mark-read/
  pending-float→ack-hero) + the T1 spot-check (claim + float-ack proven live).
- T2-1 `dropped_still_open`, T2-2a break context+at-cap, T2-2b break opt-out, T2-2c break-drop-routing
  (already-correct, pinned), T2-3b permanent-pickup mobile wire (backend was already done), T2-4 §5.5/§8.4.1
  test coverage (already-implemented), T2-5 set-deadline, T2-6 hire/fire, T2-7 rotor truncation, T2-8
  mark-read, T2-12a builder search, T2-12b leave §2.6 correctness, T2-12c-be/web closed-house.

### Deferred (do NOT treat as gaps unless asked)

- **T2-13** full-screen push-launched FloatAckSurface — reachable only via FCM push (deploy-config, no
  `google-services.json`; untestable locally). Bottom-sheet ack covers the in-app flow (T1-10). The
  partial work was **reverted to green** (a `FloatDeepLink` parser + a broken `weight` import). Revisit at
  deploy when FCM is wired.
- **Integration health cards** (§6.12 SMS/Allied/SSO/SIS) — no real integration source exists to instrument.
- **T3a swap INITIATE + VOID** UI — deferred per the user decision below (only the accept/reject slice is in scope now).

---

## 2. Locked decisions (authoritative)

1. **Spec wins** — `BEHAVIORAL_SPECIFICATION.md` (root) is authoritative over the designs.
2. **Build design-additive features** EXCEPT the one flagged exception: mobile per-category _personal_
   notification toggles stay disabled (§10.1 — personal notifs are mandatory/non-silenceable; only the
   broadcast channel is opt-in). Already honored in T1-7.
3. **NEW (this session): Coalescing — BUILD IT (option "Build coalescing + partial ops").** The live read
   model is per-30-min-block and the mobile maps it 1:1 (no coalescing), so a live 4h shift renders as 8
   cards. Build a block-coalescing layer (consecutive same-house/same-kind blocks → one shift card) across
   My-Shifts / Open-Shifts / Calendar, THEN the partial-drop (§5.2) + partial-claim (§5.3) range selectors.
4. **NEW (this session): Swaps T3a — MINIMAL SLICE ONLY.** Wire **accept/reject of an incoming swap from
   the Updates feed** (the counterparty action) now. **Defer** initiate (shift/float/permanent) + void UI to
   a separate later pass.
5. **T3b is the hard stop** — it carries a privacy/RLS decision (exposing one worker's contact to another,
   §11.4). Do NOT build T3b without the user's explicit RLS ruling.

---

## 3. What's LEFT — execute in this order

> **Execution model that works here:** one focused chunk at a time (or a safe parallel pair, see §4).
> **IMPORTANT reliability note:** the heavier/longer mobile chunks hit subagent stream-stalls **5 times**
> this session (T2-5×2, T2-13×2, T2-11). **Run the heavy/long mobile chunks YOURSELF in the main thread**
> (no watchdog); delegate only small, well-scoped chunks to subagents. A stalled subagent leaves its file
> writes in the tree — finish in the main thread (that's how T2-5 was recovered).

### CO — Block-coalescing foundation (NEW, do FIRST; gates T2-10/T2-11)

**Problem:** `worker_my_shifts` / `worker_open_shifts` return **one row per 30-min block**
(`end_at = block_start_at + interval '30 minutes'`); `WorkerShiftsRepository` maps rows 1:1 to `MyShift`/
`OpenShift`; `MyShiftPresentation.toRow` / `OpenShiftPresentation` are 1:1 → live = one card per block.
Demo hides it (DemoData builds multi-hour `MyShift` spans by hand).
**Build:** a PURE coalescing step (in `apps/mobile/shared/.../shifts/`) that merges consecutive blocks with
the same (house, kind, cross_house, pending, break_shift, contiguous time) into one displayed shift carrying
its constituent `assignment_id`s. Apply it in My-Shifts, Open-Shifts, and the Calendar agenda. Keep the
underlying per-block ids so drop/claim can target a subset.

- **Files:** `shared/.../shifts/MyShiftPresentation.kt`, `shifts/OpenShiftPresentation.kt`,
  `shifts/Shifts.kt`, `model/Models.kt` (`MyShift`/`OpenShift` may need a `blockIds: List<String>` or a
  coalesced wrapper), `viewmodel/ShiftsScreenViewModel.kt`, `calendar/Calendar.kt`; consumers in
  `androidApp/.../ui/ShiftsScreen.kt` + `iosApp/.../ContentView.swift`.
- **Tests:** kotlin.test for the coalescing (contiguous merge, gap splits, different-house/kind don't merge,
  DST-safe via NY tz). This is the tested pure surface — cover it well.
- **Gate (NO DB):** `cd apps/mobile && ./gradlew :shared:testAndroidHostTest :androidApp:assembleDebug :shared:compileKotlinIosSimulatorArm64`.
- **Scope caution:** this touches the core shift display — keep demo path visually identical; preserve all
  Maestro selectors (`section_*`, `scheduled_shift_card`, `open_shift_card`, etc.).

### T2-11 — Partial drop UI (§5.2) (after CO)

Over the coalesced shift card: a DropSheet "how much to drop" block-range selector + mid-shift drop-from-now
(`roundDownToBlock` already exists in `shifts/Shifts.kt`); drop the selected blocks via the existing
`drop-shift` EF (multi-`assignment_id`); remaining blocks re-coalesce into separate cards. Extend
`planTemporaryDrop` (pure, +kotlin.test). Keep whole-shift + permanent drop working. Mobile only, NO DB.

### T2-10 — Partial-claim UI (§5.3, design-extra) (after CO)

Over the coalesced OPEN shift card: a "How much can you cover?" block-range selector; claim the selected
blocks via the existing `claim-shift` EF (per-block; FCFS atomicity is server-side already). Whole-claim
path unchanged. Mobile only, NO DB. (This is a design-extra — spec §5.3 defines only whole-claim — the user
opted to build it.)

### T2-12c-mobile — Closed-house render on the mobile calendar (§3.4/§11.3) (small, mobile, NO DB)

Backend `house_closure(p_house_id text, p_on_date date) → boolean` exists (T2-12c-be, `d17049b`). The mobile
worker calendar (`calendar/Calendar.kt` + `CalendarViewModel` + the Calendar tab in `ShiftsScreen.kt`/
`ContentView.swift`) should render "Closed" for closure dates of the worker's home house. Call `house_closure`
via Postgrest `.rpc(...)` (granted authenticated) for the visible dates. +kotlin.test for any pure logic.
Gate: mobile JVM+assemble+iOS.

### T3a-min — Accept/Reject incoming swap from the Updates feed (mobile + maybe small wiring)

Backend EFs exist: `accept-swap`, `reject-swap` (also `create-swap`, `void-swap` for the deferred initiate/void).
Today the mobile only models a swap as a feed notification (`Notifications.kt:36` `"swap_request"`). Build:
the Updates feed surfaces an incoming swap request with **Accept / Reject** actions → call `accept-swap` /
`reject-swap` via `EdgeFunctionClient`. Read the EF contracts for the request shape. Reuse the
`EdgeFunctionClient` + the live-callback idiom from T1-2/T1-3. Mobile, NO DB. Defer initiate/void.

### T3b — ⚠ STOP. Contact lookup + house grid + calendar-advanced (NEEDS USER RLS DECISION)

Do NOT start without the user's ruling: §11.4 wants a shift card to surface the **assigned worker's phone**
(exposing one worker's contact to another — an RLS/privacy decision). Also needs desk-phone column, a
worker-readable house-roster view, and a date-param `worker_my_shifts` read model. Present the RLS options
and wait.

### TB — Test backfill (optional, low-risk, anytime)

Many already-built web features lack tests (Playwright needs `supabase db reset` first; it's expensive — see
STATUS verification doctrine). Candidates: TB-1 web calendar grid (now incl. the new closed-day cell
`data-testid="calendar-closed-day"`), TB-2 hours report, TB-3 coverage **permanent-openings feed** (built but
untested — `lib/data/coverage.ts` `permPerDay` + `PermCard`), TB-4 config/health, TB-5 inbox/force-trigger/
leave/rotor/cap/prefs residual.

---

## 4. Execution protocol + LOAD-BEARING gotchas

- **Per chunk:** implement → run its acceptance gate → commit ONE focused commit (message trailer exactly
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`) → update `STATUS.md` (status + gate + sha).
  The pre-commit lint-staged hook reformats `.md`/`.ts`/`.tsx` (prettier/eslint) — re-add/re-commit if it amends.
- **Parallel chunks (optional):** only when file-disjoint. The local DB is a **shared resource — at most ONE
  DB-migration/reset chunk in flight**; pair it with a NO-DB chunk. When running parallel subagents, have them
  **implement+verify only (no git, no STATUS)** and commit centrally yourself (avoids git-index/STATUS races).
- **GOTCHA 1 — Edge Function added/changed:** recreate the edge container with `supabase stop && supabase start`
  (NOT `docker restart`) or new EFs return **404** (the runtime bakes its function config at provision time).
- **GOTCHA 2 — active seed creds:** `supabase/seeds/manual-test.sql`; login `<first>-<house>@upenn.edu` / `abc123`
  (e.g. `alice-quad@upenn.edu`). The `@pennhousing.test` users are hidden + have no open shifts/floats.
- **GOTCHA 3 — new `database.types.ts` entry consumed by web** (e.g. a new `.rpc('fn')`): after
  `supabase gen types typescript --local > packages/shared/src/database.types.ts`, you MUST
  `pnpm --filter @shift/shared build` — `@shift/shared` ships from a gitignored `dist/`, so web `tsc` otherwise
  fails `TS2345: "fn" not assignable`.
- **GOTCHA 4 — long DB gates stall subagents:** `supabase db reset && supabase test db` (mins) can idle-timeout a
  subagent's stream. Run heavy DB gates from the MAIN THREAD via `run_in_background`. For a new migration, ALWAYS
  do a clean `supabase db reset && supabase test db` (CI-equivalent) before committing.
- **GOTCHA 5 — KILL the emulator after any spot-check** (`adb -s emulator-5554 emu kill`). A leftover emulator
  silently ballooned a 16s mobile build to **21min** (+ OOM-failed it). If `assembleDebug` is suddenly minutes-long,
  check `adb devices`.
- **GOTCHA 6 — KMP:** ALWAYS run `:shared:compileKotlinIosSimulatorArm64` (JVM-green ≠ KMP-green); `@Volatile` in
  commonMain must be `kotlin.concurrent.Volatile`. SKIE exports `withX`→`doWithX`, enum `BREAK`→`BREAK_SHIFT`.
- **Mobile live-write template:** raw Ktor POST via `network/EdgeFunctionClient.kt` (`invoke` POST / `patch` /
  `get`); the shared Supabase client installs Auth/Realtime/Postgrest but NOT Functions. Direct RPCs granted to
  `authenticated` go through `supabase.postgrest.rpc(...)`. Live wiring lives in `MainActivity.LiveShiftsRoot`
  (Android) / `ContentView` live root (iOS); demo path stays local-only/optimistic.

---

## 5. Verification debts (not yet exercised)

- **Maestro** mobile e2e + **Playwright** web e2e were **deferred throughout** (DB-held / cost). Before calling
  the program done, run: a Maestro pass on an emulator (then KILL it) against local Supabase for the wired worker
  flows, and `supabase db reset` + Playwright for web. The T1 spot-check only covered claim + float-ack.
- New web UI added `data-testid`s: `builder-roster-search`, `calendar-closed-day`, hire-form `hire-*` — wire into
  Playwright when backfilling.
