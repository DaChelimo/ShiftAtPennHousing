# Parity Status — live chunk tracker

Update the row (status / gate / commit) as the **last step** of every chunk. See [`PLAN.md`](PLAN.md).

Status legend: ☐ pending · ◐ in-progress · ☑ done (gate green) · ⚠ blocked/needs-decision

## Track T1 — Wire existing backends + test

| ID   | Chunk                                                                                                                                                      | Status | Gate result            | Commit    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------- | --------- |
| T1-0 | Mobile data-layer write foundation (reusable `EdgeFunctionClient`) — folded into T1-2 (first write caller); `PreferencesRepository` is the proven template | ☐      | —                      | —         |
| T1-1 | Updates feed live (`fetchNotifications`/`observeNotifications` already exist, just uncalled)                                                               | ☑      | JVM+assemble+iOS green | `PENDING` |
| T1-2 | My Shifts drop/reclaim (+ creates `EdgeFunctionClient`)                                                                                                    | ☐      | —                      | —         |
| T1-3 | Open Shifts claim                                                                                                                                          | ☐      | —                      | —         |
| T1-4 | Float ack/decline                                                                                                                                          | ☐      | —                      | —         |
| T1-5 | Break claim/drop                                                                                                                                           | ☐      | —                      | —         |
| T1-6 | Preferences submit                                                                                                                                         | ☑      | pre-landed             | `f53d335` |
| T1-7 | Settings broadcast + profile                                                                                                                               | ☐      | —                      | —         |
| T1-8 | Login live path                                                                                                                                            | ☐      | —                      | —         |
| T1-9 | Web inbox realtime                                                                                                                                         | ☐      | —                      | —         |

## Track T2 — Build missing backend + UI

| ID    | Chunk                                                                   | Status | Gate result | Commit |
| ----- | ----------------------------------------------------------------------- | ------ | ----------- | ------ |
| T2-1  | Read-model fixes (dropped_still_open, closed-house)                     | ☐      | —           | —      |
| T2-2  | Break completeness (periods, no-hours opt-out, T-1d routing)            | ☐      | —           | —      |
| T2-3  | Permanent pickup (backend 501→real + UI + web feed)                     | ☐      | —           | —      |
| T2-4  | Worker permanent drop + float-drop exception                            | ☐      | —           | —      |
| T2-5  | Set-deadline RPC + web wire                                             | ☐      | —           | —      |
| T2-6  | Hire/Fire RPC + web People                                              | ☐      | —           | —      |
| T2-7  | Rotor academic-year truncation (spec bug)                               | ☐      | —           | —      |
| T2-8  | Mark-read (UPDATE policy + UI)                                          | ☐      | —           | —      |
| T2-9  | Notification channels backing                                           | ☐      | —           | —      |
| T2-10 | Partial-claim (design-extra)                                            | ☐      | —           | —      |
| T2-11 | Partial drop UI (§5.2)                                                  | ☐      | —           | —      |
| T2-12 | Web build-missing (switcher, closed-house, search, leave, config cards) | ☐      | —           | —      |
| T2-13 | Full-screen FloatAckSurface + routing                                   | ☐      | —           | —      |

## Track T3a — Swaps on mobile

| ID    | Chunk                                     | Status | Gate result | Commit |
| ----- | ----------------------------------------- | ------ | ----------- | ------ |
| T3a-1 | Swap data layer + accept/reject from feed | ☐      | —           | —      |
| T3a-2 | Initiate temporary shift swap             | ☐      | —           | —      |
| T3a-3 | Float swap + permanent swap initiate      | ☐      | —           | —      |
| T3a-4 | Void/cancel + calendar live-update        | ☐      | —           | —      |

## Track T3b — Contact / grid / calendar-advanced

| ID    | Chunk                                                                                         | Status | Gate result | Commit |
| ----- | --------------------------------------------------------------------------------------------- | ------ | ----------- | ------ |
| T3b-1 | ⚠ Backend (desk-phone + cross-worker RLS + roster view + date-param model) — **RLS decision** | ⚠      | —           | —      |
| T3b-2 | Shift-detail + contact-lookup sheet                                                           | ☐      | —           | —      |
| T3b-3 | House schedule grid                                                                           | ☐      | —           | —      |
| T3b-4 | Calendar advanced (week-picker, month, template)                                              | ☐      | —           | —      |

## Track TB — Test backfill

| ID   | Chunk                                                  | Status | Gate result | Commit |
| ---- | ------------------------------------------------------ | ------ | ----------- | ------ |
| TB-1 | Web live-calendar grid                                 | ☐      | —           | —      |
| TB-2 | Web hours report                                       | ☐      | —           | —      |
| TB-3 | Web coverage monitor                                   | ☐      | —           | —      |
| TB-4 | Web config + health                                    | ☐      | —           | —      |
| TB-5 | Web inbox/force-trigger/leave/rotor/cap/prefs residual | ☐      | —           | —      |
| TB-6 | Mobile residual                                        | ☐      | —           | —      |

---

_Last updated: T1-1 done (Updates feed wired to live `fetchNotifications` on the authed path, Android + iOS; demo path unchanged). Next: T1-2 (drop + EdgeFunctionClient)._
