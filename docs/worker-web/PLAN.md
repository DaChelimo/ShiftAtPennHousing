# Worker (SW) web portal — build plan

**Goal:** give Student Workers (SW) the things they do on mobile, on the web, laptop-first,
by extending the existing `apps/web` (which was admin-only). Student Managers (SM) already
have their web surfaces (schedule builder, preferences oversight, calendar, hours, inbox);
the SM side is essentially pre-existing and out of scope here except where noted.

This doc is the source of truth for what is DONE and what is PENDING, plus a detailed,
Opus-ready plan for the pending work. Read `AGENTS.md` and `BEHAVIORAL_SPECIFICATION.md`
first; this supplements them. Last revised: 2026-07-10 (statuses re-verified against the
working tree and git log).

---

## 1. Status: what already exists (DONE)

All of the following is **built, end-to-end wired, and COMMITTED** (2026-07-10) as four
conventional commits: `d46d505` (core painter + break compiler), `6984c2b` (db apply +
shared reconcile), `05f69e8` (web shell + role routing + preferences), `0b96ad0` (admin
break configurator + worker claim). **One straggler is still uncommitted:**
`supabase/migrations/20260628000001_worker_recent_floats_view.sql` (the
`worker_recent_floats` view Phase 4.1 depends on) is untracked — commit it with Phase 4.1.
The rest of the working-tree drift (mobile preferences/auth churn, AGENTS/ARCHITECTURE doc
updates, admin preferences-oversight tweaks, test-plan edits) belongs to other in-flight
features — keep it out of worker-web commits. Baseline verification to re-run before
extending: `pnpm --filter @shift/core test` (compileBreak + preferences painter), the break/
preference pgTAP suites, and `pnpm --filter @shift/web build` + `type-check`.

### Phase 0 — Portal shell & routing ✅

- `apps/web/components/WorkerShell.tsx` — leaner-than-admin shell (brand, theme toggle,
  updates bell, account menu with sign-out + conditional "Switch to admin console" link).
- `apps/web/app/(worker)/layout.tsx` — worker nav = **Home · Preferences · Breaks**; redirects
  unauthenticated → `/login`.
- `apps/web/app/(app)/layout.tsx` — redirects pure-SW users to `/home`; dual-role users stay on
  the console with a "Switch to worker view" affordance (`canSwitchToWorker`).
- `apps/web/lib/auth.ts` — `isWorker()`, `hasAdminSurface()` helpers.
- `apps/web/proxy.ts` — `/home` added to `PROTECTED_PREFIXES`.
- **Known gap:** the shell's updates bell links to `/home/updates`, which **does not exist yet**
  (built in Phase 4). `updatesCount` is hardcoded 0.

### Phase 1 — Semester preferences (paint-the-week) ✅

- `packages/core/src/preferences/index.ts` — pure VM: `buildWeekLayout`, `paint`,
  `dragBrushForStart`, `buildSubmitPayload`, `clampTarget`, `effectiveTarget`, `blockWeekSlot`.
- `apps/web/components/worker/PreferenceBoard.tsx` — pointer-drag paint grid (time rows × 7
  weekday cols), 3 brushes (preferred/available/cannot), target-hours stepper, "no hours" opt-out,
  read-only when deadline closed.
- `apps/web/lib/data/worker/preferences.ts` — active period + representative-week blocks + prefill.
- `apps/web/lib/actions/worker/preferences.ts` — submit via `callEdge('submit-preferences/preferences', …)`.
- Tests: `packages/core/tests/preferences/painter.test.ts`; pgTAP `phase-04-preferences.sql`,
  `set-preference-deadline.sql`.

### Phase 2 — Break pipeline (full loop) ✅

**Admin authoring (per-house configurator — the reworked, NOT the old pick-a-profile screen):**

- `packages/core/src/break-authoring/index.ts` — `compileBreak` (pure). Per-house open/closed +
  headcount + weekday/weekend hours + global float toggle → one claim-based `b_<slug>_<date>`
  profile with universal float routing + break-type cap + claim offsets.
- `apps/web/components/breaks/BreakAuthoring.tsx` — per-house editor, weekday/weekend-differs,
  "apply to all houses" grouping, break-type presets, **Preview → Apply** dry-run with impact tiles
  - void confirmation.
- `apps/web/lib/actions/breaks.ts` — `previewOrApplyBreak` → `compileBreak` → `apply_compiled_break`
  RPC; `removeBreak` → `remove_break_period`.
- `apps/web/lib/data/breaks.ts` — reconstructs per-house config from `staffing_patterns` (Edit round-trip).
- Migrations: `20260709000004_break_compiler_apply.sql` (`reconcile_config_blocks`,
  `apply_compiled_break`, reconcile-aware `remove_break_period`), `20260709000005_shared_config_reconcile.sql`
  (`apply_compiled_season` now shares `reconcile_config_blocks`).
- Tests: `packages/core/tests/break-authoring/compile-break.test.ts`; pgTAP `apply-compiled-break.sql`
  (15). Season pgTAP `apply-compiled-season.sql` (16) still green through the shared engine.
- **Known nits:** `admin/breaks/page.tsx` header comment is stale (still says "pick an existing
  profile"); the old `author_break_period` RPC (`20260709000001`) + its pgTAP are superseded and
  unused by the web (leave or delete — see Phase 5).

**Worker claim (FCFS calendar):**

- `apps/web/app/(worker)/home/breaks/page.tsx`, `components/worker/BreakClaim.tsx`,
  `lib/data/worker/breaks.ts`, `lib/actions/worker/breaks.ts` — drag-select claim grid wired to the
  `break-claim` EF; `break_claim_phase` states (pre_open / claim_window / open_feed); opt-out.

### Home dashboard ✅

- `apps/web/app/(worker)/home/page.tsx` + `lib/data/worker/home.ts` — greeting + status-chipped
  cards for Preferences and Breaks.

---

## 2. Status: what is PENDING

**Phases 3, 4, and 5 were BUILT on 2026-07-11** (uncommitted working tree). The core worker
shift flows now have a web counterpart. Verified: `@shift/core` builds + 732 Vitest green
(incl. 17 new), `@shift/web` `type-check` + `lint` + `next build` (all 25 routes compile)
clean, and every worker surface renders end-to-end against the live local DB (login as a
seeded SW → My Shifts / Open / Updates / Swaps / House all 200). The anon-grant security fix
is applied and verified against the DB.

| Flow                                           | Web status | Mobile reference (behavioral spec)                                                |
| ---------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| My Shifts (personal calendar, week-scoped)     | **DONE**   | `apps/mobile/.../shifts/`, `ShiftsScreenViewModel`                                |
| Open Shifts feed + Claim                       | **DONE**   | `weekly_open_shifts_feed` / `worker_open_shifts`, `claim-shift` EF                |
| Drop a shift                                   | **DONE**   | `drop-shift` EF                                                                   |
| Updates (inbound floats) + acknowledge/decline | **DONE**   | `worker_pending_floats`, `acknowledge-float`/`decline-float` EFs                  |
| Swaps (accept / reject / void + hand-off create) | **DONE***  | `worker_pending_swaps`, `create-swap`/`accept-swap`/`reject-swap`/`void-swap` EFs |
| Permanent drop / pickup                        | **DONE**   | `permanent-drop` / `permanent-pickup` EFs                                         |
| Cross-house read-only schedule view            | **DONE**   | `house_schedule_grid_any` (any house), tap-to-dial                                |
| Worker-portal e2e tests                        | **DONE**   | (5 specs, seed-contract-documented, following the TDD-first e2e convention)       |

\* Swaps ships the full review surface (accept/reject/void with give↔get + one-way-transfer
framing) plus a one-way **hand-off** compose. The richer two-sided / partial swap compose (the
segmented give/take timeline over the counterparty's schedule) is intentionally deferred: it
needs a worker-facing read of another worker's shifts that no read model exposes today, so
building it correctly is its own scoped task rather than a half-implementation here.

Plus cleanups: the `/home/updates` phantom route + a real `updatesCount`, the stale break page
comment, committing the stray `worker_recent_floats` migration, and the open security-audit
findings on the worker read surface (see Phase 5).

---

## 3. Reusable backend (no new backend needed for Phases 3–4)

Every worker flow already has a read model + Edge Function. The web adds only loaders + actions +
UI. Reads go through the **RLS-scoped user client** (`lib/supabase/server.ts` `createClient()`);
writes go through the shared **`callEdge()`** (`lib/actions/worker/edge.ts`) which forwards the
worker's bearer token to the EF (RLS + EF re-validate authoritatively).

**Read models (query as the authed worker):**

- `worker_my_shifts` (view) — the worker's own assignments (scheduled / claimed / floated_in /
  break, occupied). Week-scope in the loader by NY week.
- `worker_open_shifts` (view) + `weekly_open_shifts_feed` (RPC) — claimable open seats; carries
  server-authoritative `desk_covered` + `coverage_locked` + claimability. **Consume these; never
  re-derive the T-2h lock client-side** (that was a real mobile bug — see the `[Coverage-lock]`
  note in AGENTS.md).
- `worker_pending_floats` (view) + `worker_recent_floats` (view) — inbound floats to
  acknowledge/decline. **Caution:** the `worker_recent_floats` migration
  (`20260628000001_worker_recent_floats_view.sql`) exists on disk but is NOT committed.
- `worker_pending_swaps()` (RPC) — incoming/outgoing swap requests.
- `worker_directory` (view) — cross-house SW directory (swap counterparties / handoff).
- `house_schedule_grid_any` (view) — any-house read-only grid (cross-house view). NOT
  `house_schedule_grid` (that one is RLS/home-scoped). `_any` is deliberately
  **owner-rights** (no `security_invoker`): it bypasses the home-house RLS so any authed
  worker can read every house's grid; the APP scopes it by the selected house. Safe
  projection only (names/phones via `worker_directory`); read-only.

**Edge Functions (POST, bearer-forwarded via `callEdge`):**

- `claim-shift`, `drop-shift`
- `create-swap`, `accept-swap`, `reject-swap`, `void-swap`
- `acknowledge-float`, `decline-float`
- `permanent-drop`, `permanent-pickup`

**Pure logic actually reusable as-is (TypeScript):**

- `@shift/core` eligibility (`packages/core/src/eligibility/`), swap eligibility +
  permanent-swap scope (`packages/core/src/swaps/`), NY block/week/duration helpers
  (`packages/core/src/time/` — `blockBoundary`, `addBlocks`, `weekStart`, `weekContains`,
  `dayType`, `blocksBetween`).
- `apps/web/lib/data/blockChunks.ts` `selectByBlockIdChunks` (PostgREST 414 guard for large
  `.in()` lists — use it for any multi-id fetch). Web lib, not `@shift/core`.

**Pure logic that must be PORTED from Kotlin** (it lives in the mobile KMP shared module,
`apps/mobile/shared/src/commonMain/.../shared/`, and cannot be imported by the web):

- Swap-segment building `buildSwapSegments` (`swaps/Swaps.kt`) and one-way-transfer framing
  `isOneWayTransfer`/`transferSide` (`swaps/SwapsFeed.kt`).
- Block coalescing (`shifts/Coalesce.kt`) and my-/open-shift presentation incl. claimability
  display states (`shifts/MyShiftPresentation.kt`, `shifts/OpenShiftPresentation.kt`).
- Week-scoping (`shiftsInWeekOf` in `calendar/`).

Port each into `packages/core/src/<flow>/` alongside a Vitest port of its Kotlin test suite
(`SwapsTest`, `SwapsFeedTest`, `CoalesceTest`, …) — the Kotlin tests are the behavioral
contract; do not re-derive behavior from scratch.

---

## 4. Conventions to follow (match the established portal patterns)

- **Route group:** everything worker-facing lives under `apps/web/app/(worker)/home/…`. Add a nav
  item in `app/(worker)/layout.tsx` **only when its page exists** (no phantom links).
- **Data layer:** one loader module per flow in `apps/web/lib/data/worker/*.ts`, server-only,
  RLS-scoped `createClient()`. Convert to a plain serializable shape for the client component.
- **Actions:** one action module per flow in `apps/web/lib/actions/worker/*.ts`, `'use server'`,
  calling `callEdge(...)`. Return a discriminated `{ ok, data } | { ok, error }`. `revalidatePath`
  the affected worker route(s) on success.
- **Components:** client components in `apps/web/components/worker/*.tsx`, reusing the `ui/` kit
  (`Card`, `PageHead`, `Tag`, `Button`, `EmptyState`, `Toast`, `Modal`, `Tabs`) and existing shell
  CSS. Optimistic local moves are fine (mirror mobile), server is source of truth on refetch.
- **Time:** never read a clock in pure logic — thread `simNow()` in (dev time-travel is wired into
  the worker shell). All timestamps NY.
- **No em/en dashes** in any user-facing string (AGENTS.md). Re-punctuate.
- **Sim clock:** the worker shell shows the dev time-travel card; use it to test preference windows
  and break phases.
- **Commits:** one commit per feature (ported core helper + loader + action + component + page +
  tests together), conventional-commit subject. See §6 for the commit record of Phases 0–2.

---

## 5. Detailed pending plan

### Phase 3 — Core shift flows (highest value; "everything on my phone") — BUILT 2026-07-11

Delivered: `packages/core/src/worker-shifts/` (coalesce + claimability + section/state
classifiers + week-scope) and `.../format.ts`, with `tests/worker-shifts/coalesce.test.ts`.
Web: `lib/data/worker/{myShifts,openShifts}.ts`, `lib/actions/worker/shifts.ts`
(drop/claim/permanent), `components/worker/{MyShifts,OpenShifts}.tsx`, `home/{shifts,open}`
pages, `wnav-shifts` / `wnav-open`. The Manage sheet does whole + partial (sub-range) drop.

Deliver as two nav tabs under `/home`: **My Shifts** and **Open Shifts**. (Drop lives inside My
Shifts.) Mirror the mobile `ShiftsScreenViewModel` behavior.

**3.1 My Shifts** (`/home/shifts`)

- Files: `app/(worker)/home/shifts/page.tsx`, `components/worker/MyShifts.tsx`,
  `lib/data/worker/myShifts.ts`, add nav item `wnav-shifts`.
- Loader: read `worker_my_shifts`, week-scope to the shown NY week (carry a `weekOffset` like the
  mobile My-Shifts tab). Group into scheduled / claimed / floated-in / break sections; coalesce
  contiguous blocks per house/day. Show "This week — Xh" held-hours chip from the shown week.
  Coalescing, presentation grouping, and `shiftsInWeekOf` are Kotlin (see §3) — port them to
  `@shift/core` first, with their tests.
- UI: week header + prev/next nav; agenda of coalesced shifts; each shift opens a "Manage shift"
  sheet (Drop; Swap entry point in Phase 4). Empty-state per section.

**3.2 Drop** (inside My Shifts)

- Action: `lib/actions/worker/shifts.ts` `dropShift({ assignmentIds | blockIds, scope })` →
  `callEdge('drop-shift', …)`. Mirror the mobile drop payload (single vs range, this-week vs
  permanent scope belongs to Phase 4 permanent-drop). On success, revalidate `/home/shifts` and
  `/home/open`.
- Behavior: a dropped seat returns to the open feed (no self-reclaim), per spec.

**3.3 Open Shifts + Claim** (`/home/open`)

- Files: `app/(worker)/home/open/page.tsx`, `components/worker/OpenShifts.tsx`,
  `lib/data/worker/openShifts.ts`, nav item `wnav-open`.
- Loader: `weekly_open_shifts_feed` / `worker_open_shifts` for the current week (open feeds are NOT
  week-scoped the way My-Shifts is — mirror mobile: current-week claim meter). Emit
  `desk_covered` + `coverage_locked` + server `is_claimable` straight through; render locked/covered
  states; do not re-derive T-2h. Use `selectByBlockIdChunks` if fetching by id list.
- Action: `claimShift({ assignmentIds })` → `callEdge('claim-shift', …)`. Partial claims return a
  per-block outcome (mirror mobile `ClaimOutcome`); a partial success is NOT a red failure. Show a
  success toast; revalidate `/home/open` + `/home/shifts`.
- Include the current-week hours meter for the cap (claim is always current-week).

**Phase 3 tests:** Vitest for any new pure presentation helper you extract to `@shift/core`
(week-scoping, coalescing, claim-outcome) — prefer porting the mobile helper. Playwright e2e:
`worker-my-shifts.spec.ts`, `worker-open-claim.spec.ts` (log in as a seeded SW, claim an open seat,
drop a held seat, assert feed/agenda update).

### Phase 4 — Swaps, floats, permanent, cross-house — BUILT 2026-07-11

Delivered: `packages/core/src/worker-floats/` (ack-deadline timing, reusing
`notifications/ack-cadence`'s `ACK_DEADLINE_LEAD_MINUTES`) and `worker-swaps/` (ported
`buildSwapsFeed` + one-way-transfer framing, with `tests/worker-swaps/feed.test.ts`). Web:
`lib/data/worker/{floats,swaps,house}.ts`, `lib/actions/worker/{floats,swaps}.ts`,
`components/worker/{UpdatesFeed,Swaps,HouseView}.tsx`, `home/{updates,swaps,house}` pages,
`wnav-updates` / `wnav-swaps` / `wnav-house`, and the real `updatesCount` bell badge wired
via the worker layout. Permanent drop is surfaced as a scope toggle in the Manage sheet;
permanent pickup is the "Pick up" action on the Open feed. Cross-house view is a read-only
day agenda per house (switcher + day nav + tap-to-dial) rather than the full Excel week grid.

**4.1 Updates (inbound floats)** (`/home/updates`) — also fixes the phantom bell route

- Files: `app/(worker)/home/updates/page.tsx`, `components/worker/UpdatesFeed.tsx`,
  `lib/data/worker/floats.ts`, `lib/actions/worker/floats.ts`, nav item `wnav-updates`.
- Loader: `worker_pending_floats` (+ `worker_recent_floats` for history — **commit its stray
  migration `20260628000001_worker_recent_floats_view.sql` as part of this phase**). Wire the
  real `updatesCount` into `WorkerShell` (pending float count) via the worker layout.
- Actions: `acknowledgeFloat` / `declineFloat` → `callEdge('acknowledge-float' | 'decline-float', …)`.
- UI: float card carousel (mirror mobile float carousel — accept-by countdown, softer card),
  ack/decline. Respect no-takeback (no revoke path).

**4.2 Swaps** (`/home/swaps`)

- Files: `app/(worker)/home/swaps/page.tsx`, `components/worker/Swaps.tsx`,
  `lib/data/worker/swaps.ts`, `lib/actions/worker/swaps.ts`, nav item `wnav-swaps`.
- Loader: `worker_pending_swaps()` (incoming / outgoing). Directory via `worker_directory`.
- Actions: `createSwap` / `acceptSwap` / `rejectSwap` / `voidSwap` → the four swap EFs.
- UI: PORT the Kotlin `buildSwapSegments` (segmented give/take timeline), the one-way-transfer
  framing (`isOneWayTransfer` → "wants to give you these hours" panel), and the pending-swap
  guard into `@shift/core` (see §3 — they are mobile-shared Kotlin today, not importable). This is
  the richest flow — budget accordingly and mirror the mobile swap UX closely.

**4.3 Permanent drop / pickup**

- Extend `lib/actions/worker/shifts.ts` with `permanentDrop` / `permanentPickup` → the permanent
  EFs; surface "this week only / this week onward" scope in the Manage-shift sheet (mirror mobile).

**4.4 Cross-house read-only view** (`/home/house` or a house switcher on Open/My-Shifts)

- Loader: `house_schedule_grid_any` for a selected house (owner-rights view, any house readable
  by any authed worker; the app filters by the selected house — see §3). Read-only week grid +
  tap-to-dial desk phone + scroll-to-now. Mirror the mobile cross-house view.

**Phase 4 tests:** Playwright `worker-swaps.spec.ts`, `worker-updates.spec.ts`. Reuse seeded
float/swap fixtures.

### Phase 5 — Hardening, cleanups, security — BUILT 2026-07-11

Done: fixed the stale `admin/breaks/page.tsx` header comment; applied + DB-verified the
anon-grant revoke (migration `20260711000001_revoke_anon_worker_reads.sql` — anon now has
zero privileges on `worker_open_shifts` / `worker_my_shifts` / `worker_pending_floats` /
`worker_recent_floats`; authenticated keeps SELECT); wrote 5 worker e2e specs
(`worker-my-shifts`, `worker-open-claim`, `worker-updates`, `worker-swaps`,
`worker-preferences`) + a `workerLogin` helper, following the repo's TDD-first,
seed-contract-documented e2e convention. DECISION: `author_break_period`
(`20260709000001`) + its pgTAP are left in place, NOT deleted — the migration is committed
and applied, so deleting it would break the migration chain; the RPC is inert and still
tested. The original items below are retained for context.

- **Cleanups:** fix the stale `admin/breaks/page.tsx` header comment (line 9, still says "pick an
  existing operating profile" — verified present 2026-07-10); decide the fate of the unused
  `author_break_period` RPC (`20260709000001`) + `author-break-period.sql` pgTAP (recommend:
  delete both, since the web is fully on the compiler path and nothing else calls it — confirm no
  seed/e2e dependency first, then regenerate `database.types.ts`).
- **Security audit follow-through (2026-07-07 audit, still open):** the worker portal widens
  exposure of exactly the surfaces the audit flagged. At minimum, before this portal ships:
  revoke the `anon` grant on `worker_open_shifts` (HIGH — granted to anon in `20260605000001`,
  re-granted in `20260617000004` and `20260627000001`; every re-grant site must change). The
  CRITICAL confused-deputy findings (`apply_compiled_season` / `set_preference_deadline` trusting
  caller-supplied uuid) are admin-side but live in the same working set — coordinate, don't ignore.
- **e2e for existing Phase 0–2 work** (currently zero worker-portal / break-configurator e2e —
  specs live in `apps/web/e2e/`, reuse its `helpers.ts`): `worker-preferences.spec.ts` (paint +
  submit + deadline read-only), `worker-break-claim.spec.ts` (claim window),
  `admin-break-configurator.spec.ts` (per-house config → preview → apply, dry-run reversibility).
  This is the biggest test gap today.
- **Responsive pass:** laptop-first but verify the paint grid, break calendar, swap timeline, and
  agenda degrade gracefully at tablet/narrow widths.
- **Optional stretch:** web push notifications for floats (parallels the mobile push path).

---

## 6. Commit record + what's still uncommitted

The Phase 0–2 commit plan was EXECUTED (2026-07-10); the original items 3+4 landed merged as
one commit:

1. `d46d505` `feat(core): worker preference painter + per-house break compiler`
2. `6984c2b` `feat(db): per-house break authoring apply + shared config reconcile`
3. `05f69e8` `feat(web): worker portal shell, role routing, and semester preferences`
4. `0b96ad0` `feat(web): admin per-house break configurator and worker break claim`

Still uncommitted and belonging to THIS effort:
`supabase/migrations/20260628000001_worker_recent_floats_view.sql` — commit with Phase 4.1.

For the pending phases, keep the established convention: one commit per feature (ported core
helper + its tests, loader, action, component, page, e2e together), conventional-commit subject.

The remaining working-tree drift (season-band migrations `20260709000002`/`…000003`, broad
mobile preferences/auth churn, AGENTS/ARCHITECTURE doc updates, admin preferences-oversight
tweaks) is separate, pre-existing work — keep it in its own commits, never bundled with the
worker web work.

---

## 7. Gotchas / risks

- **Server-authoritative claimability:** the open-shifts feed already computes `desk_covered` /
  `coverage_locked` / `is_claimable`. Consume them; re-deriving the T-2h lock on the client is a
  known bug pattern (AGENTS.md `[Coverage-lock]`).
- **The mobile "shared" helpers are Kotlin, not importable.** `buildSwapSegments`,
  `isOneWayTransfer`/`transferSide`, coalescing, shift presentation, and week-scoping live in the
  KMP shared module. Port them (with their Kotlin test suites) into `@shift/core`; do not
  re-derive the behavior from the spec alone, and do not silently fork it from mobile.
- **`house_schedule_grid_any` is owner-rights by design** — it bypasses RLS so any authed worker
  reads any house. Scope by house in the app; don't "fix" it back to invoker rights (that breaks
  the cross-house view) and never widen its projection.
- **Open security audit (2026-07-07):** `worker_open_shifts` is granted to `anon` (HIGH), and two
  admin RPCs have confused-deputy CRITICALs. See Phase 5 — resolve before the portal ships wide.
- **supabase-kt same-column-filter quirk is mobile-only.** In the web (`@supabase/ssr`) you can send
  a real `.lt()` upper bound; don't copy the mobile client-side upper-bound workaround.
- **PostgREST 414** on large `.in()` id lists — use `selectByBlockIdChunks`
  (`apps/web/lib/data/blockChunks.ts`).
- **No em/en dashes** in any surfaced string.
- **Hours cap is not checked on float** (invariant #4); it IS on claim/swap/pickup — the EFs enforce
  it, but surface the projected-hours warning like mobile.
- **Harnwell training + float-direction + no-takeback + block-atomicity + NY tz** invariants are
  enforced in the backend; the web must not work around them.
- **One stray uncommitted migration** (`20260628000001_worker_recent_floats_view.sql`) — commit it
  with Phase 4.1; everything else from Phases 0–2 is already in git (§6).
