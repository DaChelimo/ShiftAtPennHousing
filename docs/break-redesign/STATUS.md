# Break Redesign — STATUS

Live tracker for [PLAN.md](PLAN.md). Status: ☐ todo · ◐ in-progress · ☑ done.

| Chunk  | Title                                             | Effort | Depends    | Status | Notes                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------- | ------ | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **B0** | Spec / contract delta (§4.4 + ARCH note)          | S      | —          | ☑      | §4.4 "The calendar picker (round 1)" + "Round 2" + system-assigned-lane/trim; ARCH §2.9 read+write note                                                                                                                                                                                                                                          |
| **B1** | Backend: per-block FCFS range claim + grid read   | M      | B0         | ☑      | `20260615000001`: grid +block_id/+required_headcount, `claim_break_blocks` RPC, EF `block_ids` form. pgTAP `break-range-claim.sql` 14/14. types regen'd                                                                                                                                                                                          |
| **B2** | Shared logic: break calendar + drag/trim/coverage | L      | B0         | ☑      | `breakclaim/BreakCalendar.kt` (BreakPhase/coverage/`planBreakDrag`/apply/reconcile/drop/roster/weeks). `BreakCalendarTest` 16/16; full shared suite green; iOS compile clean                                                                                                                                                                     |
| **B3** | Live wiring: repository + viewmodel               | M      | B1, B2     | ☑      | `fetchBreakCalendar` + `claimBreakRange`/`BreakRangeResult` + `BreakGridRow` on repo; `ActiveBreak.breakName`; `BreakCalendarViewModel`. Android host tests green; iOS recompile clean                                                                                                                                                           |
| **B4** | Android UI (calendar + drag)                      | L      | B2, B3     | ☑      | `BreakCalendarScreen.kt` (week tabs/strip, vertical lane grid, tap+long-press drag, confirm bar w/ trim msg, mine-drop, read-only banner). Wired in MainActivity (demo+live) + ShiftsApp; `DemoData.breakCalendar`; `coverage.lanes`. assembleDebug green. Old `BreakClaimScreen.kt` now dead (pre-existing uncommitted edits → follow-up prune) |
| **B5** | iOS UI (SwiftUI mirror)                           | L      | B2, B3     | ☑      | `BreakCalendarView.swift` (Observable + screen, SwiftUI `DragGesture` claim, week tabs/strip, lane grid, claim bar, mine-drop, read-only banner) + ContentView wiring + `DemoFactory.breakCalendarViewModel` + pbxproj target entry. Framework link + SKIE export + `xcodebuild` BUILD SUCCEEDED                                                 |
| **B6** | Round 2 + nav promotion                           | M      | B3, B4, B5 | ☑      | Round 2 already wired: `worker_open_shifts` view includes break seats once `open_feed` → leftovers appear in the regular Open Shifts tab automatically; Break screen shows read-only "see Open Shifts" banner. Nav: `BreakOpenBanner` (both platforms) promotes the calendar from every tab while the claim window is open                       |
| **B7** | Maestro + verification                            | M      | B4, B5, B6 | ☑¹     | `06-claim-break.yaml` rewritten (banner → calendar → tap block → claim bar → claim → toast) + README selector contract. ¹Emulator/simulator run is manual (not runnable from the JVM host) — per project convention                                                                                                                              |

## Key decisions (see PLAN.md "Decisions")

1. Free-form drag claiming (any 30-min range).
2. System-assigned lane; FCFS trims to the open part + reports it. ← B2 tested surface.
3. Dedicated Break screen rebuilt as a calendar; promoted to a tab while active.
4. Mobile (Android + iOS) first; web admin unchanged.
5. Multi-staff = lanes; read-only cards show names. Single-staff = one lane.
6. Can't over-claim coverage (DB headcount guard).

## Log (newest first)

- 2026-06-16 — **Bugfix: claims didn't persist.** Root cause: the DB had **no break
  scheduled** (`break_periods` empty — `seed.sql` defines break profiles/staffing but never
  schedules one), so the LIVE build's `fetchActiveBreak()` returned null and the host fell
  back to `DemoData.breakCalendar` — a fake, `claim_window`, **non-UUID-block-id** calendar.
  Claims POSTed garbage the `break-claim` EF rejected; the app swallowed the write → "claimed"
  toast, nothing saved → the 2nd SW saw nothing. Fixes: (1) `noBreakCalendar(meUserId, now)`
  - `BreakCalendarSnapshot.noActiveBreak` + UI state → the LIVE build now shows an honest
    "No break scheduled" state (never the demo calendar); demo build unchanged. (2) Claims that
    return ZERO claimed seats are now surfaced as a failure (toast + revert) on both platforms,
    not a false success. (3) `supabase/seeds/demo_break.sql` — idempotent, reversible,
    CURRENT_DATE-anchored short break (re-profiles the next 5 days, NO deletes) so the local DB
    has a real claimable break (verified: claim_window, 818 vacant seats; a real worker's claim
    persists end-to-end via `claim_break_blocks`). Edge runtime restarted to serve the current
    EF (block_ids branch). All gates green.

## Log

- 2026-06-15 — Plan written. Research complete: backend two-round model already exists
  (`break_claim_phase` + `weekly_open_shifts_feed` fold-in); `house_schedule_grid` reusable
  as the calendar read model. Only new engine = `claim_break_blocks` (per-block FCFS).
- 2026-06-15 — **B0–B7 ALL COMPLETE.** Spec/ARCH updated; migration `20260615000001` +
  pgTAP `break-range-claim.sql` 14/14; shared `BreakCalendar.kt` + `BreakCalendarTest` 16/16
  (full shared suite green); repo + `BreakCalendarViewModel`; Android `BreakCalendarScreen`
  (assembleDebug green); iOS `BreakCalendarView` (`xcodebuild` green); round-2 via
  `worker_open_shifts`; `BreakOpenBanner` promotion both platforms; Maestro `06` rewritten.
  Gates: shared JVM 16-new/all-green · iOS link+SKIE+xcodebuild · Android assembleDebug ·
  pgTAP 14/14 (temp pgtap ext, rolled back). **Pending:** Maestro emulator/sim run (manual).
- 2026-06-15 — **Dead flat-list path PRUNED** (the spawned task ran): `BreakClaim.kt`,
  `BreakClaimViewModel`, `BreakClaimScreen.kt`, `BreakClaimView.swift`, `BreakClaimTest.kt`,
  `DemoData.breakClaim`, `DemoFactory.breakClaim*` removed; the shared meter
  (`BreakHoursMeter`/`buildBreakHoursMeter`) moved into `BreakCalendar.kt`; `ActiveBreak`
  slimmed to id/name/window. Build stays green.
- 2026-06-15 — **UI refinements (user feedback):** (1) the dragged area is now clearly
  highlighted during AND after the drag — the selection fill moved onto the OPEN lane cells
  (a row-level tint was occluded by them), both platforms; (2) removed the "Your break
  shifts" section at the end of the page (Android + iOS); (3) the demo break now spans 3
  weeks so the **week pager** (`break_calendar_week_tabs` / `selectWeek`) is exercised —
  tap a week pill to move between the break's weeks, each re-scoping the day strip + grid.
- 2026-06-16 — **Interaction redesign (user feedback round 2):** (1) `planBreakDrag` now
  returns a **mode** — DROP when the selection is entirely the worker's own coverage
  (offers a confirm-to-drop), CLAIM otherwise, anchored at the FIRST open block so a drag
  that starts on your own shift then runs over open capacity claims only the open part
  (`BreakDragMode`/`dropSeatIds`/`dropLabel`; `BreakCalendarTest` 18/18 incl. drop + mixed).
  (2) The action bar is now PINNED above the bottom nav on both platforms (Android: grid in
  a `weight(1f)` Box + bar as the last Column child; iOS: break tab rendered OUTSIDE the
  shared ScrollView as a full-height VStack via `breakTab`). It is contextual (Claim vs
  Drop confirm). (3) Gesture is vertical + per-30-min-chunk: tap = one chunk, long-press +
  vertical drag extends (iOS uses a long-press-sequenced drag + SpatialTap so a plain swipe
  still scrolls). (4) Padding/spacing added (notably day-selector ↔ grid). All gates green:
  shared suite, `:androidApp:assembleDebug`, `xcodebuild`.
- 2026-06-16 — **Multi-staff seat clarity (user feedback round 3):** (1) greyed
  "Desk 1 / Desk 2 …" column headers above the grid for multi-staff houses (chosen over a
  sentence hint). (2) Drag now highlights **ONE seat per timeslot** — the open seat nearest
  the finger (`BreakBlockCoverage.highlightLane(preferredColumn)`, pure+tested): a half-full
  slot highlights its open (right) side; a 2-open slot highlights the column under the finger
  (the gesture tracks the finger's x → desk column); a full slot in a dragged range is
  skipped (no highlight + trimmed by `planBreakDrag`). Fixes the "both seats highlight"
  confusion. (3) Confirmed seats are not position-stored — occupied left-pack
  (`buildBreakCoverage` is occupied-first), so an empty right = a vacancy. `BreakCalendarTest`
  19/19; all gates green.
