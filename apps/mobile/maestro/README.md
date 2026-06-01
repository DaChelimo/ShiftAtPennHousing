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
| `01-view-my-shifts.yaml`   | §5.6            | The three-tab structure + Tab 1's three subsections.        |
| `02-claim-shift.yaml`      | §5.3, §5.4      | Claim an open shift (soft-cap warning if any) → My Shifts.  |
| `03-drop-shift.yaml`       | §5.2            | Drop a shift (occurrence) → it lands in the Dropped section.|
| `04-acknowledge-float.yaml`| §7.1, §7.2      | Acknowledge a float from the ack/decline modal.             |

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

| id                          | Element                                                  |
| --------------------------- | -------------------------------------------------------- |
| `shifts_screen`             | Shifts screen root.                                      |
| `tab_my_shifts`             | Tab 1 selector ("My Shifts").                            |
| `tab_open_home`             | Tab 2 selector ("Open Shifts in My House").              |
| `tab_open_other`            | Tab 3 selector ("Open Shifts in Other Houses").          |
| `section_picked_up`         | My Shifts → Picked-up subsection (top).                  |
| `section_dropped`           | My Shifts → Dropped subsection (middle).                 |
| `section_scheduled`         | My Shifts → their (scheduled) subsection (bottom).       |
| `home_weekly_feed`          | Tab 2 weekly feed container.                             |
| `home_permanent_feed`       | Tab 2 permanent-openings container.                      |
| `other_houses_tab`          | Tab 3 container (grouped houses or empty state).         |
| `open_shift_card`           | An open-shift card in a feed.                            |
| `claim_button`              | Claim affordance on an open-shift card.                  |
| `soft_cap_warning_modal`    | >20h soft-cap warning (§5.3).                            |
| `soft_cap_confirm_button`   | Confirm-through-warning button.                          |
| `claim_confirm_button`      | Final claim confirmation.                                |
| `claim_success`             | Claim success state.                                     |
| `picked_up_shift_card`      | A card in the Picked-up subsection.                      |
| `scheduled_shift_card`      | A card in the their-shifts subsection.                   |
| `drop_options_sheet`        | Drop-type popup ("this occurrence" / "permanently").     |
| `drop_occurrence_option`    | "Drop this occurrence".                                  |
| `drop_permanent_option`     | "Drop permanently".                                      |
| `drop_short_notice_warning` | <20m short-notice warning (§5.2).                        |
| `drop_short_notice_continue`| Continue-through short-notice warning.                   |
| `drop_confirm_button`       | Final drop confirmation.                                 |
| `dropped_shift_card`        | A card in the Dropped subsection.                        |
| `tab_updates`               | Updates tab (where pending floats surface).              |
| `pending_float_notification`| A pending-float entry in the updates tab.                |
| `ack_modal`                 | Float ack/decline modal (§7).                            |
| `ack_button`                | Acknowledge.                                             |
| `decline_button`            | Decline.                                                 |
| `ack_success`               | Acknowledge success state.                               |
| `ack_deadline_passed`       | Disabled state after the T-10m deadline (§7.1).          |
