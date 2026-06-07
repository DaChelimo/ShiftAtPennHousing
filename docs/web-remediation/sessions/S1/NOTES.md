# S1 — Admin override · NOTES (outcome)

**Status: DONE & GREEN.** Decision 1 / audit #1. Same-house inline override (assign /
reassign / remove a worker on a published block; this-week vs permanent; soft-constraint
confirm). Built via the TDD firewall (test author → contract → firewalled implementer →
Lead verify/reconcile).

## Results

- **Core Vitest:** 587/587 (26 new `admin-override` cases).
- **pgTAP:** 29 files / 1068 tests PASS, incl. `s1-admin-override` (54).
- **Playwright:** full web suite 23/23, incl. `admin-override.spec.ts` (8).
- **Repo gate:** `type-check` (5/5), `lint` (3/3), `build` (19 routes) clean.

## What shipped

- **Pure core** `packages/core/src/admin-override/{types.ts,index.ts}` (+ barrel) —
  `evaluateAdminAssignment` / `evaluateAdminRemoval`, hard-block-over-advisory precedence.
- **Migration** `supabase/migrations/20260606000001_s1_admin_override.sql` —
  `admin_assign_worker` / `admin_remove_worker` (+ `admin_override_cap_assessment` helper);
  reuses `permanent_pickup_slot` / `permanent_drop_slot`; SECURITY DEFINER, service-role grant.
- **Web** — `lib/data/calendar.ts` (`CalShift.blockIds/startAtIso/dateKey` +
  `CalendarModel.assignableWorkers`), `lib/actions/override.ts` (`assignWorker`/`removeWorker`,
  2-step confirm), `components/calendar/ShiftDetailPanel.tsx` (live picker + scope + confirm +
  remove), `HouseCalendar.tsx` (prop threading + `router.refresh`).
- **Seed** `supabase/seed.sql` — an isolated published Summer-2026 Quad week (Mon 2026-06-08)
  with a Cara-occupied seat + vacant open-shift seats, and Fred opted-out (advisory). Does not
  disturb the unpublished Spring period the builder/preferences specs use.
- **Tests** (test-author) — `packages/core/tests/s1-admin-override/`,
  `supabase/tests/s1-admin-override.sql`, `apps/web/e2e/admin-override.spec.ts`
  (+ `e2e/helpers.ts`/`README.md` S1 contract).

## Lead reconciliations (firewall friction — contract under-specified, resolved at integration)

1. **Validator input shape** — contract pinned result/advisory types but not the _input_
   object; author & implementer diverged. Conformed the implementation to the tests
   (test-first): single `seat` + `floatState` axis, single `preference`, pre-computed `hours`
   bundle, top-level `optedOut`; renamed/added type exports (`AdminHardBlockReason`,
   `AdminAdvisoryKind`, `AdminOverrideScope`, `AdminSeatFloatState`, `AdminWorkerPreference`).
2. **RPC authz** — implementer used `user_has_house_admin_role` (hm/bm); D7 wants
   `user_can_build_schedule` (sm/hm/bm). Fixed both call sites.
3. **Permanent `block_started`** — the per-clicked-seat hard checks must apply to `this_week`
   only; for `permanent` the clicked block is the slot descriptor (started/current occurrence
   is expected & skipped). Gated those checks.
4. **pgTAP fixture bugs** (test-side, falsifiable) — `plan(48)`→`(54)`; the +6w occurrence was
   marked `permanent_drop` but is a never-scheduled next-semester block (`never_assigned`); the
   hard-cap seat was placed in the +1w week instead of the loaded/over-ridden anchor week; the
   cross-house test used an operator not authorized for the block's house.
5. **e2e picker/toggle** — converted the worker picker `ComboBox`→native `<select>`
   (`selectOption`) and the scope toggle `aria-pressed` buttons→`role="radio"`/`aria-checked`
   (`toBeChecked`). Both are also semantically correct choices.
6. **Generated types** — implementer stripped Supabase-CLI stderr that had leaked into
   `database.types.ts` (broke parsing). Regenerated cleanly.

## Scope deferred (flagged, not broken)

- **Cross-house** manual placement → RPC rejects `cross_house_not_supported` (picker is
  block-house roster). Follow-up session.
- **Float-committed seats** (`floated_*`/`pending_float_*`) → rejected `float_committed`; the
  admin uses the float decline/void controls (no-takeback preserved).
- **Permanent over operating_calendar** — pgTAP covers it; the e2e seed doesn't add a June
  `operating_calendar`, so e2e exercises this-week (permanent is RPC-tested).

## Follow-ups

- Consider an admin-override audit-log row (who/when/why) for the live-schedule mutation.
- When cross-house/float-committed override is built, extend the picker + RPC accordingly.
