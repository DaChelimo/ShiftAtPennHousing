# Parity Plan — Shift@PennHousing

Closing the design↔spec↔backend↔UI↔wiring↔tests gaps surfaced by the parity audit.
Companion artifacts: [`MATRIX.md`](MATRIX.md) (every feature row + file:line evidence),
[`STATUS.md`](STATUS.md) (live chunk tracker).

## Source of truth & locked decisions

- **Spec wins.** `BEHAVIORAL_SPECIFICATION.md` (root) is authoritative over the designs.
  `ARCHITECTURE.md` for how the schema enforces it. The two `design/*/PROGRESS.md` files are
  _historical_ self-reports — already partly stale (live wiring is in-flight on this branch).
- **Build design-additive features** (user decision): where the design adds a capability the
  spec doesn't _forbid_ (partial-claim trim, in-app Call-Allied/Mark-covered, desk-call), build
  it and add spec backing as needed.
- **The one design-extra we do NOT build — flagged exception:** mobile per-category
  notification toggles for _personal_ notifications (float / shift-reminder / schedule-published).
  Spec §10.1 makes personal notifications **mandatory and non-silenceable** (safety: a worker
  must not be able to miss a float). Only the broadcast/"General updates" channel is opt-in.
  Those three stay always-on/disabled. (Matrix conflicts C6.)
- **Scope = all four tracks** (T1 wire, T2 build-missing, T3a swaps, T3b contact/grid/calendar)
  - a test-backfill track (TB).

## Verification doctrine (token-efficient: ~90% cheap-tier)

Every chunk has an **acceptance gate**. Prefer the cheapest tier that actually proves the change:

| Tier                    | Tool                                                                                  | Use for                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| cheap                   | pgTAP (`supabase test db`)                                                            | DB/RPC/RLS/view behavior                                                                                          |
| cheap                   | Vitest (`pnpm test`)                                                                  | `packages/core` + web logic                                                                                       |
| cheap                   | kotlin.test JVM host (`:shared:testAndroidHostTest`)                                  | shared mobile pure logic + ViewModels                                                                             |
| cheap                   | compile gates (`:androidApp:assembleDebug`, `:shared:compileKotlinIosSimulatorArm64`) | KMP doesn't break (always run iOS compile — JVM-green ≠ KMP-green)                                                |
| medium                  | `next build` / `pnpm lint` / `tsc`                                                    | web build integrity                                                                                               |
| **expensive — reserve** | Playwright (`apps/web/e2e`)                                                           | web cross-layer flows                                                                                             |
| **expensive — reserve** | Maestro on emulator/simulator                                                         | mobile cross-layer flows that unit tests can't prove (claim→cap→realtime; float-ack countdown; preference submit) |

Emulator/Maestro runs ONLY at the end of a mobile track or when a wiring chunk crosses
UI→backend in a way the JVM host can't exercise. Never spin the emulator to prove pure logic.

## Execution protocol

- **Branch:** continue on `design/ui-implementation` (the web+mobile consolidation branch).
  One chunk = one focused commit. Never mix tracks in a commit.
- **Fresh-session-per-chunk.** Each chunk is self-contained: a new session reads PLAN + STATUS +
  the chunk's MATRIX rows and needs nothing else. Update `STATUS.md` (status + gate result +
  commit sha) as the last step of every chunk.
- **TDD-firewall** for net-new behavior (per the web-remediation pattern): write the
  pgTAP/Vitest/kotlin.test contract first; the implementer does not overfit to test bodies.
- **Invariants are load-bearing.** Re-read AGENTS.md "Hard Invariants" before any chunk touching
  floats, Harnwell, hours-cap, block atomicity, or timezones. Enforce in code at every write point.
- **Stop conditions** (autonomous run halts and asks): a genuine spec-vs-design behavioral
  conflict not already resolved here; a red gate that isn't a quick fix; a privacy/RLS decision
  (e.g. cross-worker phone exposure, T3b).

---

## Track T1 — Wire existing backends + test (38 rows · lowest risk, highest value)

Backend + UI both exist; the ViewModels do optimistic-local / demo mutations and never call the
real EF/RPC. The foundation chunk unlocks the rest.

| ID       | Chunk                                                                                                                                                                                                                                           | Backend it wires                            | Gate                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------- |
| **T1-0** | **Mobile data-layer write foundation**: authenticated EF-invoke + RPC-call helpers on the worker repository; live-session JWT plumbed; VM result/error surface replacing optimistic-only. Establishes the pattern every T1 mobile chunk reuses. | supabase-kt functions/postgrest client      | JVM host + assembleDebug + iOS compile |
| T1-1     | **Updates feed live**: call existing `fetchNotifications` + `observeNotifications` (already in repo, never called) on the authed path; map urgent→pending-float linkage.                                                                        | `notifications` view/RLS                    | JVM host; Maestro 04 (end of track)    |
| T1-2     | **My Shifts drop/reclaim**: wire drop → `drop-shift` / `permanent-drop` EF; week-total hours from real data; permanent-drop disabled in break profiles. (Read-model `dropped_still_open` fix lives in T2-1.)                                    | `drop-shift`, `permanent-drop` EF           | JVM host; Maestro 01                   |
| T1-3     | **Open Shifts claim**: wire claim → `claim-shift` EF; server now authoritative for cap/T-2h/cross-house/FCFS; keep client gating as pre-check.                                                                                                  | `claim-shift` EF, `claim_open_shift` RPC    | JVM host; Maestro 02                   |
| T1-4     | **Float ack/decline**: wire → `acknowledge_float` / `decline_float` RPC; live pending-float feed + idempotent terminal state.                                                                                                                   | RPCs (mig 20260528000014)                   | JVM host; Maestro 04                   |
| T1-5     | **Break claim/drop**: wire claim → `break-claim` EF, drop → `drop-shift`; 40h hard-cap + Harnwell constraint server-checked. (break_periods read = T2-2.)                                                                                       | `break-claim` EF                            | JVM host; Maestro 06                   |
| T1-6     | **Preferences submit**: wire grid→`submit-preferences` EF + live period/deadline (in-flight `PreferencesRepository.kt` + `worker_read_scheduling_periods` migration).                                                                           | `submit-preferences` EF, mig 20260610000001 | JVM host; Maestro 05                   |
| T1-7     | **Settings broadcast + profile**: wire broadcast toggle → `users-broadcast-subscription` EF; live profile read (users/user_roles/houses join).                                                                                                  | EF + RLS reads                              | JVM host; Maestro 07                   |
| T1-8     | **Login live path**: confirm real auth end-to-end (mostly built); SSO is folded into credential sign-in (no SSO backend) — keep flagged.                                                                                                        | `AuthGateway`                               | live-path manual                       |
| T1-9     | **Web inbox realtime**: deliver alerts in real time (page copy already claims it).                                                                                                                                                              | Supabase Realtime                           | Playwright inbox                       |

## Track T2 — Build missing backend + UI (40 rows)

New migrations/RPCs/EFs (RLS in same migration) and the UI that consumes them. Grouped by backend artifact.

| ID    | Chunk                                                                                                                                                                                                                     | Gate                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| T2-1  | **Read-model fixes**: populate `dropped_still_open` (mig 20260605000001 hard-codes false); closed-house flag (§3.4/§11.3); My-Shifts subsection ordering source.                                                          | pgTAP; JVM host                       |
| T2-2  | **Break completeness**: `break_periods` worker SELECT + context copy; **§4.4 "no-break-hours" opt-out** (spec-mandated, C5); **§4.4 T-1d drop routing** (calendar-pool vs open-feed, C4); at-cap claim block.             | pgTAP; JVM host; Maestro 06           |
| T2-3  | **Permanent pickup**: implement backend (currently returns 501) + mobile "Pick up permanently" flow (N-of-M weeks + skipped-weeks confirm) + web permanent-openings feed (§6.3).                                          | pgTAP; Vitest; JVM host               |
| T2-4  | **Worker permanent drop (§8.4.1)** popup (this-week vs permanently) + **float-drop exception (§5.5)** (drop a shift while holding a float).                                                                               | pgTAP; JVM host                       |
| T2-5  | **Set-deadline (§4.2/§6.11)**: `set_preference_deadline` RPC (SM/HM) + wire web Preferences "Set deadline".                                                                                                               | pgTAP; Playwright                     |
| T2-6  | **Hire/Fire (§6.6)**: `create_worker`/hire RPC + `fire-worker` wire (firing core exists) + web People actions.                                                                                                            | pgTAP; Vitest; Playwright             |
| T2-7  | **Rotor truncation (C19, spec bug §2.5)**: academic-year week-range truncation (no rotor interval into summer).                                                                                                           | Vitest (`rotor.ts`); pgTAP if DB-side |
| T2-8  | **Mark-read**: `notifications` worker UPDATE policy + mobile mark-all-read + urgent-row countdown.                                                                                                                        | pgTAP; JVM host                       |
| T2-9  | **Notification channels backing**: per-channel opt-out table for the channels spec _permits_ (broadcast only today). Personal-notif toggles stay disabled (flagged exception above).                                      | pgTAP; JVM host                       |
| T2-10 | **Partial-claim (design-extra, keep-design)**: `claim_open_shift` partial-span RPC + mobile "How much can you cover?" trim. Additive; whole-claim path unchanged. Flag if it conflicts with FCFS atomicity.               | pgTAP; JVM host                       |
| T2-11 | **Partial drop UI (§5.2)**: block-range selector + mid-shift drop-from-now (logic `Shifts.kt` exists; UI missing) + non-contiguous remaining-as-separate-cards.                                                           | JVM host; Maestro 01                  |
| T2-12 | **Web build-missing**: house switcher (scope to HMOD/admin per §2.5, C13); closed-house calendar; builder Phase-2 search; cap-reduction effect display; config health cards; leave HMOD-transfer + dual-HM/BM + depth-10. | Vitest; Playwright                    |
| T2-13 | **Full-screen FloatAckSurface** + push/deep-link routing (sheet variant exists). (Desk-call button → T3b backend.)                                                                                                        | JVM host; Maestro 04                  |

## Track T3a — Swaps on mobile (§8) (11 rows · backend EFs exist, UI entirely absent)

| ID    | Chunk                                                                                                   | Gate              |
| ----- | ------------------------------------------------------------------------------------------------------- | ----------------- |
| T3a-1 | **Swap data layer** + Updates surfacing + accept/reject from the feed (`accept-swap`/`reject-swap` EF). | JVM host; Maestro |
| T3a-2 | **Initiate temporary shift swap (§8.1)** — own-span + target-span picker → `create-swap`.               | JVM host          |
| T3a-3 | **Float swap (§8.2)** + **permanent shift swap (§8.3)** initiate (recurring-slot picker, week-scoping). | JVM host          |
| T3a-4 | **Void/cancel (§8) outstanding swap** (`void-swap`) + calendar live-update on swap.                     | JVM host; Maestro |

## Track T3b — Contact / house-grid / calendar-advanced (10 rows · new privacy-sensitive backend)

| ID        | Chunk                                                                                                                                                                                                                                                                                                 | Gate              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **T3b-1** | **Backend (STOP-to-confirm RLS):** desk-phone column + **cross-worker contact access** (§11.4 wants the assigned worker's number — RLS/privacy decision, surface to user); worker-readable **house-roster view** (§11.1); **date-param `worker_my_shifts`** read model (arbitrary week, past/future). | pgTAP             |
| T3b-2     | **Shift-detail + contact-lookup sheet** (mobile): tap card → details + call floater/desk.                                                                                                                                                                                                             | JVM host; Maestro |
| T3b-3     | **House schedule grid** (§11.1): "who's working at {house}" day grid (single/multi-staff).                                                                                                                                                                                                            | JVM host; Maestro |
| T3b-4     | **Calendar advanced**: week-picker sheet + month-calendar sheet + permanent-template view (consumes T3b-1 date-param model).                                                                                                                                                                          | JVM host; Maestro |

## Track TB — Test backfill (54 rows · already-built/wired, no coverage)

Mostly web features that work but lack tests. Add the cheapest tier that locks the behavior.
Low risk; can run anytime, ideal for parallel/fresh sessions.

| ID   | Chunk                                                                                                         | Gate              |
| ---- | ------------------------------------------------------------------------------------------------------------- | ----------------- |
| TB-1 | Web live-calendar grid (§6.1): time-grid, state cards, multi-staff stacking, now-line, Harnwell indicator.    | Playwright/Vitest |
| TB-2 | Web hours report (§6.10): per-worker table, decomposition buckets, rollups, week-selection, gating.           | Vitest/Playwright |
| TB-3 | Web coverage monitor (§6.3): gap feed, escalation timeline, stat strip, view-on-calendar.                     | Vitest/Playwright |
| TB-4 | Web config + health (§6.12): editable params, typed inputs, save path, authz, audit notes.                    | Playwright        |
| TB-5 | Web inbox + force-trigger + leave + rotor + cap + preferences-oversight residual coverage.                    | Vitest/Playwright |
| TB-6 | Mobile residual: ack hours-reassurance banner, calendar §11.2 legend, preferences live-period, theme control. | JVM host          |

---

## Sequencing rationale

1. **T1 first** — connects what already exists; makes both apps genuinely functional with the
   least new code and lowest breakage risk. T1-0 is the unlock; T1-1 (Updates) is the cheapest
   proof (repo methods already exist).
2. **T2** — spec-completion; many chunks unblock UI that T1 couldn't fully wire (permanent
   pickup 501, break routing, set-deadline, hire).
3. **T3a / T3b** — largest, newest surface; T3b-1 carries the one privacy/RLS decision to
   confirm with the user before building cross-worker contact exposure.
4. **TB** — backfill; parallelizable, run opportunistically.

Within every chunk: backend (migration+RLS+pgTAP) → shared/core logic (+unit) → UI → wiring →
e2e. Cheap gates gate the chunk; emulator/Playwright only where a flow crosses layers.
