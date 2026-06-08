# S6 — HMOD context · NOTES (outcome)

**Status: DONE & GREEN.** Audit #8 (ack-reminder indicator) + #9 (multi-house calendar/coverage;
the closed-house half stays deferred) + #18a (rotor Friday-anchor). Built via the TDD firewall
(Lead contract → Test Author red → firewalled Implementer → Lead verify/reconcile).

## Results

- **Core Vitest:** `s6-hmod-context` **25/25** (`fridayAnchor` incl. DST dates + the pinned
  value table; `canViewOtherHouses`; `resolveCalendarHouse`/`resolveCoverageScope`;
  `summarizeAckReminders` all stages + boundary + DST instant compare).
- **Playwright:** `hmod-context.spec.ts` **10/10** (rotor Friday round-trip; pill On/Off-duty;
  bell unread badge; switcher unlock/lock; cross-house calendar via `?house=`; coverage "All
  houses" aggregate + narrowing; off-duty `?house=` gating). No console warnings.
- **Repo gate:** `pnpm type-check` (5/5) · `pnpm build` (3/3, 19 routes, `/calendar`+`/coverage`
  dynamic) · all S6 files `eslint`-clean. No migration → no `supabase test db` change.
- **DB-level proof of the crux** (psql after `supabase db reset`): the seeded `hmod_rotor` row is
  `2026-06-05` (**isodow 5 / Friday**) → my Friday-anchor seed math cleared the `isodow=5` CHECK;
  `resolve_hmod_on_duty(now())` returns Hana (`a0…0008`) → HMOD-now resolves end-to-end (today
  Mon 2026-06-08 → duty-week Fri 2026-06-05 → Hana). Hana bell unread+due = 1.

## What shipped

- **Pure core** `packages/core/src/hmod-context/{index.ts,types.ts}` (+ barrel) — `fridayAnchor`
  (D1, UTC date-only, DST-immune; agrees with `resolve_hmod_on_duty`'s `(isodow+2)%7` snap),
  `summarizeAckReminders` (D8, deepest-fired cadence stage, ISO-instant compare),
  `canViewOtherHouses` (D5), `resolveCalendarHouse`/`resolveCoverageScope` (D6). Zero Supabase
  imports. Web consumes it from `@shift/core` **dist** (package `main`), so core is rebuilt before
  the web type-check/build.
- **Web I/O** `apps/web/lib/data/hmod.ts` — `getOnDutyHmodId` (wraps the existing
  `resolve_hmod_on_duty` RPC), `getUnreadCount` (notifications `acknowledged_at IS NULL` +
  `scheduled_for <= now`; there is **no `read_at`** column), `getShellHouses` (all 13).
- **`lib/data/rotor.ts`** — Monday `weekStart` → `fridayAnchor`; the saved `week_start_date` is
  now a Friday (the Monday key was silently **400ing** the `hmod_rotor` isodow=5 CHECK → the rotor
  save was broken before S6).
- **`lib/data/coverage.ts`** — `parent_float_id` select + the ack-reminder join (#8): batch-query
  `ack_reminder` notifications by `payload.float_id`, group, run each through
  `summarizeAckReminders`, map stage → `floater.ack.reminderLabel`; `getAllHousesCoverageData`
  (D7 aggregate). `CoverageGap.floater` is now `{ name; fromHouse; ack:{ pending; reminderLabel } }`.
- **`components/AppShell.tsx`** + **`app/(app)/layout.tsx`** — pill state (`hmod-pill`, "On/Off
  duty"), bell (`nav-bell` → `/inbox`, `bell-count` badge when >0), `HouseSwitcher` unlock + menu
  (`house-switcher`, `house-option-<id>`, `house-option-all` on coverage) + merge-`?house=`
  navigation; layout computes `hmodOnDuty`/`canSwitchHouse`/`houses`/`unreadCount`.
- **Pages** `calendar/page.tsx` (`resolveCalendarHouse` gate + `calendar-house-name`) and
  `coverage/page.tsx` (`resolveCoverageScope` → aggregate-vs-single + `coverage-house-name`);
  **`CoverageMonitor.tsx`** appends " · {reminderLabel}" to the "Pending ack" tag (brief §6.3).
- **Seed** `supabase/seed.sql` — one appended S6 block: an `hmod_rotor` row making Hana the
  on-duty HMOD now, computed with the SAME expression `resolve_hmod_on_duty` uses (so it matches
  the resolver and satisfies the Friday CHECK). `now()`-relative + `ON CONFLICT` → idempotent.

## Lead reconciliations / decisions

1. **#8 join is review-verified, not e2e'd (D10, as planned).** `summarizeAckReminders` is
   exhaustively Vitest-covered; the coverage.ts join (select `parent_float_id` → notifications
   query → stage→label) is a thin, type-checked, graceful-degrading mapping (a failed/absent
   reminder query just yields `reminderLabel:null` = plain "Pending ack", no crash). The seed
   carries **no** pending-float fixture (a now-relative float chain is brittle and out of
   proportion), so this SQL path is **dormant in the automated suites** and verified by code
   review. **Follow-up:** exercise it once with a real seeded float (assert the "Nh reminder sent"
   label renders) — mirrors S2's "lookup math is Vitest-covered" stance.
2. **Coverage React-key bug fixed (pre-existing S2, surfaced by aggregate).** The gap `id` used the
   per-track run-start index `i`, which collides across parallel seats at one block (S3 flagged
   `…-allied-0`; aggregate amplified it to a visible dev warning). Fixed at the root with a
   monotonic per-call `gapSeq` counter, **and** namespaced aggregate ids by `houseId`. `id` is
   only a React key (force-trigger uses `blockIds`), so this is safe; it also closes a latent
   "duplicate key → card omitted → hidden coverage gap" hazard. Slightly beyond S6's literal
   contract but justified (in-file, safety-relevant, amplified by my feature).
3. **Gating rule pinned (D5):** cross-house view = on-duty-HMOD **or** project-administrator; an
   **off-duty** HM/BM is house-scoped (so Bea, a BM not in the rotor, is correctly blocked from
   `?house=`). Aligns with §2.5 (HMOD duty-week authority) + S3's house-scoped admin precedent.

## ⚠️ Concurrency saga (READ THIS if you run a session while S4/S5 are live)

S6 ran **concurrently with S4** (fire-worker) in the **same working tree + same local Supabase**.
Consequences handled this session:

- **The shared working tree was switched out from under me** `design/ui-implementation →
  fix/pgtap-period-overlap` (a concurrent session checked out that branch — `d40217c` = 5bd9f0f +
  the two pgtap-overlap-fix commits `e9e4e58`/`d40217c`). `design/ui-implementation` itself never
  moved (it stayed at 5bd9f0f). I didn't catch the switch until commit time, so my S6 commit
  (`8392dcd`) first landed on `fix/pgtap-period-overlap`. **Corrected** by grafting it onto
  `design/ui-implementation` via an isolated `git worktree` cherry-pick → commit **`10a1ef5`** (=
  5bd9f0f + S6 only; the pgtap-branch fixes are deliberately NOT pulled in). `8392dcd` also remains
  on `fix/pgtap-period-overlap` (benign — identical patch, dedupes on merge). The main shared tree
  was left on `fix/pgtap-period-overlap` to avoid disrupting the concurrent S4 WIP. **Lesson:
  re-check `git rev-parse --abbrev-ref HEAD` right before staging when a tree is shared.**
- **Shared files contaminated by S4's uncommitted WIP:** `apps/web/e2e/helpers.ts` gained S4's
  `SEED.fireable` (a 2nd, separate `@@` hunk from my `hmodOnDuty`/`hmodOffDuty`);
  `apps/web/e2e/README.md` is **entirely** S4's fire-worker section; `packages/core/{src,tests}/
firing/`, `apps/web/e2e/fire-worker.spec.ts`, `supabase/tests/s4-fire-worker.sql`,
  `supabase/migrations/20260606000003_s4_fire_worker.sql`, `docs/web-remediation/sessions/S4/` are
  all S4's. **I staged S6 surgically** (per-file `git add`; helpers.ts via `git apply --cached`
  of only my hunk) and **did not stage any S4 file**. The full-repo `pnpm lint` is transiently red
  on S4's `tests/firing/fire-planner.test.ts` (import/order) — **not S6, not in my commit**; the
  S6-committed tree is lint-clean.
- **`supabase db reset` collided** with a simultaneous S4 reset (two CLIs on one Docker stack →
  realtime `Ecto.InvalidChangesetError`). Recovered with `supabase stop` + waiting for the stack
  to settle (realtime "Tenant set-up successfully", DB healthy, no concurrent CLI op), then reset
  cleanly. If you hit the Ecto error: it's the shared-stack collision, not your SQL — serialize
  the reset.

## Invariants re-checked (TEST_PLAN §7) — all intact

Read-only/presentational; no schema change, no assignment/float writes. Harnwell cross-house
viewing is _reading_ (no staffing path; `restricted` still renders); no float created/redirected
(ack indicator only reads); no revoke control; blocks/cap/TZ untouched; `fridayAnchor` UTC
date-only + ack compare ISO instants (DST-safe); cross-house gated to on-duty-HMOD/project-admin;
rotor save stays HM/BM-only.

## Deferred / follow-ups

- **Closed-house "Closed" state (#9 other half)** — still **DEFERRED**: needs a `houses.is_open`
  operating-status column (not added). The switcher type carries an unused `closed?` flag. Brief
  §5 / §2.5 mention it; track separately.
- **#8 join with a real float** — add a seeded pending-float + ack-reminder fixture and assert the
  "Nh reminder sent" label end-to-end (see reconciliation #1). Also verify the PostgREST
  `?payload->>float_id=in.(…)` filter against real data (the JS regroup makes the result correct
  regardless, but confirm no thrown error).
- **Academic-year rotor truncation** (BSpec §2.5 final-week truncation / summer exclusion) — out
  of S6 scope; the rotor still spans the full period in Friday weeks. Track separately.
- **Aggregate coverage is 13× per-house queries in parallel** — fine for an admin board; a batched
  single-query read is a future optimization.
