# Worker-app E2E flows (Maestro)

Cross-platform Maestro flows for the Phase 13a worker mobile app. The **same**
flows run against the Android emulator and the iOS simulator — Maestro drives the
native UI by accessibility identifier, so each flow is platform-agnostic.

These are **TDD-red**: the Compose (`:androidApp`) and SwiftUI (`iosApp`) screens
that satisfy them are not built yet. The flows are the executable UI contract for
that build. Until the screens exist (and expose the selectors below), the flows
fail at the first missing element — the intended red state, mirroring the
not-yet-implemented shared ViewModels under test in `:shared`'s `commonTest`.

## Flows

| Flow                       | Behavioral spec | What it verifies                                            |
| -------------------------- | --------------- | ----------------------------------------------------------- |
| `01-view-my-shifts.yaml`   | §5.6, §11.2     | The tab structure; My Shifts is the calendar (default tab); Open Shifts collapses the two feeds under "My House" / "Others" sub-tabs. |
| `02-claim-shift.yaml`      | §5.3, §5.4      | Claim an open shift (soft-cap warning if any) → it shows in My Shifts (the agenda). |
| `03-drop-shift.yaml`       | §5.2            | Drop a shift from the agenda → it leaves My Shifts and shows in the Open-Shifts feed. |
| `04-acknowledge-float.yaml`| §7.1, §7.2      | Acknowledge a float from the ack/decline modal.             |
| `05-submit-preferences.yaml`| §6 prefs       | Paint a block + submit the preference timeline (editable until the deadline).|
| `06-claim-break.yaml`      | §4.4 break      | Open the break CALENDAR (via the active-break banner), tap an open block, claim the (trimmed) range → "Break shift claimed" toast. |
| `07-settings.yaml`         | §6 settings     | Open Settings, toggle the broadcast subscription.           |
| `08-calendar-week.yaml`    | §11.2 calendar  | My Shifts (calendar) defaults to the whole-week overview; Day/Week toggle drills in and back; the day-strip is hidden in Week and shown in Day. |
| `09-my-shifts-week.yaml`   | §11.2           | My Shifts (calendar) week navigation — step to next week (future shifts show), jump back via the picker. |
| `12-open-shifts-week.yaml` | §5.1, §5.6      | Open-Shifts week navigation (last week … +4) — current week by default, step forward shows a later week's openings, the picker jumps back; already-started openings sit in the collapsed "Earlier this week" card. Applies to both sub-tabs. |
| `13-house-grid.yaml`       | §11.4           | House schedule as an Excel-style week grid: the time rail stays frozen while the day columns scroll sideways, week navigation (last week … +4) re-renders the grid, and tapping a staffed block opens the §11.4 contact sheet. |

> **Live-data-only surfaces (no demo flow).** The `open_shift_count_badge` ("N open") and
> the open-shift `claim_range_selector` only appear with **multi-block / concurrent** data.
> The demo open-shift pool is single-block, so these are exercised against a live backend or
> verified manually — not by the demo flows above. (The break calendar's multi-lane drag IS
> exercised by the demo, whose Harnwell window seeds 2 lanes.)

> **Login** has no flow here: it is the LIVE path only (the demo bypasses it on both
> platforms), so it cannot run without a configured backend. Its selectors are listed
> below for a future backed flow; verify login in Xcode / against a live backend.

## Running

Prerequisite: a debug build installed on a running emulator/simulator. Use the
`android` CLI (skill: `android-cli`) to manage the Android emulator and device runs.

```sh
# Android (emulator must be running; app installed):
./gradlew :androidApp:installDebug
maestro test apps/mobile/maestro/

# iOS (simulator must be booted; iosApp installed via Xcode):
# The flows declare appId: com.pennhousing.shift (the Android applicationId). If the
# iosApp bundle identifier differs, override it per run:
maestro test --app-id <ios.bundle.identifier> apps/mobile/maestro/
```

## Selector contract (testTag / accessibilityIdentifier)

The screens MUST expose these stable ids. On Android attach them with
`Modifier.testTag("…")`; on iOS with `.accessibilityIdentifier("…")`.

> **Navigation is a BOTTOM bar** (Android: Material 3 `NavigationBar`; iOS: a custom
> HIG-style bottom bar). Four frequent destinations are always visible — `tab_my_shifts`,
> `tab_open_shifts`, `tab_house`, `tab_swaps` — plus `tab_more`, which opens the
> `more_sheet` overflow. The less-frequent destinations (`tab_updates`, `tab_preferences`,
> `tab_break`, `tab_settings`) live as rows INSIDE `more_sheet`: tap `tab_more` first,
> then the row. The unread dot rides on `tab_more` (Updates lives inside it). Every tab
> also shows a large page title top-left, and My Shifts' week navigator sits at the
> BOTTOM (above the nav bar). (Swaps is also reachable by tapping a
> `swap_request_notification` mirror in the Updates screen, which deep-links into it.)

| id                          | Element                                                  |
| --------------------------- | -------------------------------------------------------- |
| `shifts_screen`             | Shifts screen root.                                      |
| `tab_my_shifts`             | Bottom-bar item 1 ("My Shifts" — the Personal Calendar; the default tab). |
| `tab_open_shifts`           | Bottom-bar item 2 ("Open Shifts") — collapses the My-House + cross-house feeds under sub-tabs. |
| `tab_house`                 | Bottom-bar item 3 ("House" — the §11.4 home-house schedule). |
| `tab_swaps`                 | Bottom-bar item 4 ("Swaps" — the dedicated Swaps tab, DESIGN §6). |
| `tab_more`                  | Bottom-bar overflow item ("More") — opens `more_sheet`; carries the unread dot. |
| `more_sheet`                | The "More" overflow sheet (Updates / Preferences / Break shifts / Settings rows). |
| `open_shifts_subtabs`       | The "My House" / "Others" sub-tab control (iOS; Android uses a SecondaryTabRow). |
| `tab_open_home`             | Open Shifts → "My House" sub-tab (the default).          |
| `tab_open_other`            | Open Shifts → "Others" sub-tab (cross-house feeds).      |
| `home_weekly_feed`          | My-House sub-tab weekly feed container.                  |
| `home_permanent_feed`       | My-House sub-tab permanent-openings container.           |
| `other_houses_tab`          | Others sub-tab container (grouped feed or empty state).  |
| `other_houses_sort`         | Others sub-tab "By house" / "By day" grouping toggle.    |
| `group_header`              | A collapsible Others-tab group header (tap to collapse/expand). |
| `past_open_section`         | "Earlier this week" — collapsed-by-default greyed card of already-started openings (both sub-tabs). |
| `open_week_picker_open`     | Open-Shifts week navigator (bottom bar) — tap to open the week picker. |
| `open_prev_week` / `open_next_week` | Open-Shifts week navigator — step to the previous / next week (last week … +4). |
| `open_week_picker_sheet`    | The Open-Shifts week-picker sheet.                       |
| `open_week_picker_option`   | One quick-week row in the Open-Shifts picker.            |
| `open_shift_card`           | An open-shift card in a feed.                            |
| `open_shift_count_badge`    | "N open" badge — concurrent identical openings at a multi-staff house (live multi-staff data only). |
| `claim_button`              | Claim affordance on an open-shift card.                  |
| `claim_range_selector`      | Open-shift partial-claim "How much can you cover?" selector (multi-block opening). |
| `claim_range_label`         | Live range/duration summary in the claim sheet.          |
| `soft_cap_warning_modal`    | >20h soft-cap warning (§5.3).                             |
| `soft_cap_confirm_button`   | "Claim anyway" — claims immediately, one tap, no second confirm step. |
| `claim_confirm_button`      | Final claim confirmation (shown when there is no soft-cap warning). |
| `claim_success`             | Claim success state.                                     |
| `manage_shift_sheet`        | The manage-shift sheet, opened by tapping a `calendar_shift_card`. Holds the Drop/Swap intent cards, the shared scope, and the shared "How much" range. |
| `intent_drop` / `intent_swap` | Equal-weight intent cards — "Drop the shift" vs "Swap it" (`intent_swap` is disabled when the card can't swap). |
| `scope_segmented`           | The shared this-week / permanent scope control (drives BOTH drop and swap). |
| `scope_this_week` / `scope_permanent` | The two scope segments; `scope_permanent` dims when the current intent can't go permanent. |
| `drop_range_selector` / `drop_range_label` / `drop_from_now` | The shared "How much" range — sizes the drop AND pre-fills the swap give. |
| `drop_short_notice_warning` | <20m short-notice warning (§5.2, drop intent only).      |
| `drop_short_notice_continue`| Continue-through short-notice warning.                   |
| `drop_confirm_button`       | Final drop confirmation (Drop intent). A dropped shift leaves the agenda and shows in the Open-Shifts feed (no "reclaim"). |
| `swap_continue_button`      | "Choose who to swap with" — the Swap-intent pivot; opens `swap_calendar_sheet` pre-filled with the selected range + scope (§8). |
| `swap_calendar_sheet`       | The week-paged give/take swap sheet (the live Swap-intent target). |
| `swap_take_list` / `swap_take_row` | The counterparty day list + one pickable housemate run. |
| `swap_sheet`                | The swap-proposal sheet (kind + counterparty + pickers). |
| `swap_candidate_list`       | The counterparty picker list.                            |
| `swap_candidate_row`        | One pickable counterparty (run, or person for permanent).|
| `swap_give_range`           | §8.1 partial picker — "your hours to give" range slider (clamped to the active free run once a leg is banked). |
| `swap_take_range`           | §8.1 partial picker — "hours you want" range slider (clamped to the active free run). |
| `swap_give_timeline`        | Segmented give timeline — appears once a part is banked; locked/free/active runs. |
| `swap_take_timeline`        | Segmented take timeline — appears when re-taking a counterparty shift you already took part of. |
| `swap_seg_locked` / `_active` / `_free` | One timeline segment: given-away (locked), current selection (active), or tap-to-focus (free). |
| `swap_suggestion`           | "Give the next part to X too" chip — one tap re-pins the last counterparty for the next free run. |
| `swap_overlap_warning`      | Shown when the chosen give-hours overlap an already-added leg. |
| `swap_add_leg_button`       | "Add another person" — multi-leg (independent legs) entry. |
| `swap_legs`                 | Committed-legs container (multi-party compose).          |
| `swap_leg_row`              | One committed leg chip; `swap_leg_remove` removes it.    |
| `swap_submit_button`        | Submit the proposal(s) — one `create-swap` per leg.      |
| `swap_proposed_toast`       | "Swap proposed" confirmation toast.                      |
| `tab_updates`               | Updates row inside `more_sheet` (where pending floats + swap mirrors surface).|
| `pending_float_notification`| A pending-float entry in the updates tab.                |
| `swap_request_notification` | An incoming-swap MIRROR row in Updates — tap to deep-link to the Swaps tab (DESIGN §6). |
| `swaps_screen`              | The Swaps tab root.                                      |
| `swaps_subtab_incoming`     | Swaps → Incoming sub-tab (received requests).            |
| `swaps_subtab_outgoing`     | Swaps → Outgoing sub-tab (requests I made).              |
| `swaps_incoming_list`       | Incoming list container.                                 |
| `swaps_outgoing_list`       | Outgoing list container.                                 |
| `swaps_group_header`        | "Proposed together · N people" header over co-created legs. |
| `swap_request_row`          | One Incoming/Outgoing swap card.                         |
| `swap_accept_button`        | Accept an incoming temporary swap (Swaps → Incoming).    |
| `swap_reject_button`        | Decline an incoming swap.                                |
| `swap_void_button`          | Cancel an outgoing swap leg (Swaps → Outgoing).          |
| `ack_modal`                 | Float ack/decline modal (§7).                            |
| `ack_button`                | Acknowledge.                                             |
| `decline_button`            | Decline.                                                 |
| `ack_success`               | Acknowledge success state.                               |
| `ack_deadline_passed`       | Disabled state after the T-10m deadline (§7.1).          |
| `calendar_screen`           | My Shifts (the Personal Calendar) screen root — Tab 1.   |
| `week_total_chip`           | "This week — Xh of cap" hours chip, under the week header. |
| `float_carousel`            | The §7.1 float-request carousel (brand-blue card stack) directly under the hours chip — rendered only when the worker has pending floats; swipe between cards (sorted closest-start first). |
| `float_card`                | One full-width float-request card. Tapping the body opens the ack detail (`ack_modal`) for that float. |
| `float_card_accept`         | Accept the float on the current card — POSTs `acknowledge-float` and advances to the next closest float. |
| `float_card_decline`        | Decline the float on the current card — POSTs `decline-float` and advances. After the LAST one resolves, the carousel collapses and an "All float requests handled" success toast shows (then auto-dismisses). |
| `calendar_week_strip`       | The Mon–Sun day-picker strip — shown in Day mode only (hidden in Week mode). |
| `calendar_day_cell`         | A day cell in the week strip.                            |
| `calendar_view_toggle`      | The Week / Day view toggle.                              |
| `calendar_view_week`        | "Week" segment — the whole-week overview (the DEFAULT).  |
| `calendar_view_day`         | "Day" segment — the single-day drill-in.                 |
| `calendar_week_overview`    | The whole-week stacked-day overview (default view).      |
| `calendar_day_section`      | One day's section (header + agenda) in the week overview.|
| `calendar_agenda`           | The selected day's agenda list (Day view).               |
| `calendar_shift_card`       | A shift card in the agenda. Tapping it opens the drop sheet (§5.2; pivots to swap, §8). |
| `calendar_shift_card_swap`  | A shift card flagged with a pending swap. Tapping an INCOMING one opens the accept/decline popup (`swap_decision_sheet`); an OUTGOING one opens the "swap pending" notice (`pending_swap_notice_sheet`) — it can't be dropped/swapped while the swap is live. |
| `pending_swap_notice_sheet` | The "swap pending" card for an OUTGOING swap, opened by tapping an outgoing `calendar_shift_card_swap`. |
| `pending_swap_cancel`       | "Cancel swap / hand-off" in the notice — voids the swap, freeing the shift. |
| `pending_swap_keep_waiting` | "Keep waiting" in the notice — minimises the card (no action); the corner ✕ does the same. |
| `calendar_week_picker_open` | Week header — tap to open the week picker.               |
| `calendar_prev_week` / `calendar_next_week` | Week header — step to the previous / next week. |
| `week_picker_sheet`         | The week-picker sheet (quick weeks + derived template).  |
| `week_picker_option`        | One quick-week row in the picker.                        |
| `house_screen`              | The House tab root (§11.4 home-house schedule).          |
| `house_call_desk`           | "Call desk" button in the house header card.             |
| `house_grid`                | The week-grid container (time rail + scrolling day columns). |
| `house_time_rail`           | The fixed left time rail — stays put while the day columns scroll sideways. |
| `house_day_column`          | One Mon–Sun day column (surface card + lane-placed blocks). |
| `house_grid_block`          | One positioned desk block; tap a staffed one → the contact sheet. |
| `house_week_picker_open`    | House week navigator (bottom bar) — tap to open the week picker. |
| `house_prev_week` / `house_next_week` | House week navigator — step to the previous / next week (last week … +4; the chevron hides at the bound). |
| `house_week_picker_sheet`   | The House week-picker sheet.                             |
| `house_week_picker_option`  | One quick-week row in the House picker.                  |
| `contact_sheet`             | The §11.4 contact sheet: the tapped slot (`contact_time`) + the person on it. |
| `contact_person_card`       | The person card inside the sheet — avatar in the worker's own colour, `contact_name`, `contact_house`, `contact_phone`, `contact_email`. |
| `contact_call_button`       | "Call {worker}" (opens the dialer prefilled); `contact_email_button` opens a mail compose; `contact_call_desk` calls the desk line. |
| `tab_preferences`           | Preferences row inside `more_sheet` (preference submission). |
| `preferences_screen`        | Preferences screen root.                                 |
| `pref_week_strip`           | The Mon–Sun day picker for the preference week.          |
| `pref_day_cell`             | A day cell in the preference week strip.                 |
| `pref_target_stepper`       | The target-weekly-hours stepper card.                    |
| `pref_target_increment`     | Increment target hours (+2).                             |
| `pref_target_decrement`     | Decrement target hours (−2).                             |
| `pref_no_hours_toggle`      | "I have no hours this week" toggle.                      |
| `pref_brush_available`      | Brush: Available.                                        |
| `pref_brush_preferred`      | Brush: Preferred.                                        |
| `pref_brush_cannot`         | Brush: Cannot.                                           |
| `pref_block_grid`           | The selected day's paintable block column. A pure PAINT canvas: it consumes its own drags and never scrolls the page. |
| `pref_time_gutter`          | The left hour column, which doubles as the page SCROLL handle (the grid beside it won't scroll). Drag here to move through the day. |
| `pref_block_cell`           | A paintable 30-min segment. A single tap paints one block; a drag across the grid paints the whole span (and auto-scrolls at the viewport edge to keep going). |
| `submit_preferences_button` | Submit the preferences (label "Submit changes" when re-submitting edits). Shown only when there are unsaved edits or no prior submission. |
| `pref_discard_button`       | Discard unsaved edits → revert to the last-saved state. Shown only when dirty. |
| `pref_unsaved_sheet`        | The unsaved-changes guard sheet raised on leaving the tab dirty (Android). Buttons: `pref_unsaved_submit` / `pref_unsaved_discard`. |
| `tab_break`                 | Break-shifts row inside `more_sheet` (break CALENDAR picker). |
| `break_open_banner`         | Active-break promotion banner (shown on other tabs while the claim window is open) → opens the Break calendar. |
| `break_calendar_screen`     | Break calendar screen root.                              |
| `break_hours_meter`         | The "this break / 40h" hard-cap meter.                  |
| `break_calendar_week_tabs`  | Week pager (multi-week breaks, e.g. winter).            |
| `break_calendar_week_strip` | Mon–Sun day strip (in-window days are claimable).        |
| `break_calendar_day`        | The selected day's vertical lane grid (drag surface).    |
| `break_block_row`           | One 30-min block row; tap = single-block select, long-press-drag = range. |
| `break_calendar_claim_bar`  | The pinned bottom action bar (claim/drop) shown after a selection. |
| `break_calendar_claim_button`| Claim the selected (trimmed) range.                     |
| `break_calendar_drop_button`| Drop your own coverage (shown when the selection is entirely your shifts). |
| `break_no_hours_toggle`     | The §4.4 "no break hours" opt-out tick.                  |
| `break_calendar_readonly_banner`| Round-2 "claiming closed → see Open Shifts" banner (open_feed phase). |
| `break_calendar_success`    | "Break shift claimed" toast.                             |
| `tab_settings`              | Settings row inside `more_sheet` (profile + preferences). |
| `settings_screen`           | Settings screen root.                                    |
| `settings_broadcast_toggle` | "General updates" broadcast-subscription switch.         |
| `settings_theme_segmented`  | Appearance theme segmented control (System/Light/Dark).  |
| `settings_sign_out`         | Sign-out row.                                            |
| `login_screen`              | Login screen root (live path only).                      |
| `login_email`               | Email field.                                             |
| `login_password`            | Password field.                                          |
| `login_submit`              | Sign-in button.                                          |
| `login_cancel`              | Cancels an in-flight sign-in (rendered only while submitting). |
| `login_error`               | Sign-in error banner.                                    |
