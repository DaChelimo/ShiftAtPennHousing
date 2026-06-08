# S3 — Allied "resolved" state + unresolved-only inbox · NOTES (outcome)

**Status: DONE & GREEN.** Decision 3 / audit #3 (reframed). Replaced the dead
"Call Allied / Mark covered" pair on the `hmod_urgent` (Allied-coverage-needed)
notification with a single **Resolved** checkbox an HM/BM-of-the-house or the on-duty
HMOD ticks; the inbox's default view now shows **only unresolved** Allied requests,
with a "Show resolved" view to untick a mis-click. Folded in the non-urgent mark-read
(wired the existing `mark_notification_read`) and the inbox due-time filter (audit
#18b). Built via the TDD firewall (Lead contract → Test Author red → firewalled
Implementer → Lead verify/reconcile).

## Results

- **Core Vitest:** 608/608 (11 new `s3-inbox` cases — the pure `isDue` /
  `isResolvedAllied` / `belongsInInboxView` predicates).
- **pgTAP:** `s3-allied-resolved.sql` **35/35 PASS** (isolation and within the full
  `supabase test db`).
- **Playwright:** `inbox-resolve.spec.ts` **6/6 PASS** (standalone and within the full
  web suite). The rest of the web suite (admin-override, cap, hm-leave,
  schedule-builder) stays green.
- **Repo gate:** `pnpm type-check` (5/5) · `lint` (3/3) · `build` (19 routes, `/inbox`
  dynamic) · `test` (608) — all clean.

## What shipped

- **Migration** `supabase/migrations/20260606000002_s3_allied_resolved.sql` — adds
  `notifications.resolved_at timestamptz` + `resolved_by uuid REFERENCES users(user_id)
ON DELETE SET NULL` (idempotent), and the `set_allied_resolved(p_notification_id,
p_user_id, p_resolved, p_now) RETURNS boolean` SECURITY DEFINER RPC (returns
  "state changed"; idempotent no-op returns false; RAISE `notification_not_found` /
  `not_resolvable` / `not_authorized`; gate = HM/BM of `payload.house_id` **or** the
  on-duty `resolve_hmod_on_duty(p_now)`; REVOKE PUBLIC + GRANT authenticated,
  service_role).
- **Pure core** `packages/core/src/inbox/index.ts` (+ barrel line) — `isDue` (Date
  comparison, not string), `isResolvedAllied`, `belongsInInboxView` (the due gate
  applies in BOTH views; default = everything-but-resolved-Allied; resolved =
  resolved-Allied-only).
- **Web** — `lib/data/inbox.ts` (`getInboxData(view, now)`: selects the new columns,
  partitions via the core predicates, `InboxItem.resolved` + `InboxData.{view,
resolvedCount}`); `lib/actions/inbox.ts` (`setAlliedResolved` gated `isHouseAdmin`,
  `markRead` gated signed-in — both service-client RPCs, `revalidatePath('/inbox')`);
  `components/inbox/ActionInbox.tsx` (native `inbox-resolve-checkbox` per urgent row,
  `inbox-mark-read` per non-urgent row, `inbox-show-resolved`/`inbox-hide-resolved`
  links, `router.refresh()` after a write; removed the "Read-only in this build"
  notice; kept `.inbox-item`/`.unread-dot`); `app/(app)/inbox/page.tsx` (async
  `?show=resolved` → view).
- **Generated types** `packages/shared/src/database.types.ts` — regenerated (carries
  the two new columns + `set_allied_resolved`).
- **Seed** `supabase/seed.sql` — four `now()`-relative notifications for Hana Quad (the
  Quad HM): an unresolved + a resolved Allied alert (distinct reasons, both read), a
  non-urgent unread item (mark-read target), and a future-scheduled item (#18b hidden).
- **Tests** (Test Author) — `supabase/tests/s3-allied-resolved.sql`,
  `packages/core/tests/s3-inbox/inbox.test.ts`, `apps/web/e2e/inbox-resolve.spec.ts`.

## Resolved ≠ covered (the load-bearing distinction)

Ticking **Resolved** marks the _alert_ handled — the HM/HMOD made the Allied call
out-of-band. It does **not** fill the coverage seat. `set_allied_resolved` mutates
**only** the `notifications` row; pgTAP line A16 proves it (an md5 content-checksum of
the whole `shift_block_assignments` table is byte-identical before/after a resolve
toggle, and the escalated quad seat stays `vacant`). So the coverage board keeps showing
the gap until the block is actually covered, and no-takeback (invariant #3) holds — a
resolve can never revoke a pending float. The coverage board was therefore left
**untouched** this session (see Deferred).

## Lead reconciliations (firewall friction, resolved at integration)

1. **e2e robustness (Lead-authored).** The seed carries _both_ a resolved (N2) and an
   unresolved (N1) Allied alert (per the program's "one resolved, one unresolved"
   requirement), which breaks a naive "one checkbox per view" assumption (the resolved
   view shows N1+N2 together during a round-trip → Playwright strict-mode violation) and
   makes the suite order-dependent on the shared DB (`workers:1`, no per-test reset). The
   Lead hardened `inbox-resolve.spec.ts`: every checkbox interaction is **scoped to its
   `.inbox-item` row by the distinct reason text**, the resolve flow is a
   **self-restoring round-trip on N1** (resolve → unresolve; N2 untouched), and mutations
   use `.click()` (not `.check()`/`.uncheck()`) so the post-write `router.refresh()`
   detaching the row isn't a race. TEST_PLAN D11/§4c updated to match (N1/N2 distinct
   reasons + seeded read).
2. **pgTAP `function_returns` (falsifiable test bug, Lead-fixed).** Test 2 used
   `function_returns(schema, name, args[], 'boolean', …)` — the only suite in the repo to
   do so (15 others use `has_function`). Its args-array overload normalizes `timestamptz`
   inconsistently with `has_function` (which passed on the same signature) and reported
   "function does not exist" though the function exists and is exercised by 33 behavior
   assertions. Swapped it for a catalog assertion `is(pg_get_function_result(…
::regprocedure), 'boolean', …)` — same test name, same `plan(35)`, the repo idiom (the
   grant check already reads the catalog). 35/35.
3. **Implementer micro-decisions, accepted:** `notifications.type` is the
   `notification_type` ENUM (not `text`) → `v_type` declared as the enum, `'hmod_urgent'`
   coerces; back-link glyph `chevLeft` (no `arrowLeft` in the icon set) — testid + `/inbox`
   href are exactly as pinned. Both correct.
4. **Generated types** regenerated cleanly (no leaked CLI stderr); the web app consumes
   types from `packages/shared/dist`, so `pnpm --filter @shift/shared build` is part of the
   type-gen step.

## ⚠️ Pre-existing issues SURFACED (NOT introduced by S3 — proven at baseline)

1. **Full `supabase test db` is red on 3 unrelated suites** — `s1-admin-override.sql`,
   `phase-04-preferences.sql`, `phase-10-bulk-ops.sql` all abort in fixtures with
   `scheduling_periods_no_overlap`: each INSERTs a Jun–Aug 2026 scheduling_period that
   overlaps the **seed's S1 Summer-2026 period** `[2026-06-01, 2026-08-02)`. Verified
   **pre-existing**: with the S3 migration removed and the S3 seed change stashed (HEAD
   state), all three fail with the identical conflict. S3 adds **zero** scheduling_periods.
   The 27 other pgTAP files (incl. `s3-allied-resolved` 35/35) pass. **Flagged as a
   follow-up task** (the fix belongs to those suites/seed, not S3 — and the Summer period
   is load-bearing for the S1/S2 e2e). Run the S3 suite directly to see green:
   `supabase test db supabase/tests/s3-allied-resolved.sql`.
2. **`force-trigger.spec.ts:148` (live-EF round-trip) flakes in the full web suite** —
   passes in isolation (1.9 s) but can exceed its 20 s timeout under full-suite load: the
   edge runtime's `oneshot` policy cold-spawns a fresh Deno worker per request (the S2
   NOTES document this). It needs `pnpm --filter @shift/core build` + a **full
   `supabase stop && start`** to (re)mount `packages/core/dist` — `db reset` alone leaves a
   503/stale EF. S2 deliverable; S3 never touched coverage/force-trigger. Operational
   reminder when running the web e2e: build core + stop/start the stack first.
3. **CoverageMonitor duplicate-key dev warning** (`…-allied-0`) — a pre-existing S2 React
   key collision when an allied-stage gap has multiple seats; non-blocking, in code S3
   didn't touch.

## Deferred (flagged, not broken)

- **Coverage board resolved-badge** — PLAN floated reflecting resolved-state on the
  `esc==='allied'` coverage card. No behavior-contract line covered it and it needs a
  coverage-data → notifications join; adding it untested would be scope creep and risks
  the resolved-vs-covered separation. Deferred (D10); the distinction is preserved by
  _not_ touching coverage. A future session can add a read-only "alert resolved" badge.

## Follow-ups

- Fix the pre-existing full-suite pgTAP overlap (the 3 suites above) — likely a
  `DELETE FROM scheduling_periods` in their BEGIN/ROLLBACK fixtures, or non-overlapping
  fixture dates. Tracked as a spun-off task.
- (Optional) coverage "alert resolved" badge once a coverage↔notifications join is built.
