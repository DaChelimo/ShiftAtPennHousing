# Swaps — Calendar Redesign + Cross-week / One-sided / Permanent (Round 2)

**Status:** 🟡 In progress (started 2026-06-17). **Phase 0 (bug fix) DONE + committed `dd31b35`.** Phases 1–2 specced here; execution staged.
**Branch:** `design/ui-implementation` (heavy reskin WIP already uncommitted on it).
**Spec anchor:** BEHAVIORAL_SPECIFICATION.md §8 (Swaps), §9 (caps). Extends [DESIGN.md](DESIGN.md) (round 1 — partial/multi-leg/tab).
**Owner decisions (2026-06-17), from the user:**

- Approval = **peer mutual consent only** (no manager step) → mobile-only, no admin-web work.
- Cross-week reach = **whole active scheduling period** forward; retroactive = **current + last week** back.
- **One-sided handoff** ("I take Bob's shift, get his full hours, he gets none of mine") is NEW and wanted. **Always cap-exempt** (both directions, future + past) — like floats; an accepted, deliberate cap-bypass.
- **Permanent swap** = a first-class in-app feature mirroring **permanent pickup** conventions.
- UI = **calendar-based** (reuse the familiar Personal Calendar); intuitive, esp. for 3-staff houses (Quad).
- **Entry points = BOTH** a My-Shifts card's Swap action (give pre-pinned) and a Swaps-tab "＋ Propose" (empty calendar).
- **Give source = ALL my shifts** (home-house + cross-house pickups + float-out), sourced from My-Shifts data, not just the home-house grid.

---

## 0. What was actually broken (Phase 0 — DONE, committed `dd31b35`)

The swap feature was **100% non-functional**, two stacked root causes:

1. **PRIMARY — busted UUID validator.** `supabase/functions/_shared/swap-http.ts` `isUuid` used a 4-group regex (`…[89ab][0-9a-f]{12}$`) that dropped the 4th group's `[0-9a-f]{3}-`. It rejected **every** valid 8-4-4-4-12 UUID, so `create-swap` 400-ed on every swap and `swap_requests` stayed empty — while the app showed an optimistic "Swap proposed" toast. Every other Edge Function uses the correct regex; restored it.
2. **Expired JWT, never refreshed.** Once a worker's Supabase access token expired, every Edge-Function write 401-ed and the error was swallowed. Added `AppConfig.ensureFreshSession`, wired in `WorkerBackend.wireAccessToken` to supabase-kt `refreshCurrentSession`; `EdgeFunctionClient.authed()` refreshes-if-near-expiry before each call and force-refreshes + retries once on a 401. Fixes swaps **and** every other privileged write.

**Verified end-to-end** against the local stack: sign in as a worker → POST `create-swap` → **201**, a pending `swap_requests` row written, returned by both the Outgoing (initiator) and Incoming (counterparty) queries the app uses. Also proved a **cross-week** swap (initiator 2026-06-17 ↔ counterparty 2026-06-22, different ISO weeks) → 201.

**Still uncommitted (rides into Phase 2, intermingled with reskin WIP in the same files):** honest success toast (`onCreateSwap` now `suspend (SwapProposal) -> Boolean`, gated on `EdgeResult.ok`) + Outgoing-list refetch (`swapRefreshKey` Android / `refreshFromServer` iOS) — there is **no Realtime channel on `swap_requests`**, so a created swap otherwise never appears until the screen is recreated.

---

## 1. Key finding: the backend already supports almost everything

Confirmed by reading the swap migration + EFs + core, and by live curl tests:

| Capability                                               | Backend today                                                                                                                                                          | What gates it                                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-week temp swap (my wk N ↔ their wk M)              | ✅ **No week constraint anywhere** (DB/core/EF). Proven: 06-17 ↔ 06-22 → 201.                                                                                          | **Mobile UI only** — `fetchHouseSchedule` is locked to the current NY week via `calendarWeekBounds(now)` (WorkerShiftsRepository.kt:425). |
| Retroactive / already-worked swap                        | ✅ No future-only guard on swaps (float-swap is deliberately retroactive).                                                                                             | Mobile UI only (picker won't surface past shifts).                                                                                        |
| Symmetric shift/float swap                               | ✅ Fully (Phase 09).                                                                                                                                                   | —                                                                                                                                         |
| Permanent swap                                           | ✅ `create-swap` permanent path + `apply_permanent_swap` exist (Phase 09).                                                                                             | UI: no scope-preview/commit flow like permanent **pickup** has.                                                                           |
| **One-sided handoff** (asymmetric, receiver gains hours) | ❌ **Not supported.** Table CHECK `swap_requests_temporary_counterparty_assignment_ids_nonempty` forces a reciprocal span; `accept_swap` always does a 2-way transfer. | **NEW backend required** (Phase 1b).                                                                                                      |

**Implication:** cross-week, retroactive, symmetric, and permanent swaps need **UI + a week-navigable data fetch only — no migration.** Only the one-sided handoff needs new backend.

---

## 2. UX design — the calendar swap

Replace the flat-list `SwapSheet` candidate picker with a **week-paged calendar** that reuses the Personal Calendar look workers already know (`calendar/Calendar.kt`: `buildCalendarWeek(anchor=…)`, `shiftWeekAnchor`, `weekPickerOptions`, the Mon–Sun strip + `WeekHeaderCard`/`WeekPickerSheet` already shared with Calendar).

**Flow (one calendar, two taps):**

1. Entry: "Propose a swap" (from a My-Shifts card's Swap action, or a Swaps-tab "＋ Propose"). Opens the swap calendar.
2. **Week header** (range + ‹ ›/picker) navigates weeks: whole period forward, back to last week. The data layer lazily fetches the **navigated** week's house grid (per-week, not the whole semester at once).
3. **Day strip** (Mon–Sun) with dots on days that have shifts. Tap a day.
4. The day shows **every** house shift as a tappable card: **yours** highlighted ("You"), **housemates'** labelled by name. In Quad, 3 people per slot list as separate cards (the current flat-list pain dissolves — it's a calendar, not a scroll).
5. **Tap your card → "give".** **Tap a housemate's card → "take".** A persistent bottom bar shows the forming swap: `Give {your span} ⇄ Take {their span}` with a **Propose** button. Partial-hour sub-ranges + multi-leg reuse the existing `planSwapSpan`/`SwapLeg` machinery, surfaced as an optional "adjust hours" affordance per card.
6. **One-sided:** the take is **optional**. Give-only with no take = "Hand off my shift to {name}" (you lose the hours). Take-only (tap their card, no give) = "Take over {name}'s shift" (you gain the hours, cap-checked). The bar copy + the `swap_type`/payload switch accordingly (§4).
7. **Permanent:** a scope toggle on a SCHEDULED card ("just this occurrence" vs "permanently"). Permanent shows a **scope preview** ("Swapping N of M weeks · K skipped") exactly like permanent pickup's dry-run (`loadPermanentScope`), then commits.

**Why a calendar beats the list:** the user navigates by _time_ (the mental model for "next week" / "Tuesday") and by _person-in-a-slot_ (the mental model for a 3-staff house), instead of scrolling an undifferentiated flat candidate list. Cross-week and retroactive fall out of week navigation for free.

---

## 3. Implementation plan

### 3a. Data layer (no migration) — `WorkerShiftsRepository`

- Add `fetchHouseScheduleForWeek(userId, anchor: Instant): HouseScheduleSnapshot?` — same query as `fetchHouseSchedule` but bounds via `calendarWeekBounds(anchor)` instead of `calendarWeekBounds(now)`. Keep the existing current-week method for the **House tab** (do NOT widen it — it would break §11.4's current-week semantics).
- The host calls it per navigated week (memoized per `(userId, weekOffset)`), exactly like `CalendarViewModel`'s week paging.
- Note the **same-column-filter gotcha** (supabase-kt drops a 2nd filter on the same column): keep `gte("start_at", weekStart)` server-side, enforce `< weekEnd` in Kotlin (as the current method does).

### 3b. Shared presentation (tested) — new `swaps/SwapCalendar.kt`

Pure, `now`/`anchor`-injected, KMP-clean (validate with `:shared:compileKotlinIosSimulatorArm64`). Reuse `swapCandidates` (coalescing + vacant/pending/self filters) and `weekDayIndexInWeekOf`.

- `data class SwapDayCard(userId, workerName, isMine, seatIds, start, end, timeLabel, durationLabel, selectableSubRange: Boolean)`.
- `fun buildSwapDay(seats: List<HouseSeat>, meUserId, selectedDayIndex, anchor, now, zone): SwapDay` → `SwapDay(mine: List<SwapDayCard>, others: List<SwapDayCard>)`, each filtered to the day via `weekDayIndexInWeekOf(start, anchor)`. (`mine` = the worker's own home-house seats; the _give_ side may also come from `shiftsInWeekOf(myShifts, anchor)` to include cross-house/float-out cards the home grid lacks — pick one source and document it.)
- `data class SwapDraft(give: SwapSpanSelection?, take: SwapSpanSelection?, kind: SwapKind)` + a `buildDraftProposal(draft, …): SwapProposal?` bridging to the existing `buildSwapProposal`, supporting an **empty** give or take (one-sided — §4).
- Tests in `swaps/SwapCalendarTest.kt`: day placement across weeks, mine/others split, Quad multi-person day, one-sided drafts, partial sub-range, and the existing multi-leg invariants still hold.

### 3c. Android (`androidApp`) — `SwapCalendarSheet`/screen

- Replace `SwapSheet`'s candidate list with the calendar: reuse `WeekHeaderCard` + `WeekPickerSheet` (already parameterized + shared with Calendar) + the Mon–Sun strip; render `SwapDay.mine`/`.others` as `AgendaShiftCard`-style tappable cards. Persistent give/take bottom bar. Keep `swap_*` Maestro testTags; add `swap_week_*`/`swap_card_*`/`swap_give`/`swap_take` selectors.
- Host wiring lives in MainActivity's live/demo `ShiftsApp` block (already touched by Phase 0's toast/visibility fix).

### 3d. iOS (`iosApp`) — `SwapCalendarView`

- SwiftUI mirror: reuse the calendar week header/strip components; `SwapDay` cards; give/take bar. Match `accessibilityIdentifier`s to the Android testTags.

### 3e. Maestro + README

- New `12-swap-calendar.yaml` (navigate to next week, pick a housemate's card, propose, see it in Outgoing). Update `apps/mobile/maestro/README.md` selector contract.

### 3f. Verification gates (all must stay green)

`:shared:compileKotlinIosSimulatorArm64` · `:shared:testAndroidHostTest` · `:androidApp:assembleDebug` · iOS `xcodebuild` · Maestro on a real emulator/sim (manual). Plus a live cross-week + one-sided `create-swap` curl as in §0.

---

## 4. One-sided handoff — new backend (Phase 1b)

Model as a swap with an **empty counterparty span** (give-only) or **empty initiator span** (take-only). Peer consent (the counterparty/initiator must accept).

**Cap decision (user, 2026-06-17): handoffs are ALWAYS cap-exempt** — never run a cap check, in either direction, future or past. Consistent with how floats and symmetric swaps are already treated (BEH §9 floats don't consult the cap). Accepted tradeoff: a directed take-over is therefore a deliberate cap-bypass (claim/pickup still cap-check), justified because it's a mutual-consent peer arrangement reflecting reality. Record this explicitly in the spec so it isn't mistaken for an oversight.

- **Spec:** add BEH §8.5 "One-sided handoff (directed give / take-over)". Contrast with drop→open-feed (anyone claims) and permanent drop/pickup (open period): this is a **directed, peer-consented** transfer to a _specific_ person. Harnwell/float-direction eligibility still applies (reuse `evaluateSwapEligibility`). Retroactive allowed within current+last week. **No cap check at all** (see cap decision above) — neither at create nor accept, future or past.
- **Migration:** relax `swap_requests_temporary_counterparty_assignment_ids_nonempty` to allow an empty side **iff** a new `swap_type = 'handoff'` value marks it one-sided. Add the type + a CHECK that exactly one of the two spans is empty for a handoff (and that handoff is never permanent).
- **RPC:** extend/clone `accept_swap` → one-way `user_id` transfer of the non-empty span to the receiver. **No `checkClaimAgainstCap`.** Keep the `FOR UPDATE` + status/expiry/ownership backstops + the symmetric eligibility re-check on the transferred span.
- **EF:** `create-swap` allow the empty side for `handoff`; validate exactly-one-empty; reuse eligibility + conflict guards.
- **Core (Vitest) + pgTAP:** eligibility on the non-empty span (Harnwell/float-direction); empty-side CHECK (exactly one empty; handoff ≠ permanent); accept transfers one way; **no cap check fires**; expiry.
- **UI:** the calendar's optional give/take already produces the one-sided draft (§3b); map to `handoff` in `createSwap`.

---

## 5. Sequencing (commit green checkpoints)

1. ✅ **Phase 0** — bug fix (`dd31b35`).
2. **Phase 2a** — data fetch + `SwapCalendar.kt` + tests (shared, headlessly verifiable). Commit.
3. **Phase 2b** — Android calendar swap UI + Maestro. Commit. (Delivers cross-week + retroactive + symmetric + permanent — all backend-ready.)
4. **Phase 2c** — iOS calendar swap UI. Commit.
5. **Phase 1b** — one-sided handoff backend (spec + migration + RPC + EF + tests). Commit.
6. **Phase 2d** — wire one-sided into the calendar UI. Commit.

Cross-week (the user's "very common" case) is delivered by 2a+2b — no backend work, lowest risk, do first.
