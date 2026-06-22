# Swaps Enhancement — Design

**Status:** ✅ Implemented 2026-06-15 (drafted same day) — Phases A + B + C
**Scope:** Worker mobile app (KMP: `:shared` + `:androidApp` + `iosApp`)
**Spec anchor:** BEHAVIORAL_SPECIFICATION.md §8 (Swaps), §14 (expiry)
**Owner decision (2026-06-15):** multi-party swaps are **independent legs**, never all-or-nothing. Keep the atomic, self-contained mindset for every operation.

## Follow-ups (2026-06-16)

- **Swaps tab "All" sub-tab** (leftmost, default): merges Incoming + Outgoing; every list sorted soonest-deadline-first ("closest about to begin"). `SwapsFeed.all`, `SwapsTab.ALL`, `SwapRow.expiresAt`.
- **Scroll bug fix:** the swap composer overflowed the bottom sheet so the submit/add buttons were unreachable. Root cause: neither sheet container scrolled — iOS `ShiftSheet` wrapped content in a plain `VStack`, Android `ShiftBottomSheet` in a non-scrolling `Column`. Fix: iOS → `ScrollView`; Android → `Modifier.verticalScroll` (ShiftBanner already used `IntrinsicSize.Min` for exactly this scrollable context). Applies to ALL sheets.
- **Multi-party edge cases verified.** Unit test `multi_party_split_handles_partial_subranges_and_same_person_two_days` encodes the 4-leg scenario (Alice 6h → Bob first-2h↔his-last-2h, Steve middle-2h↔his-first-2h, Tom-Tue 5th-hour, Tom-Fri 6th-hour) — disjoint independent proposals. Drove a live **2-person** swap on the iOS sim (demo build, 6h shift): give Alice's first 2h ↔ Bob's last 2h + middle 2h ↔ Steve's first 2h → "Propose 2 swaps" → landed in the Swaps tab as "Proposed together · 2 people". Demo `onCreateSwap` now optimistically reflects legs via `SwapsViewModel.addOutgoing`; demo `houseSchedule` gained Bob (5h) + Steve (8h); demo `snapshot` gained a 6h Monday shift.

## Implementation summary (2026-06-15)

All three phases shipped on `design/ui-implementation`. **No `supabase/` or `packages/core/` changes** — entirely client-side, as the design predicted.

- **Shared (tested):** `swaps/Swaps.kt` (`planSwapSpan`/`swapSpanCells`/`SwapLeg`/`legsHaveOverlap`/`unallocatedInitiatorBlocks`/`firstFreeRange`/`buildSwapProposals`, `SwapProposal.initiatorAssignmentIds`), new `swaps/SwapsFeed.kt` (`buildSwapsFeed` + co-created grouping), new `viewmodel/SwapsViewModel.kt`. `notifications/Notifications.kt` — incoming swaps are now deep-link **mirrors** (`opensSwaps`), `withOutgoingSwapEntries` removed. `WorkerShiftsRepository.createSwap` posts `initiatorAssignmentIds`.
- **Android:** `SwapSheet` gains give/take `RangeSlider` pickers + "add another person" multi-leg compose; new `SwapsTabContent` (Incoming/Outgoing sub-tabs) in the **More** sheet (`TAB_SWAPS`); Updates rows deep-link via `onOpenSwaps`.
- **iOS:** `SwapSheetView` rewritten (block pickers + multi-leg), `SwapsObservable` + `swapsTab` (Incoming/Outgoing), Updates mirror deep-links, **More** sheet row.
- **Tests:** 332 shared JVM tests green (SwapsTest 18, SwapsFeedTest 4, SwapsViewModelTest 5, NotificationsTest 23). Builds green: `:shared` JVM + iOS Native, `:androidApp:assembleDebug`, iOS `xcodebuild`. Maestro: `10-swaps-tab.yaml`, `11-propose-partial-swap.yaml` (+ README selector contract) — run on a real emulator/simulator.

---

## 1. Motivation

Three gaps in today's swap experience:

1. **Partial-hour swaps** — a worker can only offer/take a _whole_ coalesced run. They cannot say "swap 2 of my 4 hours for 2 of Ben's 5." The spec already allows this; only the UI is missing.
2. **No dedicated review surface** — swaps (incoming _and_ outgoing) are buried in the **Updates** notifications feed. There is no clean place to see "requests I made" vs "requests I received."
3. **No multi-party flow** — a worker cannot, in one motion, give 2 hours to Ben and another 2 hours to Mary from the same shift.

## 2. Goals / Non-goals

**Goals**

- Let a worker pick a **contiguous sub-range** of their own span and of the counterparty's span when proposing a 1:1 swap.
- Give swaps a **dedicated tab** with **Incoming / Outgoing** sub-tabs; keep a deep-linking mirror in Updates for discoverability.
- Support **multi-party** swaps as **N independent 1:1 legs**, each its own request, each succeeding or failing on its own.

**Non-goals**

- No all-or-nothing multi-leg basket (explicitly rejected — would require new cross-leg coordination/rollback).
- No change to swap **eligibility**, **expiry**, **hours-cap** rules, or **no-takeback** — those stay exactly as specced.
- No new swap _types_; we still emit `shift_swap` / `float_swap` / `permanent_swap`.
- Permanent swaps stay person-level (not partial — a recurring slot is the unit).

## 3. Current state (what exists today)

| Layer            | Where                                                                                                                                                                                                                                                                                                                            | Behavior today                                                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DB               | `swap_requests` ([20260530000001_phase_09_swaps.sql](../../supabase/migrations/20260530000001_phase_09_swaps.sql))                                                                                                                                                                                                               | `initiator_assignment_ids uuid[]`, `counterparty_assignment_ids uuid[]`, single `counterparty_user_id`. **Already block-level. Already partial-capable.**                                                    |
| Core logic       | [packages/core/src/swaps/](../../packages/core/src/swaps/)                                                                                                                                                                                                                                                                       | Pure symmetric eligibility, conflict detection (`findConflictingPendingSwaps`), permanent-swap scoping.                                                                                                      |
| Edge Functions   | `create-swap` / `accept-swap` / `reject-swap` / `void-swap`                                                                                                                                                                                                                                                                      | `create-swap` takes the two block-ID arrays. **No payload change needed for partial.**                                                                                                                       |
| Mobile — propose | [Swaps.kt](../../apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/swaps/Swaps.kt) + swap sheet ([ShiftsScreen.kt](../../apps/mobile/androidApp/src/main/java/com/pennhousing/shift/ui/ShiftsScreen.kt) `SwapSheet`, [ContentView.swift](../../apps/mobile/iosApp/iosApp/ContentView.swift) `SwapSheetView`) | Reached from a My-Shifts card → drop sheet → "Propose a swap instead." Offers **whole runs only** — `buildSwapProposal` sends `candidate.seatIds` (all of them) and `initiatorShift.blockIds` (all of them). |
| Mobile — review  | Updates tab; `withIncomingSwapEntries` / `withOutgoingSwapEntries` in [Notifications.kt](../../apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/notifications/Notifications.kt)                                                                                                                             | Swaps appear as synthesized feed rows with Accept / Decline / Cancel buttons. No dedicated tab.                                                                                                              |

## 4. Spec basis

- §8.1: "Workers A and B agree off-system to swap two specific shift spans (**one or more contiguous blocks each**)… temporary shift swaps may be for **any contiguous block run, including partial shifts**." → partial is first-class; a span is **contiguous**.
- §8.1 **Conflicts:** "a worker cannot create or accept a shift swap request that touches a block already involved in another pending swap request of theirs." → multi-leg legs must use **disjoint blocks**, which the multi-party flow naturally produces.
- §8.1/§8.2 eligibility: symmetric Harnwell-training + float-direction + cross-house checks, at pre-creation and acceptance. Block-level → unchanged by partial selection.
- §8.2: floats/swaps are **hours-neutral** → no cap check. Partial/multi-leg don't change this.
- §14 expiry: shift T−3h of earlier span · float +24h after latest end · permanent +7d. Per-request, so each independent leg expires on its own.

---

## 5. Feature A — Partial-hour swaps (1:1)

**The only change is selection + plumbing the selected subset; backend untouched.**

### Shared logic ([Swaps.kt](../../apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/swaps/Swaps.kt))

- Change `SwapProposal` to carry **explicit block subsets** rather than implying "all":
  - `initiatorAssignmentIds: List<String>` (selected contiguous subset of `initiatorShift.blockIds`)
  - `counterpartyAssignmentIds: List<String>?` (selected contiguous subset of the candidate's `seatIds`; still `null` for permanent)
- Add a pure, tested helper to enumerate the **selectable blocks** of a span as ordered 30-min cells with labels, plus a `contiguousSubrange(start, end)` validator that enforces §8.1 contiguity. Keep it pure (snapshot + no clock) per the tested-surface convention.
- `buildSwapProposal` takes the chosen `initiatorBlockIds` + `counterpartyBlockIds` instead of defaulting to the whole runs.

### UI (Android `SwapSheet` + iOS `SwapSheetView`)

- After a counterparty run is picked, show **two block strips** — "Your hours to give" (from the proposer's span) and "Hours you want" (from the counterparty's run) — each a row of 30-min toggles defaulting to the full run (preserves today's behavior when untouched).
- Enforce contiguity in the picker (selecting a cell extends/!trims the contiguous range; no gaps). Surface the selected duration on each side ("Giving 2h · Taking 2h").
- Permanent kind hides the block strips (person-level).

### Invariants

- Eligibility, conflict, expiry, hours-cap: unchanged (still evaluated on whatever block-IDs are sent). No new server work.
- **Contiguity decision:** a single swap span is one contiguous run (§8.1). A worker wanting two _non-adjacent_ chunks of their own shift must use multiple legs (Feature C) — call this out in the picker rather than silently allowing gaps.

### Test surface

- `kotlin.test` for the new block-enumeration + contiguity helpers and `buildSwapProposal` subset mapping. Maestro: extend the swap flow to toggle a sub-range and assert the proposal duration.

---

## 6. Feature B — Dedicated Swaps tab

### Placement

- Add a **Swaps** tab to the scrollable tab row (Android [ShiftsScreen.kt:318](../../apps/mobile/androidApp/src/main/java/com/pennhousing/shift/ui/ShiftsScreen.kt:318); iOS `Tab` enum in [ContentView.swift](../../apps/mobile/iosApp/iosApp/ContentView.swift)). 8th tab; the row already scrolls.
- Two sub-tabs: **Incoming** (requests received, awaiting my accept/decline) and **Outgoing** (requests I made, awaiting their response / cancelable). Mirrors the existing Open Shifts My-House/Other-Houses sub-tab pattern.

### Data

- Reuse the existing synthesis: `withIncomingSwapEntries` / `withOutgoingSwapEntries` ([Notifications.kt](../../apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/notifications/Notifications.kt)) → lift the swap-specific shaping into a `SwapsViewModel` feeding the new screen. Accept / Decline / Cancel actions already exist and POST to the existing EFs — relocate the cards, don't reinvent them.
- **Updates keeps one urgent mirror entry per pending incoming swap** that deep-links into Swaps → Incoming (same pattern the pending-float ack uses). Outgoing swaps no longer clutter Updates.

### Selectors (Maestro)

- New: `tab_swaps`, `swaps_subtab_incoming`, `swaps_subtab_outgoing`, plus reuse `swap_accept_button` / `swap_reject_button` / `swap_void_button`. New flow `10-swaps-tab.yaml` (number TBD); update `apps/mobile/maestro/README.md` selector contract.

---

## 7. Feature C — Multi-party swaps (independent legs)

**Model:** a multi-party proposal is **not one record**. It is **N independent 1:1 `swap_requests` rows**, one per counterparty. There is no parent/group entity on the server.

### Why independent (decided)

- One leg declining/expiring/voiding **must not** affect the others (Ben accepts even if Mary declines).
- The existing per-request lifecycle (expiry, no-takeback, conflict guard) already gives each leg correct atomic semantics — no new coordination construct, no cross-leg rollback.
- The §8.1 conflict guard _requires_ the legs to touch **disjoint blocks** of the proposer's shift, which is exactly the natural case (Ben gets blocks 1–4, Mary gets 5–8).

### Flow

1. From a My-Shifts card, the worker enters a **compose** flow: repeatedly { pick a counterparty run → pick which contiguous sub-range of _my_ shift goes to them (Feature A picker) → pick which of _their_ hours I take }.
2. The compose UI tracks remaining un-allocated blocks of my shift and prevents overlapping allocations (enforces the disjoint-blocks rule client-side before the server conflict guard does).
3. A **review-before-send** summary lists every leg ("→ Ben: my 2h ↔ his 2h", "→ Mary: my 2h ↔ her 2h").
4. On confirm, fire **one `create-swap` per leg**. Each call is independent: a failure on one leg surfaces inline and **does not block** the others.

### Review & lifecycle

- Each leg appears as its own row in **Outgoing** and is independently cancelable.
- **Optional, no DB change:** group legs created together under a client-side label in the Outgoing list (cosmetic only — derive from a client-generated correlation tag stored nowhere authoritative, or simply group by created-at + initiator shift). Do **not** add a server group column; that would invite all-or-nothing thinking.

### Invariants

- Each leg independently runs §8 eligibility, expiry, conflict guard, no cap check. Nothing new server-side.

---

## 8. Cross-cutting — invariants preserved

- **Hours cap not checked on swaps** (§8.2; AGENTS hard invariant #4) — partial/multi-leg are still hours-neutral relocations.
- **Harnwell training + float direction** — symmetric, block-level, evaluated on whatever blocks each leg carries.
- **No-takeback / silent void on drop-or-float / conflict guard** — per-request, so they apply unchanged to each leg.
- **Block atomicity (30-min boundaries)** — the picker only ever toggles whole 30-min cells.

## 9. Resolved decisions (2026-06-15)

1. **Multi-leg compose entry point — add-another affordance.** Reuse the existing "Propose a swap instead" pivot and add an "add another person" affordance; one flow handles both single and multi-party swaps. No separate "Split across people" action.
2. **Outgoing grouping — group co-created legs.** Legs created in the same compose action show under a client-side label in Outgoing. Cosmetic only — **no server group column** (keeps legs independent).
3. **Updates mirror granularity — one entry per leg.** Each pending incoming swap leg gets its own urgent Updates mirror entry that deep-links to Swaps → Incoming. Matches the independent-legs model.
4. **Non-contiguous own-shift selection — steer to multi-leg.** Keep §8.1's one-contiguous-span-per-swap rule. A worker wanting non-adjacent chunks of their own shift makes separate legs; the picker enforces contiguity and points them to multi-leg rather than relaxing the rule.

## 10. Build order & test surface

Phased, lowest-risk first (each phase independently shippable):

- **Phase A — partial 1:1 picker.** Shared helpers + `SwapProposal` subset plumbing + block strips in both sheets. Backend untouched. Tests: `kotlin.test` on helpers/mapping; Maestro sub-range toggle.
- **Phase B — Swaps tab.** New tab + Incoming/Outgoing sub-tabs + `SwapsViewModel` (relocating existing synthesis/actions) + Updates deep-link mirror. Tests: Maestro `10-swaps-tab.yaml`; README selector contract.
- **Phase C — multi-leg compose.** Compose flow + review-before-send + per-leg `create-swap` fan-out + Outgoing grouping. Tests: `kotlin.test` on disjoint-block allocation logic; Maestro multi-leg compose.

Validate KMP each phase: `:shared:compileKotlinIosSimulatorArm64` (fast) then `:shared:linkDebugFrameworkIosSimulatorArm64`, plus `:shared:testAndroidHostTest` and `:androidApp:assembleDebug`. iOS sheet/tab changes verified via the local `iosApp.xcodeproj` build + simulator.

## 11. Affected files (index)

- `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/swaps/Swaps.kt` — `SwapProposal`, block-selection helpers, `buildSwapProposal` (A, C)
- `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/notifications/Notifications.kt` — swap synthesis lifted toward a `SwapsViewModel`; Updates mirror entry (B)
- new `…/shared/.../swaps/SwapsViewModel.kt` (or similar) — Incoming/Outgoing state (B)
- `apps/mobile/androidApp/.../ui/ShiftsScreen.kt` — tab row, `SwapSheet` block strips, Swaps screen (A, B, C)
- `apps/mobile/iosApp/iosApp/ContentView.swift` — `Tab` enum, `SwapSheetView` block strips, Swaps screen (A, B, C)
- `apps/mobile/maestro/` + `README.md` — new flow(s) + selector contract (A, B, C)
- **No** `supabase/` or `packages/core/` changes anticipated.
