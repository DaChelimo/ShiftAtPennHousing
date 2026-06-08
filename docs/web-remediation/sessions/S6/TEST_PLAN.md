# S6 — HMOD context (audit #8, #9-open-half, #18a) · TEST_PLAN

Lead deliverable for the TDD-firewall run (see [PLAN.md](../../PLAN.md) §"How to run a
session"). This file is the **behavior contract** + **pinned decisions**. The Test Author turns
each `should …` line into ≥1 named test; the firewalled Implementer codes to the contract + the
allowlist **without reading any test file**.

> **S1's worst bug was an under-specified interface.** This plan therefore pins the _shapes_ of
> every new function and type, the exact Friday-anchor math, the switcher-gating rule, and the
> testid contract — not just behaviors.

---

## 0. Scope — three coupled pieces (do #18a FIRST)

| #               | Piece                                                                                                                                                                                   | Why it's first / coupled                                                                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#18a**        | **Rotor Friday-anchor** — `lib/data/rotor.ts` snaps `week_start_date` to **Monday**; HMOD duty weeks are **Friday-08:00 handoffs** (BSpec §2.5, App. A). Fix the anchor.                | Everything below depends on resolving "who is HMOD now"; the resolver keys off Friday weeks. **A Monday key also currently _violates_ the `hmod_rotor_week_start_friday_check` (isodow=5) constraint → the rotor save is broken today.** |
| **HMOD-now**    | Resolve on-duty HMOD from `hmod_rotor` + clock (reuse `resolve_hmod_on_duty`); flip the hardcoded "Off duty" AppShell pill; wire the bell to a real unread count.                       | Needs correct Friday keys (above) to resolve at all.                                                                                                                                                                                     |
| **Multi-house** | Unlock the switcher to all 13 for HMOD/admin; honor `?house=` on `/calendar` + `/coverage` (gated — only HMOD/admin may leave home house); coverage in HMOD mode aggregates all houses. | "Who may leave home house" = "who is HMOD now" (above).                                                                                                                                                                                  |
| **#8**          | **Ack-reminder indicator** — coverage's floater "Pending ack" tag **hardcodes** the state; join the float ack-reminder rows to show "… · 6h/2h reminder sent".                          | Read-only enrichment of the coverage floater card.                                                                                                                                                                                       |

**Out of scope (flag, do NOT fake):** the closed-house **"Closed"** state (the other half of #9).
It needs a `houses.is_open` / operating-status column that does not exist. Per PLAN, deferred
unless that column is added — it is **not** added here. The switcher type already carries an
optional `closed?` flag (unused); leave it unused. (BSpec §2.5 / brief §5 mention "Closed";
record as a follow-up.)

---

## 1. Source-of-truth facts (verified in-repo — do not re-derive)

1. **`resolve_hmod_on_duty(p_at timestamptz) RETURNS uuid`** already exists
   (`20260528000008_hmod_friday_boundary.sql`). It (a) shifts the moment back 8h so the 08:00
   boundary lands at midnight, (b) snaps to the most-recent **Friday** via
   `d - (((extract(isodow FROM d)::int + 2) % 7))`, (c) looks up `hmod_rotor.week_start_date = `
   that Friday, (d) returns `resolve_hm_for_user(hmod_user_id, p_at)` (walks `hm_leave`). **Reuse
   it — do not add an RPC.**
2. **`hmod_rotor.week_start_date`** has a CHECK `extract(isodow FROM week_start_date) = 5`
   (Friday). The column COMMENT: "the Friday 08:00 of the HMOD duty week (Fri 08:00 inclusive ->
   next Fri 08:00 exclusive)". `weekly_cap_overrides` keeps its **Monday** anchor (hours week,
   unrelated — do not touch).
3. **`notifications`** has **`acknowledged_at`** + **`delivered_at`** — there is **no `read_at`**.
   `mark_notification_read` sets `acknowledged_at` (S3 wired it). **Unread = `acknowledged_at IS
NULL`.**
4. **Ack-reminder rows** are `notifications` with `type = 'ack_reminder'`, `scheduled_for` = the
   absolute instant the reminder fires, `payload = {kind:'float_ack_reminder', float_id,
ack_deadline}` (`snapshot_float_ack_reminders`, `20260601000002`). Cadence: mandatory
   1h/30m/5m before the T-10m ack deadline + configurable 6h/2h (default offsets `-6h`/`-2h`;
   per-house override in `ack_cadence_config`; any reminder already past at assignment is not
   created).
5. **`shift_block_assignments`** carries **`parent_float_id`** (→ `float_assignments.float_id`)
   on float rows. A `pending_float_in` seat's `parent_float_id` is the join key to its
   ack-reminder rows. `lib/data/coverage.ts` does **not** currently select it.
6. **13 houses**: `harnwell`, `quad`, `house-03 … house-13` (seed). `harnwell` is `restricted`.
7. **Auth helpers** (`lib/auth.ts`): `canBuildSchedule` (sm/hm/bm), `isHouseAdmin` (hm/bm),
   `adminHouseId(user)` (first sm/hm/bm scope, else home). `isProjectAdministrator(userId)` is
   async (`lib/data/config`).
8. **`apps/web` has NO Vitest** — only `packages/core` runs in `pnpm test` (turbo). All S6 **pure**
   logic therefore lives in **`packages/core/src/hmod-context/`** and is unit-tested in
   `packages/core/tests/s6-hmod-context/` (mirrors S1/S2/S3). I/O wrappers stay in `apps/web`.

---

## 2. Pinned decisions (the interface, frozen)

### D1 — Friday-anchor math (`fridayAnchor`) · CORRECTNESS-CRITICAL

Pure fn in core: **`fridayAnchor(dateKey: string): string`** — given `YYYY-MM-DD`, returns the
`YYYY-MM-DD` of the **most-recent Friday on or before** it.

- Implementation MUST mirror the existing Monday helper's **UTC date-only** technique (no local
  time, no wall-clock-of-day) so it is **DST-immune by construction**:
  `at = Date.UTC(y,m-1,d); at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 2) % 7))`.
- `(getUTCDay()+2) % 7` is the days-since-Friday delta (Sun=0…Sat=6): Fri→0, Sat→1, Sun→2,
  Mon→3, Tue→4, Wed→5, Thu→6.
- **This equals** `resolve_hmod_on_duty`'s SQL day-snap `(isodow+2)%7` — the two conventions
  agree because they differ only on Sunday (`7` vs `0`) and `(7+2)%7 == (0+2)%7 == 2`.
- **Pinned value table** (the Test Author asserts these exact pairs):

  | input (`dateKey`) | weekday | `fridayAnchor` → | note                                      |
  | ----------------- | ------- | ---------------- | ----------------------------------------- |
  | `2026-06-08`      | Mon     | `2026-06-05`     | (today's duty week)                       |
  | `2026-06-05`      | Fri     | `2026-06-05`     | idempotent on a Friday                    |
  | `2026-06-04`      | Thu     | `2026-05-29`     | back to prior Friday                      |
  | `2026-06-07`      | Sun     | `2026-06-05`     |                                           |
  | `2026-03-08`      | Sun     | `2026-03-06`     | **US spring-forward day — still correct** |
  | `2026-11-01`      | Sun     | `2026-10-30`     | **US fall-back day — still correct**      |

- The fn output is **always a Friday** (isodow 5) — so every rotor key it produces satisfies the
  DB CHECK. `lib/data/rotor.ts` replaces its Monday `weekStart()` with `fridayAnchor` for both the
  displayed weeks AND the saved `week_start_date`.
- **Anti-scope:** S6 fixes ONLY the anchor. The academic-year rotor _truncation_ (BSpec §2.5
  final-week truncation, summer exclusion) is **not** in S6 — leave the period-spanning week loop
  as-is. Flag as follow-up.

### D2 — HMOD-now resolution (I/O wrapper)

`apps/web/lib/data/hmod.ts` (NEW, service client): **`getOnDutyHmodId(now: Date = new Date()):
Promise<string | null>`** — calls the existing `resolve_hmod_on_duty` RPC with `now.toISOString()`
and returns the uuid (or null if no rotor row / unresolved). Pure derivation of pill state is
trivial (`onDutyId === user.userId`) and lives in the layout/AppShell — no separate pure fn.

### D3 — AppShell HMOD pill

- The pill renders for **`canBeHmod`** (any hm/bm) — unchanged gating.
- Its state text is **"On duty"** iff the signed-in user **is** the resolved on-duty HMOD
  (`getOnDutyHmodId(now) === user.userId`), else **"Off duty"** (flips today's hardcoded
  "Off duty").
- Layout passes `hmodOnDuty: boolean` to `AppShell`. testid **`hmod-pill`**; the state word is
  inside it.

### D4 — Notification bell unread count

- `apps/web/lib/data/hmod.ts`: **`getUnreadCount(userId: string, now: Date = new Date()):
Promise<number>`** = count of `notifications` where `recipient_user_id = userId` AND
  `acknowledged_at IS NULL` AND `scheduled_for <= now` (due). (Delivery is async/at-least-once;
  the bell reflects _due + unacknowledged_, not delivery confirmation.)
- Layout passes `unreadCount: number` to `AppShell`. The bell renders a numeric badge
  (testid **`bell-count`**) **only when `> 0`**; the bell button gets testid **`nav-bell`** and
  links to `/inbox`.

### D5 — Cross-house authorization (pure) · the gating rule

Pure fn in core: **`canViewOtherHouses(opts: { isOnDutyHmod: boolean; isProjectAdmin: boolean }):
boolean`** = `isOnDutyHmod || isProjectAdmin`.

- **Rationale (BSpec §2.5 / §7.1 / brief §5):** cross-house authority is the **on-duty HMOD**'s
  duty-week power (campus-wide), plus the system-wide **project administrator**. A regular _off-duty_
  HM/BM is house-scoped (S3 pinned inbound-float visibility as destination-house sm/hm/bm — house
  admin over PEOPLE/coverage is house-scoped, not campus-wide). So an off-duty HM/BM may **not**
  leave their home house.

### D6 — `?house=` resolution (pure) · gated

Two pure resolvers in core (so gating is unit-tested, not buried in pages):

- **`resolveCalendarHouse(opts: { requested: string | null; homeHouse: string; canViewOthers:
boolean; validHouseIds: string[] }): string`** — returns `requested` iff `canViewOthers && requested
&& validHouseIds.includes(requested)`, else `homeHouse`. (Calendar is always **single-house** — no
  "all" calendar.)
- **`resolveCoverageScope(opts: same): { mode: 'all' | 'single'; houseId: string | null }`**:
  - not authorized → `{ mode:'single', houseId: homeHouse }` (ignores `requested`).
  - authorized + `requested` valid (and ≠ the sentinel `'all'`) → `{ mode:'single', houseId: requested }`.
  - authorized + (`requested` absent **or** `requested === 'all'` **or** invalid) →
    `{ mode:'all', houseId: null }` (HMOD default aggregates all houses — brief §6.3).
- Pages call these; a non-authorized user passing `?house=<other>` is **silently pinned** to their
  authorized house (no error page) — the "block" is rendering their own house, asserted by the
  page's house-name element.

### D7 — Coverage aggregate-all (I/O)

`lib/data/coverage.ts`: **`getAllHousesCoverageData(now: Date = new Date()): Promise<CoverageData>`**
— fetch all house ids, `Promise.all(getCoverageData(id, now))`, concat `gaps` (re-sorted by the
existing key) + `permOpenings`; set `houseId='all'`, `houseName='All houses'`. Each gap/opening
already carries its own `houseName`, so `CoverageMonitor` renders multi-house with no component
change. (13× the per-house queries, run in parallel — acceptable for an admin board; note as a
future optimization.)

### D8 — Ack-reminder summary (pure) · #8

Pure fn in core: **`summarizeAckReminders(input: { reminders: AckReminderRow[]; now: Date }):
AckReminderState`**

- `type AckReminderRow = { scheduledForIso: string; ackDeadlineIso: string }`
- `type AckReminderState = { stage: 'awaiting' | 'reminded_6h' | 'reminded_2h' | 'reminded_final';
firedCount: number }`
- **"Sent/fired"** = `new Date(scheduledForIso) <= now` (ISO instant compare — DST-immune).
- `firedCount` = number of reminders fired.
- If `firedCount === 0` → `{ stage:'awaiting', firedCount:0 }`.
- Else take the **latest** fired reminder (max `scheduledForIso ≤ now` = the deepest cadence step
  reached) and bucket by its **lead before the deadline** `lead = (ackDeadline − scheduledFor)`:
  - `lead ≥ 180 min` → `reminded_6h` (the long/6h-default reminder)
  - `90 min ≤ lead < 180 min` → `reminded_2h` (the short/2h-default reminder)
  - `lead < 90 min` → `reminded_final` (a mandatory 1h/30m/5m nudge)
- Thresholds 180/90 cleanly separate the default cadence (−6h/−2h/−1h…); they are robust to
  reasonable per-house offset overrides. **Caveat (documented, accepted):** a pathological custom
  offset could bucket oddly — the indicator is advisory, not authoritative. The brief (§6.3) only
  exemplifies 6h/2h; `reminded_final` is the sensible tail extension.

### D9 — Coverage floater `ack` shape (#8 wiring)

- `CoverageGap.floater` becomes
  `{ name: string; fromHouse: string; ack: { pending: true; reminderLabel: string | null } } | null`.
  (Keeps the existing "pending ack" base — a `pending_float_in` seat is by definition un-acked.)
- `lib/data/coverage.ts`: select `parent_float_id`; batch-query `ack_reminder` notifications for
  the set of float-ids (`type='ack_reminder' AND payload->>'float_id' = ANY(ids)`), group by
  float-id, run each group through `summarizeAckReminders`, and map the stage → `reminderLabel`:
  `awaiting → null`, `reminded_6h → "6h reminder sent"`, `reminded_2h → "2h reminder sent"`,
  `reminded_final → "final reminder sent"`.
- `CoverageMonitor` renders the floater tag as **"Pending ack"** and, when `reminderLabel` is
  non-null, appends **" · {reminderLabel}"** (matches brief §6.3 "pending ack, 2h reminder sent").
  Keep the existing amber `clock` tag styling.

### D10 — #8 test surface (scoping — READ THIS, Test Author)

- The ack-indicator **logic** is covered **exhaustively by Vitest** on `summarizeAckReminders`
  (deterministic, injected `now`). **Do NOT** write a Playwright/e2e case for the coverage floater
  reminder label, and **do NOT** add a pending-float seed fixture for it — a realistic float
  fixture (source/destination/float_assignments + now-relative reminder instants) is brittle and
  out of proportion. The coverage.ts **join wiring** (select `parent_float_id` + the notifications
  query + the stage→label map) is a thin, type-checked, Lead-reviewed mapping — verified by review
  - a manual dev-server spot check, **not** an automated behavioral test. This mirrors S2 ("the
    lookup math is Vitest-covered; don't re-test it") and S3's pure-predicate approach. Record the
    no-e2e-for-#8 scoping in NOTES.

### D11 — Switcher behavior + props

- Layout passes to `AppShell`: `houses` (**all 13** when `canViewOthers`, else just the home
  house), `hmodOnDuty`, and a `canSwitchHouse` (= `canViewOthers`) flag. `AppShell` passes
  `houses` + `locked = !canSwitchHouse` to `HouseSwitcher`.
- `HouseSwitcher` derives the **current** house from `useSearchParams().get('house') ?? homeHouseId`
  (it's a client component — the layout can't see page searchParams).
- **Unlocked:** clicking the button (`house-switcher`) reveals a menu; each house is an item
  `house-option-<id>` (e.g. `house-option-harnwell`); on `/coverage` an extra **All houses** item
  `house-option-all` appears first. Selecting an item `router.push`es the **current pathname** with
  `?house=<id|all>` merged into existing params (preserve `?week=`).
- **Locked:** the button still renders (`house-switcher`) but clicking reveals **no** options
  (`house-option-*` absent). Visual = today's locked chip.

---

## 3. Behavior contract (→ test names)

### A. Friday-anchor (#18a) — Vitest `s6-hmod-context` + Playwright `hmod-context`

- **A1** `fridayAnchor` returns the most-recent Friday for a Monday input (`2026-06-08`→`2026-06-05`).
- **A2** `fridayAnchor` is idempotent when the input is already a Friday (`2026-06-05`→`2026-06-05`).
- **A3** `fridayAnchor` output is always a Friday (isodow 5) for all 7 weekdays of a sample week.
- **A4** `fridayAnchor` is DST-safe across US spring-forward (`2026-03-08`→`2026-03-06`).
- **A5** `fridayAnchor` is DST-safe across US fall-back (`2026-11-01`→`2026-10-30`).
- **A6** `fridayAnchor` matches the full D1 pinned value table (the orchestrator's day-snap).
- **A7** (Playwright) saving the rotor persists a **Friday** `week_start_date` and reloading shows
  the selection intact — i.e. the upsert clears the `isodow=5` CHECK (the Monday key would 400).
- **A8** (Playwright) the rotor grid's week rows are Friday-dated (the week label = a Friday key).

### B. HMOD pill — Playwright `hmod-context`

- **B1** the **on-duty** HMOD sees the `hmod-pill` reading **"On duty"**.
- **B2** an HM/BM who is **not** on duty sees the `hmod-pill` reading **"Off duty"**.

### C. Notification bell — Playwright `hmod-context`

- **C1** a user with ≥1 due, unacknowledged notification sees a visible `bell-count` badge with a
  positive integer; the bell links to `/inbox`.

### D. Cross-house auth + `?house=` — Vitest (pure resolvers) + Playwright

- **D2a** `canViewOtherHouses` is **true** for the on-duty HMOD.
- **D2b** `canViewOtherHouses` is **true** for a project administrator.
- **D2c** `canViewOtherHouses` is **false** for an off-duty HM/BM and for a non-admin.
- **D6a** `resolveCalendarHouse` returns the requested house when authorized + valid.
- **D6b** `resolveCalendarHouse` falls back to home house when **not** authorized (ignores `?house=`).
- **D6c** `resolveCalendarHouse` falls back to home house for an unknown/invalid requested house.
- **D6d** `resolveCalendarHouse` returns home house when no `?house=` is given.
- **D7a** `resolveCoverageScope` → `mode:'all'` for an authorized user with no `?house=`.
- **D7b** `resolveCoverageScope` → `mode:'all'` for authorized + `?house=all`.
- **D7c** `resolveCoverageScope` → `mode:'single'` + the house for authorized + a valid `?house=X`.
- **D7d** `resolveCoverageScope` → `mode:'single'` + **home** house for an unauthorized user passing
  `?house=X` (gated).
- **D11a** (Playwright) the on-duty HMOD's switcher is **unlocked** — clicking it lists multiple
  houses (`house-option-*`).
- **D11b** (Playwright) an off-duty manager's switcher is **locked** — clicking reveals no options.
- **D11c** (Playwright) the on-duty HMOD can open **another** house's **calendar** via `?house=`
  (the calendar house-name element shows the other house, not their home).
- **D11d** (Playwright) the on-duty HMOD's **coverage** with no `?house=` shows **All houses**
  (the coverage house-name element reads "All houses"); selecting one house narrows to it.
- **D11e** (Playwright) an **off-duty** manager hitting `?house=<other>` on `/calendar` (or
  `/coverage`) still renders **their own** house (the param is ignored).

### E. Ack-reminder summary (#8) — Vitest only (see D10)

- **E1** no reminders → `stage:'awaiting'`, `firedCount:0`.
- **E2** only the long (≈6h) reminder has fired → `stage:'reminded_6h'`, `firedCount:1`.
- **E3** the 6h **and** 2h reminders have fired → `stage:'reminded_2h'` (deepest fired wins),
  `firedCount:2`.
- **E4** a mandatory (1h/30m/5m) reminder has fired → `stage:'reminded_final'`.
- **E5** all reminders are still in the future (just assigned) → `stage:'awaiting'`.
- **E6** a reminder scheduled exactly at `now` counts as fired (`<=`).
- **E7** instant comparison is correct across a DST boundary (ISO strings either side of
  2026-03-08 / 2026-11-01).
- **E8** `firedCount` equals the number of reminders at-or-before `now`.

---

## 4. Testid contract (frozen — Implementer must emit exactly these)

| testid                | element                                                                          | added in                      |
| --------------------- | -------------------------------------------------------------------------------- | ----------------------------- |
| `hmod-pill`           | the HMOD on-duty pill; contains the state word "On duty"/"Off duty"              | AppShell                      |
| `nav-bell`            | the notification bell button (links `/inbox`)                                    | AppShell                      |
| `bell-count`          | the unread badge (rendered only when count > 0)                                  | AppShell                      |
| `house-switcher`      | the house-context switcher button                                                | AppShell                      |
| `house-option-<id>`   | a switcher menu item per house (`house-option-harnwell`, …) — only when unlocked | AppShell                      |
| `house-option-all`    | the "All houses" switcher item (coverage; first) — only when unlocked            | AppShell                      |
| `calendar-house-name` | the house name shown on the calendar page header                                 | HouseCalendar / calendar page |
| `coverage-house-name` | the house name on the coverage header (reads "All houses" in aggregate)          | CoverageMonitor               |

Existing testids reused: `app-shell`, `nav-calendar`, `nav-coverage`, `nav-admin-rotor`,
`rotor-grid`, `rotor-select-<weekStartDate>`, `rotor-save`, `rotor-saved`. Auth via `login()`.

---

## 5. Seed contract (Lead owns `supabase/seed.sql` — one appended, delimited S6 block)

Append a single clearly-fenced **"S6 HMOD context"** block (keeps merge-conflict surface with the
concurrent `fix/pgtap-period-overlap` workstream to this one block):

1. **One `hmod_rotor` row making Hana Quad the on-duty HMOD now.** `week_start_date` = the current
   duty-week **Friday**, computed with the **same expression** `resolve_hmod_on_duty` uses so it is
   guaranteed to match and to satisfy the `isodow=5` CHECK:
   ```sql
   INSERT INTO hmod_rotor (week_start_date, hmod_user_id)
   SELECT (d - (((extract(isodow FROM d)::int + 2) % 7)))::date, '<hana_quad_user_id>'
   FROM (SELECT ((now() AT TIME ZONE 'America/New_York') - interval '8 hours')::date AS d) s
   ON CONFLICT (week_start_date) DO UPDATE SET hmod_user_id = EXCLUDED.hmod_user_id;
   ```
   Use the seed's existing Hana-Quad user id (the `hm.quad@pennhousing.test` profile;
   `a0000000-…-0008` per the S3 block — confirm the actual id from the users seed).

That is the **only** required S6 seed addition. Rationale:

- **B1** (on-duty pill) — `resolve_hmod_on_duty(now)` = Hana ⇒ Hana sees "On duty".
- **B2** (off-duty pill) — **Bea Quad** (`bm.quad`, a BM ⇒ `canBeHmod`, **not** in the rotor) sees
  "Off duty"; she is also the **D11b/D11e** unauthorized actor (off-duty ⇒ not `canViewOthers`).
- **C1** (bell) — Hana already has S3's due, unacknowledged non-urgent notification.
- **D11a/c/d** (cross-house) — Hana (on-duty) views `?house=harnwell` (renders, even if empty) and
  aggregate coverage (Quad's S2 gaps + other houses).
- No pending-float / ack-reminder fixture (see D10).

**Reseed before e2e/pgTAP:** `supabase db reset` (the rotor row is `now()`-relative). The
force-trigger live-EF flake + the pre-existing full-`supabase test db` Summer-overlap reds are
**not S6** (S2/S3 NOTES; the `fix/pgtap-period-overlap` branch addresses the overlap) — run the S6
Playwright spec + `pnpm test` for the gate.

---

## 6. Implementer allowlist + firewall

**FIREWALL:** the Implementer must **not open any test file** — `packages/core/tests/**`,
`apps/web/e2e/**`, `supabase/tests/**`, `*.test.ts`, `*.spec.ts` — and must **not** edit
`supabase/seed.sql` (Lead owns the seed). It codes to this contract + the testid table, and hands
back to the Lead to run suites.

**MAY CREATE:**

- `packages/core/src/hmod-context/index.ts` + `types.ts` — pure: `fridayAnchor`,
  `summarizeAckReminders`, `canViewOtherHouses`, `resolveCalendarHouse`, `resolveCoverageScope`
  (+ the `AckReminderRow`/`AckReminderState` types). **Zero Supabase imports** (core invariant).
- `apps/web/lib/data/hmod.ts` — I/O: `getOnDutyHmodId`, `getUnreadCount`, `getShellHouses`
  (all 13 `{id,name,restricted}`).

**MAY EDIT:**

- `packages/core/src/index.ts` — barrel-export the new module.
- `apps/web/lib/data/rotor.ts` — replace Monday `weekStart` with `fridayAnchor` (read weeks +
  saved keys); fix the stale "Monday-anchored" comment.
- `apps/web/lib/data/coverage.ts` — select `parent_float_id`; ack-reminder join + `floater.ack`
  shape (D9); `getAllHousesCoverageData` (D7).
- `apps/web/components/AppShell.tsx` — pill state (D3), bell + count (D4), switcher unlock + menu +
  nav (D11); new props.
- `apps/web/app/(app)/layout.tsx` — compute `hmodOnDuty`, `canViewOthers`/`canSwitchHouse`,
  `houses`, `unreadCount`; thread to `AppShell`.
- `apps/web/app/(app)/calendar/page.tsx` — honor `?house=` via `resolveCalendarHouse`; emit
  `calendar-house-name`.
- `apps/web/app/(app)/coverage/page.tsx` — `resolveCoverageScope`; aggregate vs single; emit
  `coverage-house-name`.
- `apps/web/components/coverage/CoverageMonitor.tsx` — render `floater.ack.reminderLabel` (D9);
  `coverage-house-name`.
- `apps/web/components/calendar/HouseCalendar.tsx` — only if needed to surface `calendar-house-name`.
- CSS for the switcher menu — the existing `apps/web/app/(app)/...` global stylesheet or the
  AppShell's stylesheet (additive; do not regress existing classes).

**MUST NOT TOUCH:** any test/seed (above); unrelated RPCs/migrations (no new migration — no schema
change); the closed-house state (deferred).

---

## 7. Invariant re-check (Lead, before "done")

S6 is **read-only / presentational** — no assignment writes, no float writes, no schema change —
so the hard invariants are structurally untouched. Explicitly confirm:

1. **Harnwell training** — viewing the Harnwell calendar/coverage cross-house is _reading_, never
   staffing; no assignment path is added. The `restricted` flag still renders. ✓ no regression.
2. **Float direction** — no float is created/redirected; the ack indicator only _reads_ existing
   float rows. ✓
3. **No-takeback** — no revoke control added anywhere. ✓
4. **Hours cap** — untouched. ✓
5. **30-min blocks** — untouched. ✓
6. **`timestamptz` / NY / DST** — `fridayAnchor` is UTC date-only (DST-immune, D1); the ack
   summary compares ISO instants (D8); the rotor key uses the orchestrator's own NY-anchored
   expression. ✓
7. **RLS / authorization** — cross-house viewing is gated to on-duty-HMOD/project-admin (D5);
   coverage/calendar already use the service client (authorized server snapshot), so widening the
   _house_ a manager may view does not widen RLS — the gate is the pure resolver + the page. The
   rotor save stays HM/BM-only (`saveRotor` unchanged). ✓

**Repo gate (done = all green):** `pnpm type-check && pnpm lint && pnpm build && pnpm test`
(+ the new `s6-hmod-context` Vitest) + the `hmod-context` Playwright spec (after `supabase db
reset`). No `supabase test db` change expected (no migration/RPC). If `@shift/core` is consumed
from `dist`, rebuild it before the web type-check/build.
