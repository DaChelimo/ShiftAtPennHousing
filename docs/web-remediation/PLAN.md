# Web Remediation Program — PLAN

Implements the decisions taken on the [web UI gap audit](../../apps/web/design/PROGRESS.md).
Run as **plan-as-artifact + fresh-session-per-chunk** (mirrors `tests/e2e-lifecycle/`).
Each session is self-contained; see [STATUS.md](STATUS.md) for the live tracker.

> **Reference, not duplicated here:** the gap analysis itself (what's broken & why) is
> assumed read. This doc is the _execution_ plan: scope, behavior contracts, test plans,
> dependencies, and session grouping.

---

## Decision → audit-item map

| Decision (user)           | Audit item                  | Title                                                       | Effort | Session                                                                            |
| ------------------------- | --------------------------- | ----------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| 1 "Correct (L)"           | #1                          | Admin override RPC + calendar inline assign/reassign/remove | L      | **S1**                                                                             |
| 2 "Best method"           | #2                          | Force-trigger float (wire existing EF)                      | M      | **S2**                                                                             |
| 3 "Resolved checkbox"     | #3 (reframed)               | Allied-coverage _resolved_ state + unresolved-only inbox    | M      | **S3**                                                                             |
| 4 "Fire (thorough tests)" | #4                          | `fire_worker` orchestrating RPC                             | L      | **S4**                                                                             |
| 5 "Perfect fix"           | #5                          | Hire worker (auth provisioning + roster insert)             | M      | **S5**                                                                             |
| 6+ "apply best fixes"     | #8, #9, #18a                | HMOD context: multi-house calendar/coverage + Friday-anchor | M–L    | **S6**                                                                             |
| 6+                        | #10, #11                    | Config completeness: §14 offset keys + typed validation     | M      | **S7**                                                                             |
| 6+                        | #7                          | Builder: resize-by-drag + Phase-2 search                    | M      | **S8**                                                                             |
| 6+                        | #6, #12, #13, #14, #16, #17 | Polish & hygiene batch                                      | S each | **S9**                                                                             |
| 6+                        | #15                         | Health integration cards                                    | —      | **DEFERRED** (no backend until integrations exist; flag stays)                     |
| 6+                        | #9 (closed-house)           | Closed-house "Closed" state                                 | —      | **DEFERRED** into S6 only if a `houses.is_open` column is added; else out of scope |

---

## How to run a session — the TDD firewall protocol

Your preferred pattern, made concrete. Three roles per session; in a Claude Code session
the **Lead** is the main loop and the other two are subagents.

1. **Lead (spec extraction).** Read the cited BSpec/ARCH sections. Pin any ambiguous decision
   in the session's `TEST_PLAN.md`. Produce the **Behavior Contract** = a checklist of
   `should …` statements (these become test _names_) + expected behavior in prose. No assertion
   code, no magic numbers beyond what the spec fixes.
2. **Test Author (subagent).** Receives the Behavior Contract + repo. Writes the actual tests
   (pgTAP / Vitest / Playwright) so each contract line maps to ≥1 named test. May read all code.
   Commits tests **red**. Outputs the list of test names + the run command.
3. **Implementer (subagent) — firewalled.** Receives the Behavior Contract + the list of test
   _names_ + the files it may edit. **Explicitly instructed NOT to open any test file**
   (`tests/**`, `*.test.ts`, `*.spec.ts`, `*_test.sql`, pgTAP `.sql` under `tests/`) for this
   feature. Writes implementation. Cannot run the tests itself (so it can't read assertion
   output verbatim); instead it hands work back to the Lead.
4. **Lead (verify & relay).** Runs the suite. Relays back to the Implementer a **failure
   summary** — failing test _name_ + a behavioral paraphrase of the failure (e.g. "removing a
   permanent slot should leave a `permanent_drop` vacancy, but the row is still `scheduled`") —
   **never the assertion source**. Loop 3–4 until green.
5. **Lead (review).** Confirm green is _real_: no test weakened, behavior matches spec not just
   the assertions, hard invariants intact (below). Run the full repo gate. Update STATUS.md.

Why the firewall: it stops the implementer from coding to the assertions instead of to the
behavior — the same reason `AGENTS.md` says "do not infer behavior from test bodies."

**Per-session deliverable layout:** `docs/web-remediation/sessions/S<n>/` holding `TEST_PLAN.md`
(behavior contract + pinned decisions) and a short `NOTES.md` (what shipped, follow-ups).

---

## Non-negotiable invariants (every session re-checks these)

From `AGENTS.md` — a remediation must never regress them, and **admin override / fire do NOT
bypass them**:

1. **Harnwell training**: no non-`home_house=harnwell` worker on the Harnwell desk via _any_
   path — including admin override and replacement-after-fire.
2. **Float direction**: 11-single-staff workers are never float sources; quad never floats to
   Harnwell. Any cross-house admin placement respects this.
3. **No-takeback**: automation can't revoke a `pending`/`acknowledged` float — but **manual
   SM/HM/BM override can** (this is what S1 admin-remove and S4 fire rely on; allowed).
4. **Hours cap not checked on float**; cap is soft (20h, overridable) on claim/assign.
5. **30-minute block atomicity** on 30-min boundaries.
6. **`timestamptz` America/New_York**; duration arithmetic across DST, never wall-clock.

After any migration: `supabase gen types typescript --local > packages/shared/src/database.types.ts`.
Repo gate before "done": `pnpm type-check && pnpm lint && pnpm build && pnpm test` + the
session's pgTAP + (where touched) `pnpm --filter web e2e` (needs `supabase db reset` first).

---

# Sessions

## S1 — Admin override (Decision 1 / audit #1) · **L · own session**

**Goal.** Make the live calendar's inline override real: an HM/SM can **assign**, **reassign**,
or **remove** a worker on a block, with **this-week-only vs permanent** scope and a
**warning-confirm** when overriding a soft constraint. Also unblocks post-publish schedule edits
(BSpec §4.3 Phase 3), which currently write to inert drafts.

**Spec.** BSpec §4.3 (Phase 3 override "same card UI"), §11.1, §1.2/§1.5 (invariants); brief §6.1.

**Backend.**

- `packages/core/src/admin-override/` — **pure** validator. Input: a state snapshot (block(s),
  target worker profile, house, scope). Output: `{ hardBlocks: [...], advisories: [...] }`.
  - _Hard blocks (never overridable):_ Harnwell-training, float-direction (for cross-house),
    closed-house, non-30-min span.
  - _Advisories (overridable with confirm):_ worker marked `cannot` for the block, `opted_out`,
    over soft cap.
- Migration: `admin_assign_worker(p_initiator, p_block_ids uuid[], p_user_id, p_scope text,
p_override_advisories bool, p_now)` and `admin_remove_worker(p_initiator, p_block_ids,
p_user_id, p_scope, p_now)` (and `admin_reassign` = remove+assign in one txn, or compose).
  - `this_week` → single-occurrence write (assign) / `drop_shift`-style vacate (remove).
  - `permanent` → reuse `permanent_pickup_slot` / `permanent_drop_slot` mechanics across the
    period's recurring pattern.
  - SECURITY DEFINER; `REVOKE … FROM PUBLIC; GRANT … TO service_role`. RLS: writer must be house
    admin (`user_has_house_admin_role`) or builder (`user_can_build_schedule`) for the block's house.
  - Remove of a worker who has a `pending`/`acknowledged` float = allowed manual revoke (invariant #3).

**Frontend.**

- `apps/web/lib/actions/override.ts` — `assignWorker` / `removeWorker` / `reassignWorker`
  server actions (service client; gate on `canBuildSchedule`/`isHouseAdmin`).
- `components/calendar/ShiftDetailPanel.tsx` — enable the override section: worker picker for
  vacant/reassign, scope toggle (This week / Permanent), advisory confirm modal listing the
  `advisories`. Remove the "Read-only in this build" notice.
- Post-publish: builder, once `published`, routes edits through these actions (or links to the
  calendar override) instead of `assignDraft`.

**Behavior Contract (give to implementer).**

- assign a worker to a **vacant** block (this-week) → block becomes `scheduled` for that worker, headcount honored.
- assign **permanent** → the worker holds that recurring slot for every remaining week of the period.
- reassign: moving worker A→B on a block vacates A's seat and seats B atomically.
- remove (this-week) → that occurrence becomes `vacant` with correct vacancy origin; remove (permanent) → a permanent opening.
- removing a worker who has a pending float on that seat voids the float (allowed manual revoke).
- assigning a worker marked `cannot`/`opted_out`/over-cap is **blocked unless** `override_advisories=true`; with it, succeeds and is auditable.
- **Harnwell**: assigning a non-Harnwell-home worker to a Harnwell block is rejected even with `override_advisories=true`.
- **float direction**: cross-house admin placement that violates direction rules is rejected.
- permission: a non-admin / admin-of-another-house caller is rejected.
- post-publish: an override after publish changes the _live_ schedule (not a draft).

**Tests.** Vitest (core validator: advisories vs hard blocks, every invariant). pgTAP
(each contract line; grants/RLS). Playwright (assign-to-open-shift, reassign, remove, scope
toggle, advisory confirm on the calendar).

**Why own session:** largest/foundational; its behavior spec is dense; S5 depends on it.
**Split valve:** if context fills, ship **S1a** (core + RPCs, pgTAP/Vitest green) then **S1b**
(calendar UI + Playwright) as two sessions.

---

## S2 — Force-trigger float (Decision 2 / audit #2) · **M · own session**

**Goal.** Wire the _already-built, tested_ force-trigger backend into Coverage.

**Backend.** None new. The `force-trigger` Edge Function + `force_trigger_float` RPC do the whole
lookup; caller supplies only `{ destination_house_id, block_ids }`.

**Frontend.**

- `lib/data/coverage.ts` — add `blockIds: string[]` to `CoverageGap`; collect member block UUIDs
  in the coalescing loop (reverse-map from `blockMeta`). Only mark a gap force-triggerable when
  its blocks are `vacant` (broadcast stage) — not already `float`/`allied`.
- `lib/actions/forceTrigger.ts` — server action copying the EF-call shape in `lib/actions/leave.ts`
  (session access token → `POST …/functions/v1/force-trigger`), `revalidatePath('/coverage')`.
- `components/coverage/CoverageMonitor.tsx` — enable the button → confirm modal → result:
  `floatAssignmentIds>0` ⇒ "Pending floater(s) assigned"; `alliedNotifications>0` ⇒ "Routed to
  HMOD for Allied"; reason `float_disabled` ⇒ the §6.5 winter-break gated-out note.

**Behavior Contract.**

- a vacant gap exposes its real block UUIDs to the action layer.
- force-triggering a coverable gap returns pending floater(s) and they appear "(Pending)" on calendars.
- force-triggering when no candidate exists routes to HMOD-for-Allied (no float row created).
- force-triggering during a non-floating profile is rejected with the winter-break note.
- a gap already at float/allied stage is not offered the action.
- no-takeback: no UI path revokes a resulting pending float.

**Tests.** Vitest (CoverageGap now carries blockIds; result→message mapping). Playwright
(force-trigger happy path → pending floater; no-candidate → Allied note). The lookup math itself
is already covered by `packages/core` findFloaters tests — don't re-test it.

**Why own session:** independent backend; shares files with S3 → do **S2 before S3**.

---

## S3 — Allied "resolved" state + unresolved-only inbox (Decision 3 / audit #3) · **M · own session**

**Goal.** Replace "Call Allied / Mark notification read" on the **Allied-coverage-needed**
(`hmod_urgent`) notification with a single **Resolved** checkbox an HM/HMOD ticks. The inbox's
Allied section then shows **only unresolved** requests (with a way to view/untick resolved ones).
Fold in the trivial general mark-read for non-urgent items so the inbox is coherent.

**Backend.**

- Migration: add `resolved_at timestamptz`, `resolved_by uuid REFERENCES users(user_id)` to
  `notifications` (nullable; meaningful for `hmod_urgent`).
- `set_allied_resolved(p_notification_id, p_user_id, p_resolved bool, p_now)` — SECURITY DEFINER;
  only operates on `type='hmod_urgent'`; gate to the house's HM/BM **or** the on-duty HMOD;
  sets/clears `resolved_at`/`resolved_by`. Idempotent.
- Wire existing `mark_notification_read` for non-urgent types (it already exists, granted to `authenticated`).

**Frontend.**

- `lib/data/inbox.ts` — expose `resolved` per item; **default query excludes resolved
  `hmod_urgent`**; add a `?show=resolved` path (or a "Resolved" collapsed group). Also fix the
  comment-vs-code drift: actually filter by due time (`scheduled_for <= now`) (audit #18b, folded
  here since it's the same query).
- `lib/actions/inbox.ts` — `setAlliedResolved` (toggle) + `markRead`.
- `components/inbox/ActionInbox.tsx` — `hmod_urgent` row renders a **Resolved checkbox** (no more
  Call-Allied/Mark-read pair); ticking removes it from the active list; a "Show resolved" affordance
  lets you untick a mis-click. Non-urgent rows keep a plain mark-read.
- `components/coverage/CoverageMonitor.tsx` — the `esc==='allied'` gap reflects resolved state
  (badge) but the gap itself persists until the block is actually covered (resolved = "alert handled
  out-of-band", not "seat filled"). Note this distinction in NOTES.md.

**Behavior Contract.**

- ticking Resolved on an Allied alert sets `resolved_at`/`resolved_by` and drops it from the default inbox.
- unticking (from the resolved view) clears resolution and it reappears.
- only HM/BM-of-that-house or the on-duty HMOD may resolve; others rejected.
- only `hmod_urgent` notifications are resolvable.
- resolving is idempotent (double-resolve is a no-op, not an error).
- the default inbox shows unresolved Allied requests only — never a mix.
- non-urgent notifications still support mark-read; future-scheduled notifications don't show yet.

**Tests.** pgTAP (resolve/unresolve, gating incl. HMOD-on-duty, hmod_urgent-only, idempotency).
Vitest (inbox data layer: default excludes resolved + future; resolved view includes). Playwright
(tick → leaves list; show-resolved → untick → returns).

**Depends on:** nothing hard, but **runs after S2** (shared `CoverageMonitor.tsx` / `coverage.ts` /
inbox files) to avoid merge churn.

---

## S4 — Fire a worker (Decision 4 / audit #4) · **L · own session · tests are the point**

**Goal.** One transactional `fire_worker` that correctly unwinds _every_ obligation per BSpec §4.5.
**Correctness anchor:** `is_active=true` is checked on _all_ future claim/float/broadcast paths, so
flipping `is_active=false` handles **future** exclusion for free — the RPC's job is the
**already-scheduled** unwinding + the **in-progress** urgency branch.

**Spec.** BSpec §4.5 (firing semantics), §5.4 (escalation), §6 (float lookup), §8 (swaps).

**Backend.**

- (Optional) `packages/core/src/firing/` pure planner: given a snapshot, return the _plan_
  (which slots to permanent-drop, which occurrences to vacate, which floats/swaps to void, whether
  an in-progress block needs immediate escalation). Pure ⇒ unit-testable without DB.
- Migration `fire_worker(p_initiator, p_user_id, p_now)` — SECURITY DEFINER, one transaction:
  1. **In-progress block** (now ∈ an assigned block): vacate immediately → headcount recheck →
     escalate **straight to float lookup** (skip T-3h broadcast; it's urgent).
  2. **Future recurring slots**: `permanent_drop_slot`/`permanent_drop` each → permanent openings.
  3. **Future non-recurring** claims/pickups: vacate.
  4. **Floats** where worker is source or destination (`pending`/`acknowledged`): void
     (no-takeback waived for firing, §4.5) → re-run lookup **excluding** the fired worker.
  5. **Swaps**: the `void_pending_swaps_for_vacated_seat` trigger fires as seats vacate — verify it
     catches all; void any it doesn't.
  6. `users.is_active = false`.
  - Gate: HM/BM admin over the worker's home house. Idempotent if already inactive.

**Behavior Contract (give to implementer — keep it exhaustive, this is a multi-step action).**

- _Future scheduled_: every future recurring slot of the fired worker becomes a **permanent opening**.
- _In-progress_: a block in progress at `p_now` is vacated and escalates **directly to float
  lookup** (a `float`/lookup step exists; **no** T-3h broadcast step is created).
- _Non-recurring_: future one-off claims/pickups are vacated (not permanent-dropped).
- _Floats out_: a `pending`/`acknowledged` float where the worker is the **destination** is voided;
  the destination seat re-enters lookup.
- _Floats in_: a float where the worker is the **source** is voided and the source seat handled.
- _Re-lookup excludes the fired worker_: after firing, the fired worker is never selected as a floater.
- _Swaps_: any open swap touching the worker's seats is voided.
- _Deactivation_: `is_active=false` after firing.
- _Future exclusion via deactivation_: a fired worker cannot claim, be floated, or receive a
  broadcast afterward (driven by the `is_active` gate).
- _Permission_: SW cannot fire; HM of a **different** house cannot fire this worker; HM/BM of the
  worker's home house can.
- _Idempotency_: firing an already-inactive worker is a safe no-op (no double vacancies).
- _Atomicity_: if any step raises, the whole fire rolls back (no half-fired state).
- _Harnwell/edge_: firing a Harnwell worker, and firing a worker who is **currently floated out**,
  both unwind cleanly.
- _No phantom hours_: vacated future blocks stop contributing to the worker's projected hours.

**Frontend.** `lib/actions/people.ts` → `fireWorker`; `PeopleRoster.tsx` destructive confirm modal
(spec text: "vacates all shifts, voids floats, deactivates account; mid-shift gaps escalate
immediately"). Enable the per-row Fire button.

**Tests.** **pgTAP-heavy** — one test per contract line above, plus an **integration scenario**
(a worker with: 1 in-progress block, ≥2 future recurring slots, 1 non-recurring claim, 1 outbound
pending float, 1 inbound acknowledged float, 1 open swap) asserting the _entire_ end state in one
fixture. Vitest for the pure planner. Playwright for the confirm-modal flow. Per the user: make
these **very thorough** — prefer over-coverage.

**Why own session:** highest blast radius; thorough isolation is the whole point.
Shares `PeopleRoster.tsx`/`people` action with S5 → do **S4 before S5** (or coordinate the file).

---

## S5 — Hire a worker (Decision 5 / audit #5) · **M · own session · after S1**

**Goal.** Add a worker mid-period; then assignment happens via the now-working S1 override.

**Backend.**

- `provision_user(p_user_id, p_name, p_email, p_phone, p_home_house, p_roles text[], p_now)` —
  inserts `users` + `user_roles` atomically; enforces the `scope_house_id` CHECK (sm/hm/bm need a
  scope, sw null), valid role combos (no bm+sw), home-house rules (incl. Harnwell). SECURITY
  DEFINER; gate HM/BM.
- **Auth user creation is not pure SQL** — `users.user_id` FKs `auth.users(id)`. So the server
  action calls `supabase.auth.admin.createUser` / `inviteUserByEmail` (service role, sends the
  credential email) → then `provision_user` with the returned id.

**Frontend.** `lib/actions/people.ts` → `hireWorker`; `PeopleRoster.tsx` Hire modal (name, email,
phone, home house, role(s)); on success the worker appears in the roster, assignable via S1.

**Behavior Contract.**

- provisioning inserts the user + the requested roles; the worker appears in the house roster as Active.
- a scoped role (sm/hm/bm) without a `scope_house_id` is rejected; an invalid combo (bm+sw) is rejected.
- a Harnwell home-house worker is created consistently with the training rule (so S1 can place them).
- only HM/BM may hire; SW/SM rejected.
- the created auth user receives an invite/credential email (verified at the action/Playwright layer).

**Tests.** pgTAP (`provision_user`: inserts, CHECK enforcement, role-combo validation, grants/RLS).
Vitest (any validation helper). Playwright (hire flow → new roster row). The `auth.admin` call is
Edge/HTTP-layer (scoped out of pure tests, like other EF layers) — cover via Playwright.

**Depends on:** S1 merged (for the "assign via override" half). Can technically ship before S1
(worker created but unassignable until S1) — prefer after.

---

## S6 — HMOD context (audit #8, #9, #18a) · **M–L · own session · after S1+S2+S3**

**Goal.** Make "who is HMOD now" real and let HMOD/admin work across houses.

- **Rotor Friday-anchor (#18a, correctness-first).** `lib/data/rotor.ts` writes Monday-anchored
  `week_start_date` but HMOD weeks are **Friday-08:00 handoffs** (BSpec §2.5, App. A #7). Fix the
  anchor so rotor keys line up with the orchestrator's HMOD interval logic. **Do this first in the
  session** — everything below depends on resolving HMOD correctly.
- **HMOD-now resolution.** Resolve the on-duty HMOD from `hmod_rotor` + clock (reuse
  `resolve_hmod_on_duty`); flip the AppShell pill from hardcoded "Off duty"; wire the notification
  bell to an unread count.
- **Multi-house viewing.** Unlock the house switcher to all 13 for HMOD/admin; honor `?house=` on
  `/calendar` and `/coverage` (gated: only HMOD/admin may leave home house). Coverage in HMOD mode
  aggregates all houses.
- **Ack-reminder indicator (#8).** Coverage's "pending ack" currently hardcodes the state; join the
  float ack-reminder rows to show "6h/2h reminder sent".

**Behavior Contract.** rotor save/read round-trips on Friday keys; the pill shows the real on-duty
HMOD during their window; a non-HMOD can't route to another house; HMOD coverage shows all houses;
the ack indicator reflects real reminder cadence.

**Tests.** Vitest (Friday-anchor math — DST-safe; HMOD-now resolution; switcher gating).
pgTAP if any RPC added. Playwright (HMOD sees other house; non-HMOD blocked).

**Why grouped:** #8/#9/#18a are one coherent "HMOD/house-context" concern sharing AppShell +
calendar/coverage data. Runs after S1/S2/S3 (shares those files). **Closed-house** stays deferred
unless a `houses.is_open` column is added — call that out, don't fake it.

---

## S7 — Config completeness (audit #10, #11) · **M · own session**

**Goal.** Make System Config cover BSpec §14 and stop accepting garbage.

- **Missing offset keys (#10).** Seed escalation offsets (broadcast T-3h, float T-2h, HMOD-notify)
  and ack cadence (6h/2h) as `system_config` rows, and have the orchestrator **read** them instead
  of hardcoded constants. (Backend change — the editor surfaces rows automatically.)
- **Typed validation (#11).** Render inputs by `value_type` (number/enum/uuid/time) and validate
  before upsert in `lib/actions/config.ts`.

**Behavior Contract.** the editor lists every §14 parameter; editing an offset changes orchestrator
behavior; a malformed value (bad int/uuid/time) is rejected before write.

**Tests.** pgTAP (orchestrator reads the new keys; defaults when absent). Vitest (per-type
validation). Playwright (edit + reject invalid).

**Why own session:** touches the orchestrator (correctness-sensitive); independent of the others.

---

## S8 — Builder enhancements (audit #7) · **M · own session**

**Goal.** Resize an assigned span by dragging its edge; add the spec'd Phase-2 search.

- **Resize-by-drag.** Edge handles on a worker's contiguous chip-run; on drop, diff new-vs-old span
  → `assignDraft` (added) / `removeDraft` (removed). **Must preserve** the existing cell `block-<key>`
  testid drag contract (the Playwright suite) — additive only.
- **Phase-2 search.** A controlled input filtering the roster (dead `.side-search` CSS already exists).

**Behavior Contract.** dragging an assignment's edge grows/shrinks it via the diff (no full
re-drag); the existing drag-to-select-and-assign still works unchanged; Phase-2 search filters by name.

**Tests.** Vitest (span-diff helper). Playwright (resize grows/shrinks; original assign flow still
green; search filters). **FRONTEND_ONLY** — no backend.

**Why own session:** delicate drag mechanics + a load-bearing testid contract; don't mix with backend work.

---

## S9 — Polish & hygiene batch (audit #6, #12, #13, #14, #16, #17) · **S each · one session**

Independent, low-risk, no shared blast radius — batch them.

- **#6 Set preference deadline** — `setPreferenceDeadline` action (copy `cap.ts`; service-write
  `scheduling_periods.preference_deadline`); enable the input/button. _Cheapest real win._
- **#12 Dashboard reskin** — `PageHead`/`Card`, prettify house ids, surface §6 entry points.
- **#13 `/components`** — gate the dev gallery behind a flag / drop from prod nav.
- **#14 Cap routes** — make `/admin/hours-cap` a `redirect()` to `/admin/cap` (keep E2E green).
- **#16 Hours CSV export** — serialize `data.rows` client-side.
- **#17 Prefs manual reminder** — "Send due reminders now" → existing `send_preference_reminders()`.

**Behavior Contract.** deadline persists + gates submissions; dashboard renders in the design
system with friendly house names; `/components` hidden in prod; `/admin/hours-cap` redirects; CSV
downloads the visible rows; manual reminder triggers the sweep.

**Tests.** pgTAP only for set-deadline's RLS/gating (the rest is frontend). Vitest (CSV
serializer). Playwright (deadline set; redirect; CSV present). Light.

**Why batched:** six small, orthogonal fixes; one behavior contract, one suite, one PR.

---

## Sequencing & parallelism

```
Wave 1 (foundational, parallelizable):   S1 ─┐   S2 ──┐        S4 ──┐
                                            │        │             │
Wave 2 (share files w/ Wave 1):            S5 (after S1)   S3 (after S2)
                                                              │
Wave 3 (independent, anytime):           S6 (after S1,S2,S3) · S7 · S8 · S9
```

- **Hard dependency:** S5 → S1 (assign-via-override); S3 → S2 (shared coverage/inbox files); S6 → S1+S2+S3 (shared calendar/coverage/AppShell).
- **Soft (file-coordination, not logic):** S4 & S5 share `PeopleRoster.tsx`/people action → do S4 then S5.
- **Fully independent (run whenever):** S7, S8, S9, and the S1/S2/S4 backends don't touch each other's SQL functions.
- **Branch model:** one branch per session off the integration branch (`design/ui-implementation`),
  merge back when its gate is green; update STATUS.md.

## Deferred / not doing

- **#15 Health integration cards** — no integration-status backend exists and none should be faked;
  the flagged note is correct until SMS/Allied/SSO/SIS are actually instrumented.
- **#9 closed-house "Closed"** — needs a `houses` operating-status column; only do it inside S6 if
  that column is added, else leave out.
