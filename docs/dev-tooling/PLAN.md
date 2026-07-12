# Dev Seeding Tools — Simulate Preferences & Auto-build Schedule

Two admin-only dev-tooling features that let one person (e.g. Alice) test the full
summer workflow without logging in as every SW/SM to paint preferences or as every SM
to build a schedule.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done.

Revised 2026-07-11 after a code-verification review (actor-uuid vs auth.uid() under the
service client, target-hours cap trigger, per-house template-week anchoring, SW-only
consumer rosters, multi-phase publish aborts, voided-block publish bug).

## Scope & locked decisions (2026-07-10)

- **Home:** `/admin/operations` (already strictly `isAdmin`-gated; season/period home).
- **Whose preferences:** SW **and** SM of every open house. (SW by `home_house_id`;
  SM by `user_roles.role = 'sm'` + `scope_house_id`, prefs attached to the SM's HOME
  house's blocks — that is what the paint page shows them.) NOTE: both current
  preference consumers — the builder (`lib/data/scheduleBuilder.ts`) and the AI agent
  (`lib/data/aiSchedule.ts`) — build their rosters from `role = 'sw'` only, so SM rows
  are generated for realism/future-proofing but nothing reads them yet.
- **Target period:** the **current summer season's** `scheduling_periods` row (the season
  selected in `/admin/operations`), across that season's **open houses** only.
  `apply_compiled_season` creates the period row with `period_id == season_id` (see
  `setSeasonPreferenceDeadline` in `operatingSeasons.ts`), so no lookup query is needed.
- **Overwrite:** strictly idempotent — regenerating **replaces** prior rows for the
  period, **including Alice's** manual tweaks. Scope per feature: Feature A replaces
  preferences + period_targets (all users); Feature B replaces drafts (per house).
  After generation, tweaks come **only** from the user (manual builder edits); a re-run
  wipes and regenerates deterministically. LIMIT: this only holds **pre-publish** — a
  published house has a `period_house_publications` row, `publish_schedule` RAISES on
  republish, and there is no unpublish, so after Feature C runs, re-generated drafts
  for that house can never go live in this period.
- **Buttons (three total on `/admin/operations`):**
  1. **Simulate worker preferences** — generate + write realistic prefs/targets for all
     SW+SM of all open houses.
  2. **Auto-build balanced schedule** — write coverage-first, shift-length-balanced
     **drafts** for all open houses (does NOT publish; user reviews house by house).
  3. **Publish open houses** — make the current drafts live for all open houses (run
     after the user has reviewed and optionally tweaked shifts in the builder).
- **Safety:** both write RPCs are `SECURITY DEFINER` and granted to **service_role
  ONLY** (`REVOKE ... FROM PUBLIC`, no `authenticated` grant). IMPORTANT: the web
  actions call RPCs through `createServiceClient()` (the established pattern in
  `operatingSeasons.ts`), and under the service-role key `auth.uid()` is **NULL** — a
  `user_is_admin(auth.uid())` check inside the RPC would unconditionally fail and brick
  the feature. Instead each RPC takes an explicit `p_actor_user_id` and re-verifies
  `user_is_admin(p_actor_user_id)` as defense-in-depth; the real gate is the server
  action's `requireAdmin()`, which resolves the session user and passes `gate.userId`.
  This still heeds the confused-deputy audit: what it flagged on `apply_compiled_season`
  / `set_preference_deadline` was caller-supplied uuid **combined with a grant to
  `authenticated`** — the service-role-only grant is what closes the privesc. Consider
  gating to non-production environments.
- **Determinism:** both generators are pure `packages/core` functions with a seeded PRNG
  keyed off `(periodId, userId)` / `(periodId, houseId)` so runs are reproducible + unit
  testable. No clock, no Supabase imports in core.
- **Proposed labels** (final wording TBD): "Simulate worker preferences",
  "Auto-build balanced schedule", "Publish open houses".

The AI-scheduling-agent build prompt (separate future feature, preference-respecting) is
preserved at `docs/dev-tooling/AI_SCHEDULE_AGENT_PROMPT.md`.

---

## Feature A — Simulate worker preferences

### A1. Pure core `packages/core/src/preference-generation/`
- [ ] `types.ts`: `PrefGenBlock { blockId, weekday (0=Mon..6=Sun), minuteOfDay }`
      (matches `blockWeekSlot`), `PrefGenConfig { seed, capHours, ... }`,
      `GeneratedWorkerPrefs { userId, targetHours, optedOut,
      entries: { blockId, status: 'preferred'|'cannot' }[] }`. Emit ONLY
      `preferred`/`cannot` rows: the painter persists only those two, and both read
      sides (`buildInitialGrid`, `AiRosterWorker.prefs`) collapse `available`/`none`
      to the sparse default — explicit `available` rows are dead weight.
- [ ] Seeded PRNG helper (e.g. mulberry32) keyed `(periodId, userId)`; deterministic.
- [ ] `desirability(weekday, minuteOfDay): number` in `[0,1]`:
  - [ ] Time-of-day curve: pre-10am low; weekday 10a–5p low (class); 5–9pm medium;
        9pm–1am high.
  - [ ] Weekday multiplier: Fri/Sat late-night peak; Sun–Thu nights moderate; weekday
        mornings lowest (the "Monday 8am" case).
- [ ] Per-worker persona bias (night-owl / hours-maximizer / picky / morning-ok) so the
      per-block aggregate keeps a good mix (some `preferred` even on low-desirability
      blocks; mostly `preferred` on Sat-night blocks).
- [ ] `targetHours` sampler: cluster around ~75–90% of `config.capHours`, hard-clamped
      to `capHours`; ~5–10% `optedOut=true`. `capHours` = the period profile's
      `default_hours_cap` (the season's authored cap, resolved by the action). The
      `period_targets_enforce_hours_cap` trigger REJECTS any target above that cap, so
      a hardcoded 15–18h range would abort the entire seed on a low-cap season.
- [ ] `generateWorkerPreferences(blocks, roster, periodId, config): GeneratedWorkerPrefs[]`
      — called once per open house with that house's blocks + roster; sparse output
      (absence of a row = available).
- [ ] Export from `packages/core/src/preference-generation/index.ts` and re-export from
      the core package entrypoint.

### A2. DB write RPC — new migration `supabase/migrations/<ts>_admin_seed_preferences.sql`
- [ ] `admin_seed_preferences(p_actor_user_id uuid, p_period_id uuid, p_rows jsonb)
      RETURNS jsonb`.
- [ ] `SECURITY DEFINER`; `REVOKE ... FROM public`; `GRANT EXECUTE ... TO service_role`.
- [ ] Re-verify `user_is_admin(p_actor_user_id)` inside (NOT `auth.uid()` — NULL under
      the service client, see Safety); raise `not_authorized` otherwise.
- [ ] Atomic reopen/restore: lock the period row (`SELECT ... FOR UPDATE`), read
      `preference_deadline` → set `NULL` → replace rows → restore deadline. (Trigger
      `enforce_preference_deadline` is NOT service-role-bypassed and fires on
      INSERT/UPDATE **and DELETE**, so the delete below must also happen inside the
      reopened window. NULL deadline = open, per `preference_deadline_is_open`.)
- [ ] Idempotent replace: delete ALL of the period's `preferences` + `period_targets`
      rows (every user, not just the incoming roster — the locked decision wipes manual
      tweaks and departed users' stale rows too), then bulk insert (PKs are
      `(user_id, block_id, period_id)` / `(user_id, period_id)`). Feature A does NOT
      touch drafts; Feature B owns draft replacement.
- [ ] Regenerate types: `supabase gen types typescript --local > packages/shared/src/database.types.ts`.

### A3. Web server action — `apps/web/lib/actions/devSeeding.ts` (`'use server'`)
- [ ] `requireAdmin()` guard (copy pattern from `lib/actions/operatingSeasons.ts`).
- [ ] `simulateWorkerPreferences(seasonId): ActionResult<{ houses, workers, prefsWritten }>`.
- [ ] Resolve season → `period_id` (== `seasonId`) + open houses (from season windows /
      blocks present).
- [ ] Enumerate SW+SM per open house (`users.eq(home_house_id).in(user_roles)` pattern
      from `lib/data/people.ts`), via `createServiceClient()`.
- [ ] Resolve `capHours` from the period profile (`scheduling_periods.profile_name` →
      `operating_profiles.default_hours_cap`); pass it in `PrefGenConfig`.
- [ ] Per open house: load that house's blocks in the period's START week (the Mon..Sun
      of `start_date`, `voided_at IS NULL`) — the exact window the worker paint page
      shows (`lib/data/worker/preferences.ts`); prefs on any other week are invisible to
      the painter. Map to `PrefGenBlock` via `blockWeekSlot`. CAVEAT: a house whose
      season window opens after the first week has no blocks in that window (the paint
      page shares this limitation) — report and skip it, don't fail the run.
- [ ] Call `generateWorkerPreferences` per house; flatten to `p_rows`; ONE
      `admin_seed_preferences` call with `p_actor_user_id: gate.userId` (the wipe is
      period-wide, so per-house RPC calls would delete earlier houses' output).
- [ ] `revalidatePath('/admin/operations')`; return counts.

### A4. UI
- [ ] `'use client'` button component (busy state + result/error toast), rendered only
      when `isAdmin(user)`, in a "Dev seeding" card on `/admin/operations`.

### A5. Tests
- [ ] Vitest (core): determinism from seed; Sat-night preferred-rate >> Mon-morning;
      every block has >=1 `preferred` across the roster (SM always has options);
      opt-out ~5–10%; targets within range and never above `capHours`; only
      `preferred`/`cannot` statuses emitted.
- [ ] pgTAP: `admin_seed_preferences` admin gating, deadline reopen/restore atomicity,
      idempotent replace, upsert semantics.

---

## Feature B — Auto-build balanced schedule (drafts)

Coverage-first and shift-length-balanced. **Ignores preferences** by design (contrast the
AI agent, which respects them).

### B1. Pure core `packages/core/src/schedule-generation/`
- [ ] `types.ts`: `SchedBlock { blockId, weekday, minuteOfDay, laneCount }`,
      `SchedConfig { seed, weeklyCapHours, shiftLengthWeights }` (`weeklyCapHours` =
      the season's authored cap, resolved by the action — do NOT hardcode 20),
      `DraftAssignment { periodId, blockId, userId }`.
- [ ] Seeded PRNG keyed `(periodId, houseId)`.
- [ ] `generateBalancedSchedule(blocks, roster, periodId, isHarnwell, config): DraftAssignment[]`:
  - [ ] Per NY-day, walk the block timeline; fill `laneCount` parallel lanes per block
        (headcount varies intraday for summer bands — handle per-block). `laneCount`
        is NOT the template block's own `required_headcount`: it is the MINIMUM
        `required_headcount` across ALL of the period's blocks sharing that
        (weekday, time-of-day) slot, computed by the action. Reason: publish stamps
        the template week's (isodow, tod) pattern across every week and RAISES
        `check_violation` (aborting the whole house) on any block where pattern users
        exceed that block's headcount — a later-phase downsize would make an
        unconstrained template unpublishable. Seats above the minimum stay vacant
        (still claimable after publish) and are counted as unfilled.
  - [ ] Contiguous shifts of length drawn from `{4,6,8,10}` blocks (2/3/4/5h), weighted
        toward 3–4h; snap to band edges; avoid 1h (2-block) remainders; emit 1h only as
        last resort (awkward band tails may force several — acceptable).
  - [ ] Respect per-worker weekly cap; no double-book; spread hours across roster.
  - [ ] Roster = active SWs with `home_house_id = house` ONLY (mirror
        `getBuilderData`'s `role = 'sw'` roster). SMs must NOT be drafted: the builder
        review UI cannot render a non-roster user's draft, and the review step is the
        point of this feature.
  - [ ] Harnwell: only `home_house = harnwell` workers (mirror training invariant;
        the `draft_block_assignments_enforce_harnwell_training` trigger backstops it).
  - [ ] Template week only (publish stamps across weeks). The template week is the
        HOUSE's earliest non-voided block week — the same anchor `getBuilderData` uses
        for the review UI and `publish_schedule` uses for its pattern window — NOT the
        period's start week (a house window may open mid-season).
  - [ ] Report unfilled seats (surfaced, never fabricated).
- [ ] Export from package entrypoint.

### B2. DB write RPC — new migration `supabase/migrations/<ts>_admin_seed_draft_schedule.sql`
- [ ] `admin_seed_draft_schedule(p_actor_user_id uuid, p_period_id uuid, p_house_id text,
      p_rows jsonb) RETURNS jsonb`. The actor uuid also fills
      `draft_block_assignments.created_by` (NOT NULL — a service-client call has no
      `auth.uid()` to fall back on).
- [ ] `SECURITY DEFINER`; service_role-only; re-verify `user_is_admin(p_actor_user_id)`
      (NOT `auth.uid()` — NULL under the service client).
- [ ] Idempotent replace: delete the house's existing `draft_block_assignments` for the
      period, then bulk insert (respecting `(period_id, block_id, user_id)` unique key +
      headcount + Harnwell training triggers).
- [ ] Regenerate types.

### B3. Web server action — add to `apps/web/lib/actions/devSeeding.ts`
- [ ] `autoBuildBalancedSchedule(seasonId): ActionResult<{ perHouse: { houseId,
      assigned, unfilled }[] }>`.
- [ ] `requireAdmin()`; service client. Resolve `weeklyCapHours` from the period
      profile's `default_hours_cap`. Per open house: load ALL of the period's blocks
      for the house (`voided_at IS NULL`) to (a) anchor the house's template week
      (earliest block's Mon..Sun) and (b) compute the per-(weekday, tod) MINIMUM
      headcount → `laneCount` (see B1); load the SW roster →
      `generateBalancedSchedule` → `admin_seed_draft_schedule` (pass `gate.userId`).
      Aggregate per-house counts + unfilled seats.
- [ ] `revalidatePath('/admin/operations')`.

### B4. UI
- [ ] Admin-only button in the "Dev seeding" card; per-house result summary (assigned /
      unfilled). No publish here — user reviews drafts house by house in the builder.

### B5. Tests
- [ ] Vitest (core): shift-length histogram (few 1h, good 2–5h spread); every lane
      seat filled when roster capacity allows (and never more than `laneCount` per
      block); weekly cap respected; no double-book; Harnwell exclusion; determinism.
- [ ] pgTAP: admin gating, idempotent replace, headcount/Harnwell trigger compliance.

---

## Feature C — Publish open houses

### C0. Prerequisite migration — publish must skip voided blocks
- [ ] Pre-existing bug this feature newly exercises: `publish_schedule`
      (20260614000002) iterates every block of the house in the period with NO
      `voided_at IS NULL` guard. On a voided block (season re-apply closed the house
      window or downsized it: vacant seats deleted, occupants cancelled), its
      excess-insert branch (step 2) INSERTs `scheduled` rows and its normalize branch
      (step 3) re-inserts `vacant`/`never_assigned` seats — resurrecting voided blocks
      and breaking the "voided blocks are self-excluding on every read path"
      invariant. Also the closing "all houses published" aggregation counts
      fully-voided houses, so `scheduling_periods.published_at` can never flip after a
      mid-season house close. Fix in a small migration: add `voided_at IS NULL` to the
      block loop AND to the `period_houses` aggregation. pgTAP: publishing after a
      re-apply that voided blocks writes nothing into them.

### C1. Web server action — add to `apps/web/lib/actions/devSeeding.ts`
- [ ] `publishOpenHouses(seasonId): ActionResult<{ perHouse: { houseId, published }[] }>`.
- [ ] `requireAdmin()`; service client. Resolve season → `period_id` (== `seasonId`) +
      open houses; loop `publish_schedule(p_period_id, gate.userId, houseId)`
      (recurring-weekly-pattern 3-arg; verified: the admin role passes its internal
      `user_can_build_schedule` check via `user_is_schedule_admin`, and the function is
      already service_role-only with an explicit actor param).
- [ ] Skip already-published houses by pre-checking `period_house_publications`
      (publish RAISES `unique_violation` on republish — do not parse error text). There
      is no unpublish; surface "already published, skipped" per house.
- [ ] Call each house's RPC independently and catch per-house errors without aborting
      the loop (e.g. a template/headcount mismatch aborts only that house), reporting
      published / skipped / failed per house.
- [ ] `revalidatePath('/admin/operations')`.

### C2. UI
- [ ] Admin-only "Publish open houses" button (confirm dialog — this makes schedules
      LIVE). Per-house published/skipped summary.
- [ ] Note: the existing per-house publish on the builder remains available for granular
      control after manual tweaks.

---

## Cross-cutting / done-when

- [ ] All three buttons live in one admin-only "Dev seeding" card on `/admin/operations`,
      scoped to the selected summer season.
- [ ] `pnpm test:quick` (core Vitest) green for both new pure modules.
- [ ] pgTAP green for both new RPCs.
- [ ] `tsc` + web build clean; no em/en dashes in any user-facing button/toast copy.
- [ ] Manual smoke: Simulate → log in as Alice, see populated preferences; Auto-build →
      review a house's drafts in the builder; Publish → schedule goes live.
      Preconditions: (a) to view prefs as a WORKER, the season's preference deadline
      must be authored first — `scheduling_periods` RLS hides periods with NULL
      deadline and NULL `published_at`; (b) the builder (`getBuilderData`) anchors its
      week on the house's EARLIEST block across all periods, so the review step needs
      a DB without older (e.g. school-year) blocks for that house — use the
      `db:reset:seasons` environment.
- [ ] Commit as separate features (A, then B, then C) per repo commit conventions.

## Suggested build order

1. Feature A core + tests → RPC → action → button. (Prereq for testing the AI agent.)
2. Feature B core + tests → RPC → action → button.
3. Feature C: C0 publish voided-block fix (migration + pgTAP) → action → button.
