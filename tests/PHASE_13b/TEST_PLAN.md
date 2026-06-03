# Phase 13b — Test Plan: Admin Web App (Next.js — SM/HM schedule builder + admin tools)

This plan enumerates every test for phase-13b, the spec section each test covers,
the contracts the tests pin (TDD-first), and the ambiguities surfaced and resolved
before implementation.

Phase-13b is **the admin's web app** — the desktop SM/HM surface: the schedule
builder (`§4.3`), HM/BM leave management (`§2.6`), and HMOD-rotor admin (`§2.5`). It
is the web sibling of phase-13a (the worker mobile app): its deliverable is the
Next.js app under `apps/web` (today still the scaffold), not the Postgres/Edge
backend. The tests split the same way phase-13a's did — a **pure decision surface**
in `packages/core` tested with Vitest, and the **rendered screens + journeys** tested
with an E2E harness (Playwright here; Maestro there):

| Surface                                                                                                                         | Lives in                                            | Tested with                   |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------- |
| Phase-1 grouping → card view-model (selectability, hours-remaining, over-target); Phase-2 advisory roster; drag-span validation | `packages/core/src/scheduling` (PURE) — **TDD-red** | Vitest                        |
| The builder screens + the leave screen + the end-to-end journeys                                                                | `apps/web` (Next.js) — **TDD-red**                  | Playwright (desktop Chromium) |

Sources of truth:

- `BEHAVIORAL_SPECIFICATION.md`
  §4.3 (Schedule Building — Three Phases; **desktop only**: Phase 1
  preference-assisted drag-picker with preferred/available/blocked grouping +
  blocked-non-selectable + missing-row-as-blocked + hours-remaining + over-target
  warning; Phase 2 manual override = full roster, `cannot`/opt-out downgraded to
  advisory; Phase 3 publish + post-publish override == Phase 2), §2.3 (HM/BM
  administrative override powers; BM is admin-only), §2.6 (HM/BM leave: only HM/BM may
  submit; default replacement = same-house BM/HM; cycle prevention excludes the
  incoming chain; project administrator is the always-valid terminal; pre-filled
  mailto on web), §2.5 (HMOD rotor — weekly, one HMOD per week, planned by HMs/BMs)
- `ARCHITECTURE.md` §3.6 (`preference_status_enum`), §3.9 (`draft_block_assignments`,
  `publish_schedule`), §2.6 (`hmod_rotor`), §2.7 (`hm_leave`)
- `AGENTS.md` — "pure business logic in `packages/core`; the UI is a thin wrapper";
  invariant #5 (every operation on 30-minute block boundaries); invariant #1 (Harnwell
  training constraint — why the builder fixtures use **Quad**, not Harnwell)

Test files:

- `packages/core/tests/phase-13b/phase1-card-algorithm.test.ts` — Vitest, **29 cases**.
  The schedule-builder card algorithm: `validateDragSpan`, `buildPhase1Card`,
  `buildPhase2Roster`. Imports `../../src/scheduling/scheduleBuilderCard.js`, which does
  not exist yet → **TDD-red** (fails to load until the module lands; the phase-04/06..12
  import-of-a-missing-module precedent).
- `apps/web/e2e/schedule-builder.spec.ts` — Playwright E2E (§4.3). Phase-1 grouping +
  blocked-disabled + hours-remaining; assign→draft; over-target warning; Phase-2
  advisory roster; publish→worker visibility; desktop-only. **TDD-red** against the
  scaffold (fails at the first missing selector).
- `apps/web/e2e/hm-leave.spec.ts` — Playwright E2E (§2.6). SM-cannot-submit;
  replacement-picker cycle prevention; pre-filled mailto generation. **TDD-red.**
- `apps/web/e2e/{helpers.ts, README.md}` + `apps/web/playwright.config.ts` — the E2E
  harness, selector contract, and seed contract (the analogue of
  `apps/mobile/maestro/{config.yaml,README.md}`).

The Vitest fixtures are inline (the phase-04/13a precedent — the pure surface is
small) and construct block instants at explicit NY winter offsets (`-05:00`) so every
boundary assertion is unambiguous. The Playwright config adds `@playwright/test` as an
`apps/web` devDependency + `e2e` scripts — the enabling change analogous to phase-13a's
one-line `build.gradle.kts` opt-in.

---

## The Pure Card Contract (TDD-first)

The implementation goes in `packages/core/src/scheduling/scheduleBuilderCard.ts` and is
re-exported from `packages/core/src/index.ts`. It is **pure** (zero Supabase imports)
and **delegates Phase-1 grouping verbatim to phase-04's already-shipped
`groupWorkersForSpan`** (`phase1Grouping.ts`) — phase-13b only _wires that grouping into
the web card view-model_. Until the module lands the Vitest file fails to import, the
intended TDD-red state.

```ts
// span the drag-picker produced — 2..12 consecutive 30-min blocks (§4.3)
export const MIN_SPAN_BLOCKS = 2; // 1 hour
export const MAX_SPAN_BLOCKS = 12; // 6 hours
export type SpanValidation =
  | { valid: true; blockCount: number; hours: number }
  | { valid: false; reason: 'too_short' | 'too_long' | 'not_contiguous' };
export function validateDragSpan(span: SpanBlock[]): SpanValidation;

export type WorkerScheduleInfo = {
  worker: Worker;
  assignedHours: number; // hours already assigned THIS week
  targetHours: number; // submitted target (0..cap)
  optedOut: boolean; // period_targets.opted_out — the "no hours" button
};

// ----- Phase 1 (Preference-Assisted) -----
export type Phase1Entry = {
  worker: Worker;
  status: 'preferred' | 'available' | 'blocked';
  blockedReason?: BlockedReason; // present iff status === 'blocked'
  hoursRemaining: number; // targetHours − assignedHours (may be ≤ 0)
  selectable: boolean; // false iff status === 'blocked'
  wouldExceedTarget: boolean; // assignedHours + spanHours > targetHours (strict)
};
export type Phase1Card = {
  preferred: Phase1Entry[];
  available: Phase1Entry[];
  blocked: Phase1Entry[];
};
export function buildPhase1Card(
  workers: WorkerScheduleInfo[],
  span: SpanBlock[],
  preferences: PreferenceRecord[],
): Phase1Card;

// ----- Phase 2 (Manual Override) / post-publish override -----
export type Phase2Advisory =
  | { kind: 'cannot'; blockId: string; blockStartAt: Date } // first cannot in span order
  | { kind: 'opted_out' };
export type Phase2Entry = {
  worker: Worker;
  assignedHours: number; // total assigned hours (§4.3 Phase 2 shows this)
  hoursRemaining: number;
  advisories: Phase2Advisory[]; // advisory only — never excludes / disables
  wouldExceedTarget: boolean;
};
export function buildPhase2Roster(
  workers: WorkerScheduleInfo[],
  span: SpanBlock[],
  preferences: PreferenceRecord[],
): Phase2Entry[];
```

`Worker`, `SpanBlock`, `PreferenceRecord`, `PreferenceStatus`, `BlockedReason` are
re-exported from `phase1Grouping.ts` so the web layer has a single import surface.

---

## Pinned Decisions

The spec leaves several web-layer choices implicit. These are pinned by the test
suite; the implementation MUST match, and any reinterpretation requires updating both
the tests and this plan.

| #   | Topic                                           | Decision                                                                                                                                                                                                                                   | Why                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Phase-1 grouping delegates to phase-04          | `buildPhase1Card` calls `groupWorkersForSpan` and maps each `GroupedWorker` to a `Phase1Entry`. A worker with **no preference row for any span block** ⇒ `blocked` (missing), not available.                                               | §4.3: missing-for-a-span-block is treated as `cannot` "for Phase-1 grouping purposes only." Re-deriving grouping would risk diverging from the canonical phase-04 rule.                                                                       |
| D2  | Phase-1 selectability                           | `selectable === (status !== 'blocked')`. Preferred/available are selectable; blocked (cannot **or** missing) are not.                                                                                                                      | §4.3: "A worker shown as blocked is rendered as non-selectable in Phase 1: the SM cannot click them to assign."                                                                                                                               |
| D3  | hours-remaining figure                          | `hoursRemaining = targetHours − assignedHours`; may be `0` or **negative** (already over target).                                                                                                                                          | §4.3: each entry shows "their hours-remaining figure (target hours minus hours already assigned this week)."                                                                                                                                  |
| D4  | over-target warning is STRICT                   | `wouldExceedTarget ⇔ assignedHours + spanHours > targetHours`. Exactly at target ⇒ **no** warning. Same rule in both phases.                                                                                                               | §4.3: "If assigning a worker would push them **over** their target hours…". "Over" = strictly greater (consistent with phase-13a soft-cap decision #8).                                                                                       |
| D5  | Phase-2 downgrades constraints to advisory      | `buildPhase2Roster` returns **every** worker (flat, sorted by name) with `advisories`. `cannot` (a span block) and `optedOut` produce advisories; the worker is never removed/disabled. A **missing/`none`** row produces **no** advisory. | §4.3: Phase 2 shows "every worker in the house, sorted by name"; the Phase-1 hard constraints (`cannot`, opt-out) are "downgraded to advisory." Missing is the norm in Phase 2 (fully-unsubmitted workers appear here), so it is not flagged. |
| D6  | Phase-2 advisory order                          | `cannot` (if any span block) is listed **before** `opted_out`.                                                                                                                                                                             | §4.3 lists the two warning labels as "'Marked cannot for this block' **or** 'Opted out — no hours'" — block-specific first.                                                                                                                   |
| D7  | drag-span validation order                      | `validateDragSpan` checks size (2..12) **first**, then strict 30-min contiguity. A 13-block contiguous span is `too_long`, not `not_contiguous`. An empty span is `too_short`.                                                             | §4.3: "a span of 2 to 12 consecutive 30-minute blocks (1 hour to 6 hours)." Size is the headline rule; contiguity guards a malformed picker payload.                                                                                          |
| D8  | fully-unsubmitted exclusion is a caller concern | `buildPhase1Card` groups exactly the workers it is given (the submitter pool). Excluding fully-unsubmitted workers from Phase 1 is the caller's pre-filter; they surface only in `buildPhase2Roster` (given the full roster).              | §4.2/§4.3 + the existing `phase1Grouping.ts` header. The E2E pins the observable consequence: Dana (unsubmitted) is absent from the Phase-1 card but present in Phase-2.                                                                      |
| D9  | Phase-2 == post-publish override                | Post-publish manual overrides use the **same** `buildPhase2Roster` view-model and the same advisory/over-target behavior.                                                                                                                  | §4.3 Phase 3: "The same card UI from Phase 2 (full house roster, search bar) is used for these post-publish edits."                                                                                                                           |
| D10 | builder fixtures use Quad, not Harnwell         | The Vitest + E2E fixtures staff **Quad**.                                                                                                                                                                                                  | AGENTS invariant #1 — Harnwell's training constraint would confound pure grouping assertions; it is enforced elsewhere (eligibility/core, RLS) and is out of scope here.                                                                      |
| D11 | leave mailto is the server's output             | The web HM-leave screen surfaces the pre-filled mailto from `craft_hm_leave_mailto` (phase-12) via `generate-leave-mailto`, as a clickable `mailto:` anchor (`leave-mailto`).                                                              | §2.6 #3: "opens the user's mail application (via a mailto link on web) with the message pre-filled." The body/subject contract is already pinned in phase-12.                                                                                 |
| D12 | cycle prevention is enforced at the picker      | The replacement picker omits every HM/BM in the leaving HM's **incoming chain**; the same-house BM/HM default and the project administrator are always offered (admin never excluded).                                                     | §2.6: selection-time cycle prevention. The submission-time re-check is a server transaction concern (see "Not covered").                                                                                                                      |

---

## Test File Coverage Map

### `phase1-card-algorithm.test.ts` (Vitest) — TDD-red

| Surface                                                                                                                                             | Cases | Decisions |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------- |
| `validateDragSpan` — constants; 2-block & 12-block valid; too_short (1, 0); too_long (13); not_contiguous (gap, descending); size-before-contiguity | 9     | D7        |
| `buildPhase1Card` — delegates grouping; status tags; alpha order; no-pref-for-span ⇒ blocked(missing); blockedReason(cannot)                        | 4     | D1        |
| `buildPhase1Card` — blocked non-selectable; preferred/available selectable; missing-blocked also non-selectable                                     | 2     | D2        |
| `buildPhase1Card` — hours-remaining = target − assigned (positive, zero, negative)                                                                  | 3     | D3        |
| `buildPhase1Card` — wouldExceedTarget: under / exactly-at (no warn) / strictly-over; scales with span                                               | 4     | D4        |
| `buildPhase2Roster` — full roster incl. fully-unsubmitted (no advisory), sorted by name; assigned + remaining hours                                 | 2     | D5, D8    |
| `buildPhase2Roster` — `cannot` ⇒ advisory, worker stays in roster (not removed); clean worker empty; missing ⇒ no advisory                          | 2     | D5        |
| `buildPhase2Roster` — `opted_out` advisory; cannot+opted_out order (cannot first)                                                                   | 2     | D5, D6    |
| `buildPhase2Roster` — over-target uses the same strict rule as Phase 1                                                                              | 1     | D4, D9    |

**Total: 29 cases.**

### `schedule-builder.spec.ts` (Playwright) — TDD-red

| Test                                                                                                                          | Spec         | Decisions  |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------- |
| drag a span → preferred/available/blocked groups + blocking reason + hours-remaining; Dana (unsubmitted) absent from the card | §4.3 Phase 1 | D1, D3, D8 |
| blocked worker is non-selectable (disabled); selectable workers enabled                                                       | §4.3 Phase 1 | D2         |
| assigning a preferred worker updates the draft (both span cells show them)                                                    | §4.3 Phase 1 | D1         |
| assigning over target shows a warning popup; dismiss → assignment proceeds                                                    | §4.3 Phase 1 | D4         |
| Phase 2 full roster shows the unsubmitted worker (selectable)                                                                 | §4.3 Phase 2 | D5, D8     |
| Phase 2 `cannot`/opt-out are advisory (selectable + confirm), not hard blocks                                                 | §4.3 Phase 2 | D5, D6, D9 |
| publish → the assigned worker sees their shift                                                                                | §4.3 Phase 3 | —          |
| desktop-only: a mobile viewport shows a desktop-only notice instead of the grid                                               | §4.3         | —          |

### `hm-leave.spec.ts` (Playwright) — TDD-red

| Test                                                                                | Spec       | Decisions |
| ----------------------------------------------------------------------------------- | ---------- | --------- |
| an SM cannot submit HM leave (leave admin denied)                                   | §2.6, §2.3 | —         |
| the replacement picker excludes the incoming chain; offers the default BM + admin   | §2.6       | D12       |
| HM submits leave with a valid replacement → a pre-filled mailto anchor is generated | §2.6       | D11       |

The selector + seed contracts are tabulated in `apps/web/e2e/README.md`.

---

## HMOD-rotor admin (§2.5) — coverage note

The §2.5 rotor-admin surface ("only HMs/BMs may populate the rotor; each week has
exactly one HMOD") has **no new phase-13b test file** — its invariants are already
enforced and pinned at the data layer, and the web form is a thin wrapper over them:

- **One HMOD per week** is structural: `hmod_rotor.week_start_date` is the PRIMARY KEY
  (migration `20260526000007_hmod_rotor.sql`) — a second row for the same week is a
  PK violation. Resolution (`resolve_hmod_on_duty`, `20260528000008`) reads exactly one
  row per Friday-anchored week.
- **Only HMs/BMs may populate** is an RLS/authorization concern (the `hmod_rotor`
  write policy + the web route guard), the same shape as the §2.3 "HM/BM-only" gate the
  `hm-leave` E2E exercises for SM-denial.

The phase-13b **web rotor-admin form** (a CRUD UI over `hmod_rotor`) is therefore
deferred from automated E2E this phase and verified manually, the same way phase-13a
deferred some screens to manual Maestro runs. It is **not** silently dropped: this note
records the deferral and where the invariants live. A future `hmod-rotor.spec.ts` would
assert (a) the SM is denied the rotor admin, and (b) assigning a second HMOD to an
already-assigned week is rejected.

---

## What This Phase Does NOT Cover

- **The data/persistence layer.** How `WorkerScheduleInfo` / preferences reach the card,
  and how a click writes a `draft_block_assignment` or (post-publish) a
  `shift_block_assignment`, is the app's data layer — the web analogue of the Edge/HTTP
  layer phases 07–12 scoped out. The pure functions take a snapshot; the Vitest pins the
  decision logic over it, the E2E pins the rendered outcome.
- **The publish mechanics.** `publish_schedule` (draft→assignment conversion, vacancy
  rows, re-publish guard, atomicity) is **phase-04** (`supabase/tests/phase-04-publish.sql`).
  The E2E asserts only the observable §4.3-Phase-3 outcome: after publish, the worker
  sees their shift.
- **Leave resolution + mailto internals.** Walking the delegation graph
  (`resolve_hm_for_user`/`resolve_hm_for_house`, depth-limit 10) and crafting the mailto
  body (`craft_hm_leave_mailto`) are **phase-07/12** (SQL). Phase-13b wires them to the
  web UI; the E2E pins the picker exclusion (selection-time cycle prevention) and the
  surfaced `mailto:` href, not the SQL.
- **Submission-time cycle prevention + "I'm back" side effects** are now IMPLEMENTED
  in SQL (migration `20260601000003`: `submit_hm_leave` re-runs the incoming-chain check
  inside the insert transaction; `end_hm_leave_early` cancels + notifies the released
  replacement and returns the back-from-leave mailto; `craft_hm_return_mailto`) and
  covered by pgTAP (`supabase/tests/phase-13b-leave-submit-and-return.sql`), not by these
  UI flows. **Still deferred:** layered/cascading leave resolution, the depth-10
  config-error path, and HMOD-interval transfer on leave (§2.6 #2/#4) — resolution
  concerns for a follow-up phase.
- **Harnwell training constraint (invariant #1).** Enforced in `packages/core/eligibility`
  - RLS and already tested; the builder fixtures deliberately use Quad to keep grouping
    assertions clean (D10).
- **Preference submission + reminders (§4.1/§4.2).** The worker-facing preference UI and
  the reminder cron are phase-04/07; phase-13b consumes submitted preferences.
- **Pixel-level styling.** Exact copy of the hours-remaining label, the blocked-reason
  string, advisory wording, and the calendar's visual treatments are rendering concerns
  verified by eye; the E2E asserts presence/behavior (grouped, disabled, advisory,
  warning, published) and matches text only loosely (`/cannot/i`, the mailto's encoded
  subject/body), not full copy.

---

## Ambiguities — resolved

| #   | Surface                                                                     | Resolution                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Is "over target" inclusive or strict at exactly the target?                 | **Strict** (D4). At exactly target, no warning. §4.3 says "push them **over**"; consistent with phase-13a's soft-cap decision #8.                                                                                                                               |
| 2   | Does a **missing** span block produce an advisory in Phase 2?               | **No** (D5). §4.3 names only `cannot` and the opt-out as the downgraded constraints; Phase 2 shows fully-unsubmitted workers as a matter of course, so a missing row is the norm there, not a warning. Missing-as-blocked applies to **Phase 1** grouping only. |
| 3   | When both `cannot` and `opted_out` apply, what order?                       | **cannot before opted_out** (D6) — block-specific first, mirroring §4.3's label ordering. Both surface; neither suppresses the other.                                                                                                                           |
| 4   | A 13-block span that is also non-contiguous — which error?                  | **too_long** (D7): size is checked before contiguity. The picker's headline rule is the 2..12 bound.                                                                                                                                                            |
| 5   | Does `buildPhase1Card` itself exclude fully-unsubmitted workers?            | **No** (D8) — it groups its input (the submitter pool); the caller pre-filters, matching the existing `phase1Grouping.ts` contract. The E2E pins the user-visible result (Dana absent from Phase 1, present in Phase 2).                                        |
| 6   | Is the post-publish override card a separate algorithm?                     | **No** (D9). It reuses `buildPhase2Roster` — §4.3 Phase 3 says the post-publish edit UI is "the same card UI from Phase 2."                                                                                                                                     |
| 7   | How should the E2E assert "mailto generated" when a mail client can't open? | The web renders the mailto as an anchor (`leave-mailto`); the test reads its `href` and matches the `craft_hm_leave_mailto` contract (subject `Housing%20Manager%20leave%20notice`, body fragments, replacement name + role, SW recipients). (D11.)             |

---

## Why TDD-Red (and how the contracts were validated)

Phase-06..13a established the red-first pattern: tests reference a not-yet-existing
symbol/selector and fail; the implementation lands in a follow-up and turns them green.
Phase-13b follows it on both surfaces:

- **Vitest.** `phase1-card-algorithm.test.ts` imports
  `../../src/scheduling/scheduleBuilderCard.js`, which `src/scheduling/` does not define
  yet → the suite fails to load (`Failed to load url …scheduleBuilderCard.js`), the
  TypeScript analogue of phase-12's import-of-a-missing-module. The phase-04 grouping
  suite still passes, so the red is localized.

  The contract was **dry-run validated**: a scratch `scheduleBuilderCard.ts` matching the
  pinned decisions turned all **29** cases green under Vitest, and type-checked clean
  under the repo's strict config (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
  via `tsc -p tsconfig.json` and `-p tsconfig.test.json` (zero errors in the new file;
  the only `tsconfig.test.json` errors are pre-existing in `tests/phase-02/`). The scratch
  was then **removed** so the deliverable stays tests-only, and the import-failure red was
  re-confirmed — the same dry-run the phase-10/11/13a plans describe.

- **Playwright.** The two specs reference `data-testid` / `role` selectors the scaffold
  app does not expose → each fails at its first `expect(...).toBeVisible()`. They were
  validated as **well-formed** (each `.ts` parses cleanly via `esbuild`; the selector
  contract is cross-checked against `apps/web/e2e/README.md`) and left red against the
  scaffold, exactly as phase-13a left its Maestro flows red against the scaffold mobile
  app. They are not runnable from a unit-test host — like Maestro, they require a seeded
  backend + the running app (see the README run checklist).
