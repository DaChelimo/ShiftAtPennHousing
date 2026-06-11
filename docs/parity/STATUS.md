# Parity Status — live chunk tracker

Update the row (status / gate / commit) as the **last step** of every chunk. See [`PLAN.md`](PLAN.md).

Status legend: ☐ pending · ◐ in-progress · ☑ done (gate green) · ⚠ blocked/needs-decision

## Track T1 — Wire existing backends + test

| ID    | Chunk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Status | Gate result                     | Commit    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------- | --------- |
| T1-0  | Mobile data-layer write foundation (reusable `EdgeFunctionClient`) — created in T1-2; `PreferencesRepository.submitPreferences` refactored onto it (behavior-preserving)                                                                                                                                                                                                                                                                                                                                              | ☑      | JVM+assemble+iOS green          | `T1-2`    |
| T1-1  | Updates feed live (`fetchNotifications`/`observeNotifications` already exist, just uncalled)                                                                                                                                                                                                                                                                                                                                                                                                                          | ☑      | JVM+assemble+iOS green          | `0e7f07a` |
| T1-2  | My Shifts **drop** wired (`drop-shift` / `permanent-drop`, Android + iOS) + creates `EdgeFunctionClient`. Reclaim deferred to T1-3.                                                                                                                                                                                                                                                                                                                                                                                   | ☑      | JVM+assemble+iOS green          | `8aa8b10` |
| T1-3  | Open Shifts **claim + reclaim** wired (`claim-shift`, Android + iOS) — reclaim is the same EF on the dropped-still-open block (assignment_id preserved on vacate). T1-2 reclaim residual now **resolved**.                                                                                                                                                                                                                                                                                                            | ☑      | JVM+assemble+iOS green          | `6c90e2a` |
| T1-4  | Float **ack/decline** wired + **live pending-float** read. New worker-auth EFs `acknowledge-float` / `decline-float` wrap the service-role-only RPCs (mig 20260528000014); read via own-row `float_assignments` + `worker_my_shifts`. Android + iOS; demo unchanged.                                                                                                                                                                                                                                                  | ☑      | JVM+assemble+iOS green          | `902d655` |
| T1-5  | Break **claim/drop** wired. Claim → `break-claim` EF (`{assignment_id, claim_type:'temporary'}`); drop reuses `drop-shift` via a new string-keyed `dropShift(assignmentId)` overload (no break-specific drop RPC). Android + iOS; demo path local-only/unchanged. Break pool stays demo-backed (T2-2).                                                                                                                                                                                                                | ☑      | JVM+assemble+iOS green          | `277999e` |
| T1-6  | Preferences submit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ☑      | pre-landed                      | `f53d335` |
| T1-7  | Settings **broadcast toggle** wired (PATCH `users-broadcast-subscription`) + **live profile read** (own `users` + `user_roles` + `houses`, all RLS). New `ProfileRepository` + `EdgeFunctionClient.patch`. Android + iOS; demo path local-only. The three personal-notif rows stay disabled (§10.1).                                                                                                                                                                                                                  | ☑      | JVM+assemble+iOS green          | `a5cd480` |
| T1-8  | Login live path. Credential sign-in already live (`LoginReducer`/`LoginFormValidator` + `SupabaseAuthGateway`); SSO folded into the one credential CTA (no SSO backend), keep-signed-in informational. Closed the iOS launch session-restore gap.                                                                                                                                                                                                                                                                     | ☑      | JVM 165+assemble+iOS+link green | `75a4581` |
| T1-9  | Web inbox **realtime** wired. `useInboxRealtime` hook in client `ActionInbox` opens a `postgres_changes` channel on `notifications` via the existing browser client (authed cookie session → RLS-scoped to this admin); on any change → `router.refresh()` re-runs the server component + re-partitions via `@shift/core` (no client-side enrich dup). Cleanup via `removeChannel`. **e2e/Playwright deferred** (local DB held).                                                                                      | ☑      | type-check+lint+build green     | `15cbfb6` |
| T1-10 | **Surface live pending-float in mobile Updates → ack hero** (NEW — from spot-check finding). `fetchPendingFloat` resolves the float + `worker_my_shifts` has the `float_out` pending block, but the Updates feed reads `notifications` (empty for a raw float) so the urgent entry/ack hero is unreachable in-app. Investigate whether the float-assignment/orchestrator path creates a `notifications` row; wire the urgent-row→ack-hero linkage or inject the synthesized urgent entry from the live pending float. | ☐      | —                               | —         |

## Track T2 — Build missing backend + UI

| ID    | Chunk                                                                   | Status | Gate result                              | Commit    |
| ----- | ----------------------------------------------------------------------- | ------ | ---------------------------------------- | --------- |
| T2-1  | Read-model fixes (dropped_still_open, closed-house)                     | ☐      | —                                        | —         |
| T2-2  | Break completeness (periods, no-hours opt-out, T-1d routing)            | ☐      | —                                        | —         |
| T2-3  | Permanent pickup (backend 501→real + UI + web feed)                     | ☐      | —                                        | —         |
| T2-4  | Worker permanent drop + float-drop exception                            | ☐      | —                                        | —         |
| T2-5  | Set-deadline RPC + web wire                                             | ☐      | —                                        | —         |
| T2-6  | Hire/Fire RPC + web People                                              | ☐      | —                                        | —         |
| T2-7  | Rotor academic-year truncation (spec bug)                               | ☑      | Vitest 652 + web type-check + lint green | `8ab4213` |
| T2-8  | Mark-read (UPDATE policy + UI)                                          | ☐      | —                                        | —         |
| T2-9  | Notification channels backing                                           | ☐      | —                                        | —         |
| T2-10 | Partial-claim (design-extra)                                            | ☐      | —                                        | —         |
| T2-11 | Partial drop UI (§5.2)                                                  | ☐      | —                                        | —         |
| T2-12 | Web build-missing (switcher, closed-house, search, leave, config cards) | ☐      | —                                        | —         |
| T2-13 | Full-screen FloatAckSurface + routing                                   | ☐      | —                                        | —         |

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

## Verification log

- **2026-06-11 spot-check (live emulator + local Supabase) — both round-trips PASS.**
  - **Claim** — live UI: login as `alice-quad@upenn.edu` -> claim a DuBois shift -> confirm; DB `shift_block_assignments` flipped `NULL/vacant` -> `alice-quad/claimed`. Mobile->`claim-shift` EF->`claim_open_shift` RPC->DB proven.
  - **Float ack** — EF-with-real-JWT (the exact call the app issues; the live Updates feed did NOT surface the float — see T1-10): `float_assignments.status` `pending`->`acknowledged`, source/dest blocks updated, idempotent re-ack returns `not_pending`. DB restored after.

### Local-dev gotchas (from the spot-check)

- **After adding/changing an Edge Function, recreate the edge-runtime container**: `supabase stop && supabase start` (NOT just `docker restart`). The edge runtime bakes `SUPABASE_INTERNAL_FUNCTIONS_CONFIG` at provision time, so EFs added after the container was created return **404 'Function not found'** until recreated (DB volume preserved). This is why `acknowledge-float`/`decline-float` (T1-4) 404'd locally.
- **Active seed is `supabase/seeds/manual-test.sql`**, NOT the default. Creds for the claimable/scheduled population: `<first>-<house>@upenn.edu` / **`abc123`** (e.g. `alice-quad@upenn.edu`). The `@pennhousing.test` users are hidden by it and have no open shifts/floats.

### Parallel-execution rule (two streams)

The local Supabase DB is a SHARED resource: **at most ONE DB-migration/reset chunk in flight at a time** (`supabase db reset`/`test db`/migration-apply). Fill the other parallel slot with a NO-DB chunk (web UI build-gated, mobile UI compile-gated, `packages/core` Vitest). Never run an emulator spot-check or Playwright concurrently with a DB-reset chunk.

_Last updated: T1 COMPLETE (1-9 done) + T2-7 done. Spot-check verified claim+ack live. Next: T2-1 (read-model migration, DB stream) parallel with T1-10 (pending-float surfacing, no-DB)._
