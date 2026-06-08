# S3 — Allied "resolved" state + unresolved-only inbox · TEST_PLAN

Decision 3 / audit #3 (reframed). Built via the **TDD firewall** (Lead spec → Test
Author red → firewalled Implementer → Lead verify/reconcile). This file is the
**behavior contract** (test-name checklist) + **pinned decisions**. The Implementer
receives the pinned decisions + the §4 contract **only** — never the test bodies.

## Spec sources

- `BEHAVIORAL_SPECIFICATION.md`
  - §5.4 (escalation chain — T-2h float-lookup failure → **HMOD notified that Allied
    coverage is required**; "Allied coverage is the terminal step; once Allied is
    assigned, the gap is considered resolved"),
  - §10.1 (routing — HM/BM notifications real-time **to the HM** in HM hours; **HMOD
    on duty** off-hours/weekends; "The HM/BM/HMOD places the call to Allied"),
  - §10.3 (the Allied-procurement notification's information content: house, time
    window, reason).
- `docs/design-brief.md` §6.4 (Action inbox — the Allied-procurement alert is the
  signature item; read/unread, urgency, grouping, clean empty state).
- `AGENTS.md` hard invariants (#3 no-takeback; #5 30-min blocks; #6 NY timestamptz).
- Prior sessions: `sessions/S1/NOTES.md`, `sessions/S2/NOTES.md` (the reconciliation
  lessons; the `lib/data/coverage.ts` / `ActionInbox.tsx` files S3 shares).

## The reframe (what "resolved" is — and is NOT)

The `hmod_urgent` notification means **"this coverage gap needs an Allied call"**. The
HM (in hours) or the on-duty HMOD (off-hours) makes that call **out of band** (a phone
call to Allied Security). There is no in-app "place the call" action — the design's old
"Call Allied / Mark covered" button had no backing RPC and never could (the app can't
phone Allied). S3 replaces it with a single **Resolved checkbox** the HM/HMOD ticks
once they've handled the alert. The inbox then shows **only unresolved** Allied
requests, with a way to view/untick resolved ones.

> **Resolved ≠ covered.** Ticking _Resolved_ marks the **alert** handled; it does **not**
> fill the coverage seat. The block stays a gap on the coverage board until it is
> actually covered (a floater acknowledges / Allied is recorded / an admin assigns).
> S3 therefore touches **only** the `notifications` row — never `shift_block_assignments`.
> This distinction is load-bearing and is enforced by pgTAP line A16 and pinned in D10.

---

## Pinned decisions (PIN EXACTLY — the firewall depends on a single shared interface)

S1's worst bug was an under-specified interface the Test Author and Implementer read
differently. Every name/shape/order below is fixed.

### D1 — New columns on `notifications`

Added in migration **`supabase/migrations/20260606000002_s3_allied_resolved.sql`**
(next stamp after S1's `20260606000001`; S2 added no migration). Idempotent
(`ADD COLUMN IF NOT EXISTS`).

| column        | type          | null | notes                                                            |
| ------------- | ------------- | ---- | ---------------------------------------------------------------- |
| `resolved_at` | `timestamptz` | yes  | when the alert was marked handled; NULL = unresolved.            |
| `resolved_by` | `uuid`        | yes  | `REFERENCES users(user_id) ON DELETE SET NULL`. Who resolved it. |

Meaningful **only** for `type = 'hmod_urgent'`. No CHECK constraint ties them to the
type (other types simply never set them). `notifications` already has
`REPLICA IDENTITY FULL` + is in the `supabase_realtime` publication (phase 12) — no
realtime change needed.

### D2 — Resolve RPC (the one new function)

```
set_allied_resolved(
  p_notification_id uuid,
  p_user_id         uuid,
  p_resolved        boolean,
  p_now             timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

**Return value** = "state changed": `true` if this call set/cleared the resolution,
`false` if the row was **already** in the target state (idempotent no-op). NOT an error
on no-op.

**Body, in this exact order** (the order matters — see the note after):

1. Load `v_type := type`, `v_house := payload->>'house_id'` for `p_notification_id`.
   If **no row** → `RAISE EXCEPTION 'notification_not_found'`.
2. If `v_type <> 'hmod_urgent'` → `RAISE EXCEPTION 'not_resolvable'`.
3. **Spoof guard** (mirrors `mark_notification_read`): if
   `auth.uid() IS NOT NULL AND auth.uid() <> p_user_id` → `RAISE EXCEPTION 'not_authorized'`.
4. **Authz**: if **NOT** (
   `user_has_house_admin_role(p_user_id, v_house)` — HM/BM of the alert's house
   **OR** `p_user_id = resolve_hmod_on_duty(p_now)` — the on-duty HMOD
   ) → `RAISE EXCEPTION 'not_authorized'`.
5. Conditional write, return `FOUND`:
   - `p_resolved = true` →
     `UPDATE notifications SET resolved_at = p_now, resolved_by = p_user_id
 WHERE notification_id = p_notification_id AND resolved_at IS NULL;`
   - `p_resolved = false` →
     `UPDATE notifications SET resolved_at = NULL, resolved_by = NULL
 WHERE notification_id = p_notification_id AND resolved_at IS NOT NULL;`
   - `RETURN FOUND;`

> **Why this order.** Authz (step 4) needs `payload.house_id`; a non-`hmod_urgent`
> notification may not carry one, so the type gate (step 2) must precede it. The
> conditional `WHERE … IS [NOT] NULL` in step 5 is what makes a double-resolve return
> `false` **without** an error (idempotency) — distinct from the `not_found` RAISE
> (step 1), which is a genuinely bad id.

**RAISE messages are the bare reason tokens** (`not_authorized`, `not_resolvable`,
`notification_not_found`) so the action-layer mapper matches on them (S1 `override.ts`
pattern).

**Grants:** `REVOKE ALL ON FUNCTION set_allied_resolved(uuid, uuid, boolean, timestamptz)
FROM PUBLIC;` then `GRANT EXECUTE … TO authenticated, service_role;`.

### D3 — Mark-read reuse (no new RPC)

Non-urgent notifications use the **existing** `mark_notification_read(p_notification_id,
p_user_id, p_now) RETURNS boolean` (migration `20260601000001`) — already
`SECURITY DEFINER`, scopes `WHERE recipient_user_id = p_user_id AND acknowledged_at IS
NULL`, granted to `authenticated, service_role`. S3 only **wires** it. Do not re-define it.

### D4 — Gating rule (authoritative, enforced in the RPC)

A caller may resolve/unresolve an `hmod_urgent` alert **iff**:

- `user_has_house_admin_role(p_user_id, payload.house_id)` — an **HM or BM of the
  alert's house** — **OR**
- `p_user_id = resolve_hmod_on_duty(p_now)` — the **on-duty HMOD** at `p_now`.

SM and SW are **never** authorized. An HM/BM of a **different** house who is not the
on-duty HMOD is rejected. (Why both: §10.1 routes the alert to the house HM during HM
hours but to the HMOD off-hours; the off-hours HMOD's `notifications.recipient` is the
HMOD even when `payload.house_id` is a house they don't administer — so house-admin
alone is insufficient.)

### D5 — Action layer (`apps/web/lib/actions/inbox.ts`, NEW, `'use server'`)

Both actions use the **service client** (`createServiceClient`), pass
`p_user_id = (await getSessionUser()).userId` and `p_now = new Date().toISOString()`,
and let the RPC re-check authoritatively (the `override.ts` pattern). Web-layer
fast-fail gate + `revalidatePath('/inbox')` on success.

```ts
export async function setAlliedResolved(input: {
  notificationId: string;
  resolved: boolean;
}): Promise<ActionResult<undefined>>; // gate: isHouseAdmin(me) (hm/bm)

export async function markRead(input: { notificationId: string }): Promise<ActionResult<undefined>>; // gate: me !== null (RPC scopes by recipient)
```

`ActionResult<T>` is the existing `import type { ActionResult } from './builder'`. Map
the RPC RAISE reasons to friendly copy (reuse the `override.ts` `friendlyMessage` idea):
`not_authorized` → "You are not authorized to resolve this Allied request.";
`not_resolvable` → "Only Allied-coverage alerts can be resolved.";
`notification_not_found` → "That notification no longer exists." A successful call
returns `{ ok: true, data: undefined }` whether the RPC returned `true` (changed) or
`false` (idempotent no-op) — both are "the toggle is now in the requested state".

### D6 — Pure core module `packages/core/src/inbox/`

Zero Supabase imports. Barrel `index.ts`, re-exported from `packages/core/src/index.ts`
as **`export * from './inbox/index.js';`** (NodeNext `.js` specifier — see the EF-boot
lesson in S2 NOTES). Exact surface:

```ts
export type InboxView = 'default' | 'resolved';

export type InboxFilterInput = {
  type: string; // notification_type value
  scheduledForIso: string | null;
  resolvedAtIso: string | null;
};

// audit #18b: "due" = no schedule, or scheduled at/before now. (Compare as Date — ISO
// strings with differing offsets do not compare correctly as strings.)
export function isDue(input: InboxFilterInput, nowIso: string): boolean;

// A resolved Allied alert.
export function isResolvedAllied(input: InboxFilterInput): boolean;
//  === input.type === 'hmod_urgent' && input.resolvedAtIso !== null

// Membership in a view at a moment.
export function belongsInInboxView(
  input: InboxFilterInput,
  view: InboxView,
  nowIso: string,
): boolean;
```

`belongsInInboxView` semantics:

- if `!isDue(input, nowIso)` → **false** (future-scheduled never shows, in either view).
- `view === 'resolved'` → `isResolvedAllied(input)` (resolved Allied alerts **only**).
- `view === 'default'` → `!isResolvedAllied(input)` (everything due **except** resolved
  Allied alerts — i.e. unresolved Allied alerts **and** all non-urgent notifications).

### D7 — Data layer `getInboxData` (`apps/web/lib/data/inbox.ts`)

Signature: `getInboxData(view: InboxView = 'default', now: Date = new Date()):
Promise<InboxData>`. Authed client (RLS scopes to recipient — keep), `select`s the new
columns too: `notification_id, type, payload, created_at, scheduled_for,
acknowledged_at, resolved_at, resolved_by`; `order by created_at desc limit 100`. Build
`nowIso = now.toISOString()`, map each row → enriched `InboxItem`, and partition with
the D6 predicates. Pinned shapes:

```ts
export type InboxItem = {
  id: string;
  type: string;
  urgent: boolean; // unresolved Allied alert: type==='hmod_urgent' && !resolved
  resolved: boolean; // isResolvedAllied(row)
  unread: boolean; // acknowledged_at === null
  title: string;
  timeLabel: string;
  houseName: string | null;
  windowLabel: string | null;
  reason: string | null;
};

export type InboxData = {
  items: InboxItem[]; // rows where belongsInInboxView(row, view, nowIso)
  view: InboxView;
  unreadCount: number; // default-view items that are unread
  urgentCount: number; // default-view items that are unresolved Allied alerts
  resolvedCount: number; // due resolved Allied alerts (size of the resolved view)
};
```

Counts are computed from the **full fetched set** via the predicates, independent of the
requested `view` (so the default-view tab/badge counts and the "Show resolved (N)" label
are both always correct):

- `resolvedCount = rows.filter(r => isDue(r,nowIso) && isResolvedAllied(r)).length`
- `unreadCount   = rows.filter(r => belongsInInboxView(r,'default',nowIso) && r.acknowledged_at===null).length`
- `urgentCount   = rows.filter(r => belongsInInboxView(r,'default',nowIso) && r.type==='hmod_urgent').length`
- `items         = rows.filter(r => belongsInInboxView(r,view,nowIso)).map(enrich)`

### D8 — Inbox page `?show=` param (`apps/web/app/(app)/inbox/page.tsx`)

Mirror the `?week=` pattern in `app/(app)/calendar/page.tsx` (this Next's **async**
searchParams): `searchParams: Promise<{ show?: string }>`; `const { show } = await
searchParams; const view = show === 'resolved' ? 'resolved' : 'default';` → `await
getInboxData(view)`. Page gate unchanged (`canBuildSchedule`). Pass the resulting `data`
(carrying `view`) to `ActionInbox`.

### D9 — UI (`apps/web/components/inbox/ActionInbox.tsx`) — testids pinned EXACTLY

Remove the **"Read-only in this build"** `Notification` entirely. Client component
(already `'use client'`); after a successful action call **`router.refresh()`** (the
`ForceTriggerControl`/`HouseCalendar` pattern) so the list re-renders.

| testid                   | element / behavior                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `inbox-resolve-checkbox` | A native `<input type="checkbox">` (accessible name "Resolved") on **each `hmod_urgent` row**. **Default view: unchecked**; checking → `setAlliedResolved({id, resolved:true})`. **Resolved view: checked**; unchecking → `setAlliedResolved({id, resolved:false})`. Replaces the old "Call Allied / Mark covered" + "Dismiss" pair. |
| `inbox-mark-read`        | A button on **each non-urgent row** → `markRead({id})`. Replaces the disabled "Open"/"Dismiss".                                                                                                                                                                                                                                      |
| `inbox-show-resolved`    | A `Link` to `/inbox?show=resolved`, rendered in the **default** view when `resolvedCount > 0`. Label e.g. "Show resolved (N)".                                                                                                                                                                                                       |
| `inbox-hide-resolved`    | A `Link` back to `/inbox`, rendered in the **resolved** view.                                                                                                                                                                                                                                                                        |

The **default** list shows only unresolved Allied alerts + non-urgent items (never a
resolved Allied alert mixed in). The **resolved** view shows only resolved Allied alerts
(+ the hide-resolved link). Use a native checkbox (not an aria-toggled button) so
Playwright `.check()`/`.uncheck()`/`toBeChecked()` resolve unambiguously (avoids the S1
aria-reconciliation friction). The seed (D11) guarantees **exactly one** unresolved and
**exactly one** resolved Allied alert in Hana's inbox, so `inbox-resolve-checkbox` is
unique within each view.

### D10 — Coverage board NOT touched in S3

`components/coverage/CoverageMonitor.tsx` and `lib/data/coverage.ts` are **out of scope**
for S3 and unchanged. Reflecting resolved-state on an `esc==='allied'` coverage card
needs a coverage-data → notifications join that **no behavior-contract line covers**;
adding it untested would be scope creep. The resolved-vs-covered distinction is preserved
_precisely because_ `set_allied_resolved` touches only the notification (pgTAP A16), and
is documented in `NOTES.md`. The coverage badge is a flagged follow-up. **Implementer:
do not edit coverage files.**

### D11 — Seed fixtures (Lead owns `supabase/seed.sql` — OFF the implementer allowlist)

Recipient = **Hana Quad** (`a0000000-0000-4000-8000-000000000008`, the Quad HM, so
`user_has_house_admin_role(Hana,'quad')` is true). The inbox e2e hits the **real**
`new Date()`, so these rows use **`now()`-relative** times (not the fixed-2026 literals
the pgTAP/Vitest suites pass explicitly). Fixed `notification_id`s; idempotent under
`supabase db reset`. Four rows:

| row | type              | `house_id` | `reason`                  | scheduled_for | resolved_at             | acknowledged_at | role in tests                              |
| --- | ----------------- | ---------- | ------------------------- | ------------- | ----------------------- | --------------- | ------------------------------------------ |
| N1  | `hmod_urgent`     | `quad`     | `float_no_acknowledgment` | `now()-1h`    | NULL                    | `now()-50min`   | **unresolved**, read → default-view target |
| N2  | `hmod_urgent`     | `quad`     | `floater_declined`        | `now()-2h`    | `now()-30min` (by Hana) | `now()-90min`   | **resolved**, read → resolved-view target  |
| N3  | `hm_leave_notice` | (n/a)      | (n/a)                     | `now()-1h`    | NULL                    | **NULL**        | non-urgent **unread** → mark-read target   |
| N4  | `ack_reminder`    | (n/a)      | (n/a)                     | `now()+2d`    | NULL                    | NULL            | **future** → proves #18b hidden            |

N1/N2 payloads carry `{target:'hm', reason:…, house_id:'quad', block_id:<a seeded Quad
block uuid>, block_start_at:<a NY iso>}` so the row renders house + window + reason.
**N1 and N2 carry DISTINCT reasons** — N1 `float_no_acknowledgment` renders "…did not
acknowledge in time."; N2 `floater_declined` renders "The assigned floater declined." —
so the e2e can address each row (and thus each `inbox-resolve-checkbox`) by its reason
text and stay unambiguous even when both Allied alerts render in the resolved view.
**N1 and N2 are seeded `acknowledged` (read)** so the only `.unread-dot` is N3's, making
the mark-read assertion deterministic. The e2e's resolve test fully **restores** N1
(resolve → unresolve) and never mutates N2, so the suite is order-independent on a fresh
reset (workers:1, no per-test DB reset).

---

## §4 — Behavior contract (each line ⇒ ≥1 named `should…` test)

### 4a. pgTAP — `supabase/tests/s3-allied-resolved.sql`

Fixtures use a **fixed DST-stable NY anchor** and explicit `p_now` (clock-independent,
unlike the e2e). Houses: `quad` (alert house), plus a second house for the
wrong-house-admin case. Actors: a Quad HM, a Quad BM, an SM, an SW, an HM of the other
house, and an HMOD user (an active HM of some house) wired on-duty via `hmod_rotor`.

1. `should expose set_allied_resolved with the (uuid,uuid,boolean,timestamptz)→boolean signature`
2. `should add notifications.resolved_at and resolved_by columns`
3. `should set resolved_at=p_now and resolved_by=p_user_id when resolving an hmod_urgent alert (returns true)`
4. `should clear resolved_at and resolved_by when unresolving (returns true)`
5. `should be idempotent — a second resolve returns false and leaves resolved_at/by unchanged`
6. `should treat a second unresolve as a no-op returning false (not an error)`
7. `should allow the HM of the alert's house to resolve`
8. `should allow the BM of the alert's house to resolve`
9. `should allow the on-duty HMOD to resolve an alert for a house they do not administer`
10. `should reject an HM of a different house who is not the on-duty HMOD (not_authorized), row unchanged`
11. `should reject an SM (not_authorized)`
12. `should reject an SW (not_authorized)`
13. `should reject resolving a non-hmod_urgent notification (not_resolvable), row unchanged`
14. `should raise notification_not_found for an unknown notification id`
15. `should REVOKE set_allied_resolved from PUBLIC and GRANT it to authenticated and service_role`
16. `should NOT mutate any shift_block_assignments row when resolving (resolved is not covered)`
17. `should still mark a non-urgent notification read via mark_notification_read (acknowledged_at set)`

> **Pin for line 9 (HMOD anchoring).** `resolve_hmod_on_duty(p_at)` is Friday-anchored:
> `v_shifted := ((p_at AT TIME ZONE 'America/New_York') - interval '8 hours')::date;`
> `v_week_start := v_shifted - (((extract(isodow FROM v_shifted)::int + 2) % 7));`
> Seed an `hmod_rotor(week_start_date = v_week_start, hmod_user_id = <HMOD HM>)` row and
> make that HM **active with no `hm_leave`** (so `resolve_hm_for_user` returns them
> unchanged). The HMOD's home house must differ from `quad` so line 9 proves the
> house-admin branch was NOT what authorized them.

> **Pin for the spoof guard (D2 step 3).** It depends on `auth.uid()`. pgTAP runs as a
> superuser where `auth.uid()` is NULL, so the guard is naturally skipped and the
> happy-path/role tests exercise the `auth.uid() IS NULL` (service-role) branch — the
> same branch the web action uses. A dedicated `SET ROLE authenticated` +
> `request.jwt.claims` spoof test is **optional**; if it's awkward, omit it (the web
> action always calls with the service client, so the guard's job is just to not block
> service-role — which every role test already covers).

### 4b. Vitest — `packages/core/tests/s3-inbox/inbox.test.ts`

1. `should treat a null scheduledFor as due`
2. `should treat scheduledFor at or before now as due, and after now as not due`
3. `should mark only hmod_urgent with a resolvedAt as a resolved Allied alert`
4. `should EXCLUDE resolved Allied alerts from the default view`
5. `should INCLUDE unresolved Allied alerts in the default view`
6. `should INCLUDE due non-urgent notifications in the default view`
7. `should EXCLUDE future-scheduled notifications from the default view (#18b)`
8. `should INCLUDE resolved Allied alerts in the resolved view`
9. `should EXCLUDE unresolved Allied alerts from the resolved view`
10. `should EXCLUDE non-urgent notifications from the resolved view`
11. `should EXCLUDE a future-scheduled resolved alert from the resolved view (due gate applies in both views)`

### 4c. Playwright — `apps/web/e2e/inbox-resolve.spec.ts` (route `/inbox`)

Seed (D11) gives Hana exactly one unresolved + one resolved Allied alert + one
non-urgent unread + one future row. Login via `helpers.login`.

1. `should hide the inbox from a Student Worker (managers only) — no resolve control` (login `alice`; `/inbox`; `inbox-resolve-checkbox` count 0; the managers-only gate shows).
2. `should show the unresolved Allied alert with an unchecked Resolved checkbox and no Call-Allied button / read-only notice` (login `hmQuad`; N1's `inbox-resolve-checkbox` is visible+unchecked; no "Call Allied / Mark covered" text; no "Read-only in this build" notice).
3. `should remove a ticked Allied alert from the active inbox, surface it under Show resolved, and restore it when unticked` (§4c lines 3+4 as ONE **self-restoring round-trip on N1**: tick → leaves the default list; `inbox-show-resolved` → N1 there **checked**; untick → leaves the resolved view; `inbox-hide-resolved` → N1 back in the active list. Restores N1 → order-independent).
4. `should list the already-resolved Allied alert under Show resolved with a checked box` (the seed-resolved **N2**, READ-ONLY: not in the default view; under `inbox-show-resolved` its `inbox-resolve-checkbox` is checked).
5. `should mark a non-urgent notification read` (click `inbox-mark-read` on the N3 row → its `.unread-dot` clears; N1/N2 are seeded read so N3 is the sole unread dot).
6. `should show only unresolved Allied requests in the default inbox — never a resolved one` (the default view contains N1 unchecked and **not** N2).

> Robustness (shared DB; `workers:1`, `fullyParallel:false`, no per-test reset): every
> checkbox interaction is **scoped to its `.inbox-item` row by the distinct reason
> text** (so N1 vs N2 stay individually addressable even when both render in the
> resolved view — no strict-mode violation). Mutations use `.click()` (not
> `.check()`/`.uncheck()`) so the post-write `router.refresh()` detaching the row is not
> a race. The round-trip restores N1; nothing mutates N2 — the suite is
> order-independent on a fresh `supabase db reset`.

---

## Files

**Implementer allowlist (may edit):**

- `supabase/migrations/20260606000002_s3_allied_resolved.sql` _(new)_
- `packages/core/src/inbox/index.ts` _(new)_ + `packages/core/src/inbox/types.ts` _(new, optional)_
- `packages/core/src/index.ts` _(add the one barrel line)_
- `packages/shared/src/database.types.ts` _(regenerate after the migration)_
- `apps/web/lib/data/inbox.ts`
- `apps/web/lib/actions/inbox.ts` _(new)_
- `apps/web/components/inbox/ActionInbox.tsx`
- `apps/web/components/inbox/inbox.css` _(if needed)_
- `apps/web/app/(app)/inbox/page.tsx`

**Firewall — Implementer must NOT open:** `supabase/tests/**`,
`packages/core/tests/**`, `apps/web/e2e/**`, and **`supabase/seed.sql`** (Lead owns the
seed). Also **do not edit** `components/coverage/**` or `lib/data/coverage.ts` (D10).

## Invariant re-check (Lead, before commit)

- #3 no-takeback: resolving an alert **never** touches `float_assignments` /
  `shift_block_assignments` — it cannot revoke a pending float (A16).
- #5 / #6: no block math or timestamps introduced beyond reading `payload`/`p_now`.
- Harnwell / float-direction: untouched (S3 has no assignment writes).

## Run commands

- pgTAP: `supabase test db` (or the single file via the suite runner).
- Vitest: `pnpm test` (root; runs `packages/core` Vitest).
- Repo gate: `pnpm type-check && pnpm lint && pnpm build && pnpm test`.
- e2e: `supabase db reset` (apply migration + seed) then `pnpm --filter @shift/web e2e`.
- After the migration: `supabase gen types typescript --local >
packages/shared/src/database.types.ts` (strip any leaked CLI stderr — S1/S2 lesson).
