# Phase 13a — Worker Mobile (Compose Multiplatform): Test Session

## Session Metadata

|                   |                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| **Model**         | Claude Opus 4.7 (`claude-opus-4-7`)                                                                       |
| **Interface**     | Claude Code CLI                                                                                           |
| **Thinking mode** | Standard                                                                                                  |
| **TDD role**      | Test author — write tests only                                                                            |
| **Platform**      | Kotlin Multiplatform — Android + iOS                                                                      |
| **Note**          | Most UI behavior is verified via Maestro E2E flows. Unit tests focus on ViewModel logic and data mapping. |

---

## Prompt

You are writing tests for Phase 13a: Worker Mobile App (Compose Multiplatform — Android + iOS).

Branch: `phase-13a-worker-mobile`.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §5.6 (Shifts screen — 3-tab layout)
- BEHAVIORAL_SPECIFICATION.md §5.2 (drop flows)
- BEHAVIORAL_SPECIFICATION.md §5.3 (claim flows)
- BEHAVIORAL_SPECIFICATION.md §7 (float acknowledgment)
- BEHAVIORAL_SPECIFICATION.md §11 (calendar and shift cards — if section exists)
- AGENTS.md

---

### Behavioral surfaces to cover

**Shifts screen 3-tab layout:**

- Tab 1 (My Shifts): picked-up shifts on top, dropped-but-still-open in middle, regular schedule on bottom
- Tab 2 (Open Shifts — Home House): weekly feed + permanent openings for home house
- Tab 3 (Open Shifts — Other Houses): grouped by house; empty during winter break for non-Harnwell workers

**Ack/decline flow:**

- Float notification received → ack/decline modal appears
- Acknowledge before deadline → success state
- Decline → confirms void
- After deadline → modal disabled, shows "deadline passed"

**Drop flow:**

- Tap shift → options popup: "Drop this occurrence" or "Drop permanently"
- Drop within 20 minutes → warning shown before confirmation
- Mid-shift drop-from-now: shows rounded-down block as the drop start
- After confirm → shift removed from My Shifts, appears in Dropped section if still open

**Claim flow:**

- T-2h unpickable: claim button disabled on shifts past cutoff
- Cross-house pickup: shift card shows destination house name
- Soft cap warning modal before confirming a claim that exceeds 20h

---

### Test files

1. `apps/mobile/shared/src/commonTest/kotlin/ShiftsScreenViewModelTest.kt` — KMP unit tests: tab data mapping, grouping logic (picked-up/dropped/scheduled). (Shared ViewModels live in `:shared`; the Compose/SwiftUI UIs in `:androidApp`/`iosApp` render them.)
2. `apps/mobile/shared/src/commonTest/kotlin/AckDeclineViewModelTest.kt` — deadline logic
3. `apps/mobile/maestro/` — Maestro E2E flows (run on both Android emulator + iOS simulator):
   - `01-view-my-shifts.yaml` — launches app, verifies 3-tab structure
   - `02-claim-shift.yaml` — finds an open shift, claims it, verifies it appears in My Shifts
   - `03-drop-shift.yaml` — drops a shift, verifies it appears in Dropped section
   - `04-acknowledge-float.yaml` — taps ack on a float notification
4. `tests/PHASE_13a/TEST_PLAN.md`

---

### Commit

```
git commit -m "phase-13a tests: Shifts screen ViewModel unit tests, ack/decline deadline logic, Maestro E2E flows (claim, drop, acknowledge) — Android + iOS"
```
