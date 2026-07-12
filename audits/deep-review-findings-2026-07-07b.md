# Deep Correctness Review — Second Pass Findings

**Date:** 2026-07-07 (afternoon pass)
**Branch:** `feat/ui-float-polish`
**Reviewer:** Claude (Fable 5), principal-engineer correctness/robustness pass
**Relationship to prior report:** supplements `audits/adversarial-review-findings-2026-07-07.md`. Nothing below restates a known finding; every item was hand-verified against the latest (`CREATE OR REPLACE`-winning) definition of each function.

## Method & coverage caveats

Seven parallel investigation agents (float state machine, hours/headcount math, time/DST/sim-clock, migration archaeology, invariant enforcement, mobile drift, notification pipeline) **all hit the account session limit before writing reports** — the identical failure mode as the prior pass, and this time their transcripts contained no recoverable notes (reads only). Everything below was therefore verified by hand in the main session, which means coverage is **deep on the float-lifecycle × operating-seasons interaction seam** (where the prior pass's known findings pointed) and **thinner elsewhere**. Explicitly under-covered and still warranting a fresh pass once the session limit resets (~2:20pm): the full DST/date-boundary sweep (dimension 7), migration idempotency archaeology beyond the spot-checks below (dimension 8), and the mobile silent-failure sweep (dimension 4/6) beyond the spot-checks below.

The central discovery of this pass: **the operating-seasons void machinery (2026-07-02) never propagated into the float-release helpers (2026-06-23) or the publish path (2026-06-14)**. The seasons design note claims voided blocks are "self-excluding on every status-filtered read path" because voiding deletes vacant seats and flips occupied seats to `cancelled_config` — but three write paths re-create live-status rows on voided blocks or strand rows the void logic never touches. There is **no write-guard trigger on voided blocks** (verified: `20260702000005` adds only the column, comment, and index), so nothing backstops these.

---

## HIGH

### F1. `apply_compiled_season` voids destination-side floats without source-side reconciliation → floater's home rows orphaned as `pending_float_out` forever

**Location:** `supabase/migrations/20260702000006_apply_compiled_season.sql:302-322`

**What the code does:** when a block is voided, in-flight floats are matched **by destination only** and status-flipped with no source cleanup:

```sql
voided AS (
  UPDATE float_assignments f
  SET status = 'voided'
  FROM blk_assignments b
  WHERE f.status IN ('pending', 'acknowledged')
    AND f.destination_assignment_ids && b.ids
  RETURNING f.user_id
),
```

Contrast the two sanctioned void paths, which both finish with source reconciliation: `decline_float` (`20260623000002:509`) and `process_no_ack_float` (`20260624000001:214`) end in `PERFORM reconcile_float_source_release(p_float_id);`. The season path does not.

**Why nothing recovers it:** the floater's home rows are `pending_float_out` (for an acknowledged float, `floated_out`) at the **source** house, which is not being voided, so the block-local updates in the loop never touch them (`v_occupied` at `:118` is `ARRAY['scheduled','claimed','floated_in','pending_float_in']` — `pending_float_out`/`floated_out` are deliberately not "occupied"). Every other transition out of `pending_float_out` is keyed on the float still being `status = 'pending'` (`acknowledge_float`/`decline_float` in `20260528000014`, `process_no_ack_float` in `20260624000001`), and the float is now `'voided'`, so all of them no-op with `not_pending`. `expires_for_cleanup_at` has **no consumer anywhere** (verified: only the column definition, index, and INSERT writers reference it), so there is no janitor either. The rows are stranded permanently, along with the still-claimable `vacant`/`temporary_drop` gap row `reopen_float_source_seats` created at the source desk.

**Violates:** float state-machine integrity (an orphaned, unrecoverable state — exactly review dimension 3); BSpec §6.6 #5/#7 (a released float must either restore the floater home or displace them via the claimed-seat rule — this path does neither).

**Failure scenario:** Worker W is scheduled at Du Bois 18:00–22:00. The orchestrator floats W to Harrison (float `pending`; W's Du Bois rows → `pending_float_out`; a claimable gap row opens at Du Bois). The admin then applies a season revision that closes Harrison for that window. The float flips to `voided` and W is notified the float is cancelled — but W's Du Bois rows stay `pending_float_out` forever. W's calendar shows a ghost "floating out" shift indefinitely; the Du Bois seat remains a claimable opening; if another SW claims it, W has silently and permanently lost 4 hours with no displacement record and no notification. `pending_float_out` is in no present-set, so those seats also read as non-present to escalation/pickup-lock logic for the rest of time.

**Severity: HIGH (silent permanent loss of a worker's hours; unrecoverable state). Confidence: high — every candidate recovery path was enumerated and each is status-gated on `'pending'`.**

**Root cause:** the season void path was written against the destination side only and never adopted the shared release helper the 06-23 refactor created precisely so "the automated and force-trigger paths can never diverge again."

**Fix** (in `apply_compiled_season`, void branch; must land together with F2's guard):

```sql
-- replace RETURNING f.user_id with:
    RETURNING f.float_id, f.user_id
),
...
SELECT count(*), array_agg(float_id) INTO v_seat_gap, v_voided_float_ids FROM voided;
c_floats_voided := c_floats_voided + v_seat_gap;

-- after the block-local seat updates, release each voided float's source side:
IF v_voided_float_ids IS NOT NULL THEN
  FOREACH v_fid IN ARRAY v_voided_float_ids LOOP
    PERFORM reconcile_float_source_release(v_fid);
  END LOOP;
END IF;
```

(declare `v_voided_float_ids uuid[]; v_fid uuid;`). `reconcile_float_source_release` already implements the restore-vs-displace decision and only touches source rows + gap rows, so it cannot conflict with the block-local destination updates. For **acknowledged** floats the source rows are `floated_out`, so F2's fix must widen the helper's guard to `status IN ('pending_float_out','floated_out')`.

**Blast radius:** the dry-run preview shares this code path (identical by design), so preview impact counts change too; pgTAP season-apply suite; the impact-list JSON (unchanged shape).

**Verification:** pgTAP — create a pending float S→D, `apply_compiled_season` a payload closing D, assert (a) float `voided`, (b) source rows back to `scheduled` with `parent_float_id NULL`, (c) the gap row deleted; repeat with the gap row pre-claimed and assert displacement (`displaced_decliner`); repeat with an `acknowledged` float.

---

### F2. `reconcile_float_source_release` restores source rows with **no status guard and no voided-block guard** → resurrects live `scheduled` rows on voided (closed-house) blocks

**Location:** `supabase/migrations/20260623000002_float_source_seat_reopen.sql:124-140`

**What the code does:** both branches overwrite the source rows unconditionally by id:

```sql
IF v_gap_rows_total = 0 OR v_gap_rows_still_vacant = v_gap_rows_total THEN
    UPDATE shift_block_assignments
    SET user_id = v_float.user_id, status = 'scheduled', vacancy_origin = 'none',
        is_float = false, source_house_id = NULL, parent_float_id = NULL
    WHERE assignment_id = ANY(v_float.source_assignment_ids);
```

No `AND status = 'pending_float_out'`, and no check that the source block is still live.

**Violates:** operating-seasons invariant (3) in AGENTS.md ("voided blocks self-excluding on every status-filtered read path" — a resurrected `'scheduled'` row defeats status filtering, and the worker read models have no `voided_at` guard: `worker_my_shifts`' latest definition is `20260611000001:162`, `worker_open_shifts`' is `20260627000001:246`, and `voided_at` appears **only** in migrations `20260702000004-7`); hard-invariant-adjacent (a worker staffed at a closed desk); weekly-hours correctness (the resurrected `scheduled` rows are counted by `claim_open_shift`'s hours query, `20260627000001:200-205`, which joins `shift_blocks` without a `voided_at` filter — inflating the worker's counted hours and wrongly tripping the hard cap on later real claims).

**Failure scenario:** Worker W floats out of Du Bois (pending). Admin applies a season revision closing **Du Bois** (the SOURCE house): the void branch flips only `v_occupied` statuses, so W's `pending_float_out` rows survive untouched on the now-voided blocks, and the float's gap rows there are deleted by the `DELETE ... WHERE status = 'vacant'` (`:329-330`). W then declines the float (or no-acks): `v_gap_rows_total = 0` → restore branch fires → W's rows flip `pending_float_out → scheduled` on voided blocks at a closed house. W's app shows a live shift at a closed house; those blocks count against W's 40h cap; nothing ever cleans them (voided blocks are excluded from the orchestrator scan, so not even escalation notices the desk).

**Severity: HIGH (data corruption: occupied live-status rows on voided blocks, wrong hours). Confidence: high — mechanism verified line-by-line; requires a house closure landing while its workers hold pending/acknowledged floats out, which is exactly the summer-transition case the seasons feature exists for.**

**Root cause:** the release helper predates the void machinery by nine days and was never taught that a source block can die while a float is in flight.

**Fix** (rewrite the two source-row UPDATEs in `reconcile_float_source_release`):

```sql
    -- restore branch: only flip rows still in a float-out state on LIVE blocks
    UPDATE shift_block_assignments a
    SET user_id = v_float.user_id, status = 'scheduled', vacancy_origin = 'none',
        is_float = false, source_house_id = NULL, parent_float_id = NULL
    FROM shift_blocks sb
    WHERE a.assignment_id = ANY(v_float.source_assignment_ids)
      AND a.status IN ('pending_float_out', 'floated_out')
      AND sb.block_id = a.block_id
      AND sb.voided_at IS NULL;

    -- rows whose source block was voided while the float was in flight: cancel, don't resurrect
    UPDATE shift_block_assignments a
    SET status = 'cancelled_config', vacancy_origin = 'none',
        is_float = false, source_house_id = NULL, parent_float_id = NULL
    FROM shift_blocks sb
    WHERE a.assignment_id = ANY(v_float.source_assignment_ids)
      AND a.status IN ('pending_float_out', 'floated_out')
      AND sb.block_id = a.block_id
      AND sb.voided_at IS NOT NULL;
```

Apply the same `status IN (...)` + voided guards to the displacement branch (`:136-139`). The `status IN` guard also hardens this helper against the same swap-accept ownership race the prior report flagged on the assignment side (H2): a row a swap moved to another owner is no longer blindly overwritten at release time.

**Blast radius:** `decline_float`, `process_no_ack_float`, and (after F1) `apply_compiled_season` all route through this helper — one fix covers all three; pgTAP float-decline/no-ack suites.

**Verification:** pgTAP — pending float out of house S; void S's blocks via season apply; decline the float; assert source rows are `cancelled_config`, NOT `scheduled`, and the worker's `claim_hours_projection` excludes them.

---

### F3. `publish_schedule` has no `voided_at` guard → publishing after a season apply resurrects seats on voided blocks (workers scheduled at closed houses, phantom open shifts)

**Location:** `supabase/migrations/20260614000002_publish_recurring_weekly_pattern.sql:71-78` (block loop), `:135-151` (scheduled-row INSERT), `:166-170` (vacant-row INSERT). Verified this is the winning definition (later migrations do not redefine `publish_schedule`).

**What the code does:** the per-block loop selects every block of the house in the period:

```sql
FOR v_block IN
    SELECT b.block_id, b.required_headcount, ...
    FROM shift_blocks b
    WHERE b.house_id = p_house_id
      AND (b.block_start_at AT TIME ZONE 'America/New_York')::date
          BETWEEN v_period.start_date AND v_period.end_date
```

— no `voided_at IS NULL`. For a voided block, all vacant seats were deleted by the void, so `v_vac_count = 0` → `v_matched = 0` → **branch 2 INSERTs fresh `'scheduled'` rows** for every template user (`enforce_block_occupied_headcount` passes: occupied rises from 0 to ≤ `required_headcount`), and **branch 3 re-INSERTs `'vacant','never_assigned'` rows** for the remainder — undoing exactly the deletion that makes voided blocks self-excluding.

**Violates:** operating-seasons invariant (3) (same as F2); BSpec §4.3 publish semantics (publish must staff the operating schedule, and a voided block is by definition outside it).

**Failure scenario:** admin authors the summer season with Harrison open in phase 1 and closed in phase 2, applies it (phase-2 Harrison blocks — pre-generated under the earlier config — get voided). The SM then builds the summer template week and publishes. Publish stamps the weekly pattern across the whole period: phase-2 voided blocks receive live `scheduled` rows (workers see shifts at a closed house in `worker_my_shifts`, and those rows count toward their weekly-cap hours) plus resurrected `vacant` rows (they surface in `worker_open_shifts`, which has no `voided_at` guard; `is_assignment_claimable` *does* guard `voided_at` per `20260702000007:36`, so claims fail — the feed advertises openings that error on claim).

**Severity: HIGH (workers scheduled at closed houses; hours corruption; phantom feed rows). Confidence: high on mechanism (traced through both INSERT branches and the headcount trigger); medium-high on frequency — it requires apply-before-publish ordering, which is the documented summer workflow (admin authors seasons, then the SM builds from preferences and publishes).**

**Root cause:** `publish_schedule` (06-14) predates `voided_at` (07-02), and the 07-02 defense-in-depth sweep (`20260702000007`) guarded only read paths (`is_assignment_claimable`, the two house-grid views) plus the orchestrator scan — no write path.

**Fix:**

```sql
    WHERE b.house_id = p_house_id
      AND b.voided_at IS NULL
      AND (b.block_start_at AT TIME ZONE 'America/New_York')::date
          BETWEEN v_period.start_date AND v_period.end_date
```

**Systemic fix (recommended, closes F1/F2/F3 as a class):** a write-guard trigger so no future path can regress this again —

```sql
CREATE OR REPLACE FUNCTION reject_live_writes_on_voided_blocks()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'cancelled_config'
     AND EXISTS (SELECT 1 FROM shift_blocks sb
                 WHERE sb.block_id = NEW.block_id AND sb.voided_at IS NOT NULL) THEN
    RAISE EXCEPTION 'block % is voided; only cancelled_config writes allowed', NEW.block_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER shift_block_assignments_voided_guard
  BEFORE INSERT OR UPDATE OF status, user_id ON shift_block_assignments
  FOR EACH ROW EXECUTE FUNCTION reject_live_writes_on_voided_blocks();
```

This is safe with existing flows: the void path writes `cancelled_config` (allowed) and deletes vacants (DELETE untouched); the un-void path clears `voided_at` **before** inserting seats (`20260702000006:339` runs first); decline/no-ack destination reopens can't hit a voided block because the season apply voids those floats first.

**Blast radius:** publish pgTAP suite; season-apply e2e; any test seeding rows onto voided blocks directly.

**Verification:** pgTAP — void one future block of a house, publish the period, assert zero assignment rows exist for the voided block and `v_scheduled_count` excludes it.

---

## MEDIUM

### F4. `reopen_float_source_seats` counts "present" with a fourth, inconsistent status set — omits `pending_float_in` (and `allied`)

**Location:** `supabase/migrations/20260623000002_float_source_seat_reopen.sql:63-69`

```sql
    SELECT count(*)::integer INTO v_remaining
    FROM shift_block_assignments
    WHERE block_id = v_src_block_id
      AND status IN ('scheduled', 'claimed', 'floated_in');
```

The repo already maintains two deliberately distinct present-sets (AGENTS Coverage-lock note): escalation `{scheduled, claimed, floated_in, pending_float_in, allied}` and pickup-lock `{scheduled, claimed, floated_in, pending_float_in}` (`block_has_present_worker`, `20260627000001:57`). This helper introduces a third that drops `pending_float_in` from both.

**Failure scenario:** a multi-staff source desk has an inbound pending floater (e.g. force-triggered) among its present workers. Another worker floats out; `v_remaining` undercounts (the `pending_float_in` seat is invisible), the `v_remaining < v_required` test passes when the desk is actually at headcount, and a **spurious extra `vacant` gap row is inserted beyond the block's seat count**. The phantom opening surfaces in `worker_open_shifts`; a claim attempt then trips `enforce_block_occupied_headcount` and fails opaquely — or, on a grandfathered block, actually over-staffs it.

**Severity: MEDIUM (phantom seat rows, over-headcount edge; needs a desk that is simultaneously float-source and float-destination, so force-trigger or multi-tick sequences). Confidence: high on the code, medium on real-world frequency.**

**Root cause:** a fourth ad-hoc present-set instead of reusing `block_has_present_worker`.

**Fix:**

```sql
      AND status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in');
```

(Deliberately still excluding `allied`, matching the pickup-lock set: an Allied-covered seat must not suppress reopening the human seat.) Better: `SELECT ... WHERE block_has_present_worker(v_src_block_id) ...` is not directly usable (it's boolean, not a count), so at minimum add a comment pinning this set to the pickup-lock set.

**Blast radius:** both float paths (automated + force-trigger) call this helper.

**Verification:** pgTAP — source block with one `scheduled` + one `pending_float_in` row, `required_headcount = 2`; float the scheduled worker out; assert **no** gap row is inserted (present count 1 + the pending-in seat = at headcount... assert per chosen semantics: count = 1 < 2 with the fix counting pending_float_in gives 1+1=2, no insert).

### F5. Season headcount-decrease trim deletes vacant seats indiscriminately — including a live pending float's source-gap row

**Location:** `supabase/migrations/20260702000006_apply_compiled_season.sql:368-381`

```sql
          v_vacant_removable := GREATEST(0,
            (SELECT count(*) FROM shift_block_assignments
             WHERE block_id = v_blk.block_id AND status = 'vacant')
          );
          ...
            DELETE FROM shift_block_assignments
            WHERE ctid IN (
              SELECT ctid FROM shift_block_assignments
              WHERE block_id = v_blk.block_id AND status = 'vacant'
              LIMIT v_seat_gap
            );
```

The comment says "Trim excess VACANT **never-assigned** seats," but the DELETE matches any `vacant` row — `temporary_drop` rows with a `parent_float_id` (a pending float's reopened source seat) and drop-origin rows included, in arbitrary `ctid` order.

**Failure scenario:** house S's headcount drops 3→2 mid-summer while worker W has a pending float out of S (their seat is the `temporary_drop` gap row). The trim deletes the gap row instead of a `never_assigned` one. `reconcile_float_source_release` later sees `v_gap_rows_total = 0` and takes the "nothing was claimed" restore branch even if the desk state has moved on; the seat W could have been displaced from no longer exists, and the float's book-keeping (gap rows ↔ source rows) is silently broken. Bounded harm, but it corrupts the restore-vs-displace decision input.

**Severity: MEDIUM-LOW. Confidence: high on code, medium on impact.**

**Root cause:** DELETE predicate is broader than the documented intent and unordered.

**Fix:**

```sql
              SELECT ctid FROM shift_block_assignments
              WHERE block_id = v_blk.block_id AND status = 'vacant'
              ORDER BY (vacancy_origin = 'never_assigned') DESC,
                       (parent_float_id IS NULL) DESC
              LIMIT v_seat_gap
```

and compute `v_vacant_removable` from `vacancy_origin = 'never_assigned'` rows only if float-linked gap rows should be exempt from trimming entirely (recommended).

**Verification:** pgTAP — block with 1 `never_assigned` + 1 float-linked `temporary_drop` vacant row; decrease headcount by 1; assert the `never_assigned` row died and the gap row survived.

---

## LOW

### F6. Swap expiry never routed through `app_now()`, and the cron bypasses the extracted helper

**Location:** `supabase/migrations/20260530000001_phase_09_swaps.sql:578`

```sql
      $$UPDATE swap_requests SET status='expired' WHERE status='pending' AND expires_at <= now()$$
```

`expire_pending_swaps(p_now)` exists (`:145-157`) precisely to make expiry testable, but the cron inlines its own copy pinned to real `now()`. Same class as the known dispatch-push sim-clock finding, plus a diverged-single-source-of-truth instance (review dimension 10): if expiry ever gains side effects (notify counterparty, release reservations), the cron path silently won't do them. Under sim-clock forward travel, swap expiry cannot be exercised at all — the exact manual-test loop the harness exists for.

**Fix:** `$$SELECT expire_pending_swaps(app_now())$$`. **Verification:** time-travel forward past a pending swap's `expires_at`, run the cron body, assert `expired`.

### F7. `float_assignments.expires_for_cleanup_at` is dead machinery

`NOT NULL` + index (`20260528000001:16,44`) and computed on every INSERT path, but nothing anywhere reads it — no cleanup job exists. Harmless today, but it reads as if retention is implemented ("expires_for_cleanup") when it is not, and F1's orphans specifically have no janitor behind them. Either implement the cleanup cron or comment the column as reserved. **Confidence: high** (repo-wide grep: only the column, index, and INSERT writers).

### F8. `publish_schedule` stamps `published_at` with `now()` not `app_now()`

`20260614000002:196`. Cosmetic inconsistency with the sim-clock convention; only affects time-travel test realism of the period-published flag. One-word fix.

---

## Verified clean (checked this pass, no issue)

- **Ack-reminder suppression covers all dead-float states:** `pending_notification_deliveries` (`20260601000001`) suppresses `float_ack_reminder` rows unless the float is still `status='pending'` with no ack/decline — so acknowledged, declined, no-ack-voided **and season-voided** floats all suppress cleanly. No ghost reminders.
- **The 06-24 redefinition of `process_no_ack_float` retained the 06-23 fix:** `20260624000001:214` still calls `reconcile_float_source_release` (the "later migration silently reverts an earlier fix" class does NOT bite here; explicitly checked because the two migrations are one day apart and redefine the same function).
- **Both float paths still call `snapshot_float_ack_reminders`** in their winning definitions (`20260623000002:242,412`) — the single-helper contract holds.
- **Weekly-cap hours counting is consistent across paths:** `claim_open_shift` (`20260627000001:204`), break claim (`20260615000001:151-154` hard-cap check present, plus the advisory `claim_hours_projection` in the EF), and permanent-pickup's EF snapshot (`WORKED_STATUSES = ['scheduled','claimed','floated_in','pending_float_in']`, `permanent-pickup/index.ts:4`) all use the same status set; **no double-count of a pending float** (source `pending_float_out` excluded, destination `pending_float_in` counted — relocation represented exactly once).
- **Week-boundary math agrees across layers:** DB `date_trunc('week', ... AT TIME ZONE 'America/New_York')` (NY ISO Monday) and the permanent-pickup EF's `weekStartDate` (NY-local date → Monday via `(getUTCDay()+6)%7` on a noon-anchored date) produce the same bucket, including for late-Sunday-NY blocks.
- **Two concurrent publishes serialize:** `publish_schedule` takes `FOR UPDATE` on the period row (`20260614000002:44`) and the per-house publication uniqueness check runs under that lock.
- **Mobile tolerates unknown statuses:** `WorkerShiftsRepository.kt:354` — "Unknown statuses are dropped (`toModel` returns null)", so the server adding `cancelled_config` does not crash or mis-bucket the client (and the status-filtered views never send it).
- **`acknowledge_float` transitions are status-guarded** (`AND status='pending_float_in'` / `'pending_float_out'`), so it cannot resurrect foreign or cancelled rows the way the release helper can.

## Suggested fix order

1. **F2 + F1 together** (one migration: guard the helper, then make the season void call it) — F1 is live data loss on the next summer-season revision.
2. **F3** (+ the systemic voided-block write-guard trigger, which also backstops F1/F2 forever).
3. F4/F5 alongside the next float-algorithm touch.
4. F6–F8 as a hygiene sweep.

| Severity | Count | IDs |
| --- | --- | --- |
| High | 3 | F1, F2, F3 |
| Medium | 2 | F4, F5 |
| Low | 3 | F6, F7, F8 |
