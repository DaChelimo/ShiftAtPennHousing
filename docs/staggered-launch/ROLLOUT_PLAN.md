# Staggered House Launch — Rollout Plan

Status: PROPOSED (2026-07-11). Awaiting go-ahead to start Phase 0.

## Goal

Launch Shift@PennHousing to houses **one at a time**, not all 13 at once:

1. **Harnwell** (pilot, fixed schedule from a provided screenshot)
2. **High rises**: Rodin + Harrison (added to the pilot once Harnwell holds)
3. **Gutmann**
4. **Remaining houses**

Constraints driving the design:

- Rollout happens over the **summer**, so adding a house must be near-effortless (config + data, no code deploy per house).
- Schedules are **ongoing/recurring**, generated with Claude's help (no manual copy).
- The pilot schedule (Harnwell) is a **given fixed schedule** from a screenshot, not preference-based.
- Account onboarding must be **easy**: wire the missing invite/reset flow now, migrate to **PennKey SAML SSO** next.

## Decisions locked (2026-07-11)

| Decision                       | Choice                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------- |
| Worker at a not-yet-live house | **Allow login, show a placeholder screen** ("Shift isn't live at your house yet") |
| Auth direction                 | **Wire invite/password-reset now; pursue PennKey SSO next**                       |
| Penn identity provider         | **SAML 2.0 / Shibboleth (PennKey)** — natively supported by Supabase Auth         |

## Current-state assessment (why we are not yet optimized)

Investigated 2026-07-11. Three gaps between today and a staggered launch:

### Gap 1 — no per-house launch gate

- `houses` is `(id, name, desk_phone)`. No `launched`/`live`/`pilot` flag anywhere.
- RLS `houses_authenticated_read USING (true)` — every authenticated user reads every house.
- House switcher (web `AppShell` + mobile `HouseScheduleViewModel`) lists all 13. Directory, admin dropdowns, all read the `houses` table.
- Only per-user gate is `users.is_active` (employment, not house). A worker at any house can log in today.
- **However**: house _enumeration is fully data-driven_ — no hardcoded "which houses exist" lists. The hardcoded `harnwell`/`quad` references are business rules (float routing, training), not membership lists. So _adding_ a house is already pure data; only _hiding unlaunched ones_ needs new code.
- "Open vs closed" (operating-seasons) is a staffing concept, not a launch gate. A house with no staffing generates no blocks (looks empty) but is not hidden and its workers are not blocked.

### Gap 2 — account onboarding has a real hole

- Both platforms run on **Supabase Auth email+password**. `login/page.tsx` → `signInWithPassword`; mobile `SupabaseAuthGateway` → GoTrue email sign-in.
- **`public.users.user_id` IS `auth.uid()`** (FK to `auth.users(id)`), and all RLS joins on `auth.uid()`. Identity is a uuid, not email/password. => an SSO swap is a GoTrue-config + login-UI change, not an app rewrite.
- `hire-worker` EF creates the auth user with **no password** and defers to "the deployment's invite/reset flow" — **which does not exist in the codebase**. Only the dev seed hard-codes `abc123`. There is currently **no production way for a hired worker to obtain credentials**. This must be fixed regardless of the SSO decision.
- The "PennKey email" / "Sign in with PennKey" labels already in the mobile login UI are cosmetic today (they call the password gateway).

### Gap 3 — schedule onboarding is stitched, not one-button

- Config -> blocks is one clean RPC: `apply_compiled_season` (driven by per-house staffing **bands** in `season_house_windows`, expands to 30-min `shift_blocks` via `generate_blocks_for_range`).
- Blocks -> assignments -> recurring publish is **separate manual steps**: build the template week (drag builder, AI panel, or dev-seed) -> `draft_block_assignments` -> `publish_schedule` (stamps the `(weekday, time-of-day)` template across every week of the period).
- The AI agent (`packages/core/src/ai-schedule`) is **one house / one template week, drafts only**, and presupposes blocks + submitted preferences exist.
- No image/OCR ingestion — a screenshot must be hand-translated into bands + assignments.

## Plan

Five workstreams. A/D are the code needed to _enable_ a staggered pilot; B/C make _each_ house easy; E is the durable auth answer.

### Workstream A — Per-house launch gate (NEW CODE)

Goal: mark houses `pre_launch` vs `live`; workers at `pre_launch` houses authenticate but see a placeholder; admins bypass so they can prep.

1. **Schema**: `houses.launch_state text NOT NULL DEFAULT 'live' CHECK (launch_state IN ('pre_launch','live'))` + `launched_at timestamptz`. Default `live` preserves current dev/seed/test behavior; production rollout flips non-pilot houses to `pre_launch`. (Optionally a `system_config` master switch so the whole gate can be disabled at once.)
2. **Web enforcement**: in `getSessionUser` / the `(app)` layout, if the worker's home house is `pre_launch` and the user is a plain SW (not hm/bm/rsm/admin/sm-of-a-live-house), route to a new `/not-live` placeholder page. Admins and schedule-builders pass through.
3. **Mobile enforcement**: resolve a `homeHouseIsLive` flag in the shared session/repository layer; add a placeholder screen shown post-login on both Android (Compose) and iOS (SwiftUI) when the home house is not live. Reuse existing login state plumbing.
4. **Enumeration filter**: for **workers**, `listHouses`/`fetchHouses` return only `live` houses (+ their own). **Admins** see all houses (they must prep unlaunched ones). This keeps the switcher/directory clean during the pilot without touching RLS.
5. **Copy** (no em dashes): "Shift isn't live at {House} yet. We'll let you know as soon as it's ready."
6. **Tests**: pgTAP for the gate query + enumeration filter; mobile/web unit tests for the placeholder branch. Keep default `live` so the existing suite stays green.

Invariant check: gating is additive and does not touch the hard invariants (Harnwell training, float routing, no-takeback, block atomicity, NY tz).

### Workstream B — Effortless "add a house" (MOSTLY DATA + a thin admin surface)

Adding a house is already data-driven; make it a guided admin flow instead of ad-hoc SQL.

1. Extend `/admin/operations` (admin-gated) with an **"Onboard / Launch house"** panel that chains the existing pieces:
   - ensure the `houses` row exists,
   - author the operating-season **window/bands** for the house (existing `SeasonEditor` band UI),
   - apply the season (`apply_compiled_season`) -> generates blocks,
   - build + publish the schedule (Workstream C),
   - flip `launch_state` -> `live` (the "Go live" toggle) + notify/invite the roster (Workstream D).
2. Surface a per-house **readiness checklist** (bands authored? blocks generated? schedule published? roster invited?) so "go live" is only enabled when the house is actually ready.

### Workstream C — Fixed-schedule bootstrap (Harnwell screenshot)

Harnwell's schedule is given and fixed, so we skip preferences/AI and place assignments directly.

1. Claude translates the screenshot into (a) staffing **bands** (weekday/weekend `block_start`/`block_end`/`headcount`, honoring Harnwell's single-AM/double-PM pattern) and (b) the concrete **worker -> block assignments**.
2. Author the bands as a `season_house_windows` row -> `apply_compiled_season` -> vacant blocks for the period.
3. Load the fixed assignments into `draft_block_assignments` programmatically (reuse the `admin_seed_draft_schedule` RPC that already writes drafts, or a thin fixed-import wrapper) for the **template week**.
4. `publish_schedule(period, publisher, 'harnwell')` -> stamps the template across every week (the "ongoing/recurring" behavior).
5. Same path serves later houses that also have a fixed schedule; preference-based houses use the AI panel instead.

Note: with only Harnwell live, cross-house floats are inert (Harnwell is never a float destination and no other house is live), so coverage escalation is broadcast -> Allied. Acceptable for a single-house pilot; revisit when the second house (Rodin) goes live and float routing between live houses becomes relevant.

### Workstream D — Account onboarding: invite + reset (NEW CODE, do now)

Close the credential gap so pilot workers can actually log in.

1. **Invite on hire**: extend `hire-worker` (or add `invite-worker`) to call GoTrue `auth.admin.generateLink({ type: 'invite' })` / `inviteUserByEmail`, emailing a set-password link.
2. **Web reset flow**: `/auth/forgot` (calls `resetPasswordForEmail`) + `/auth/update-password` (consumes the recovery token). Add an admin "Resend invite" button per worker.
3. **Bulk invite**: one action to invite an entire house's roster when it goes live.
4. **Mobile**: "Forgot password" entry that triggers the reset email; complete reset via web link (or a deep-linked in-app screen).
5. These are stock GoTrue capabilities; the only reason they're missing is nobody wired them.

### Workstream E — PennKey SAML SSO (NEXT; scope now, cut over later)

The durable ease-of-use answer. Runs in parallel with the pilot; not on its critical path.

1. **Coordinate with Penn IT + the app you already work with**: obtain the Shibboleth IdP metadata (entityID, SSO URL, signing cert) and register Supabase's ACS URL / SP entityID as a relying party.
2. **Supabase**: Pro plan + add the SAML provider (`supabase.auth.admin` SSO provider config) for the `upenn.edu` domain.
3. **Login UI**: web swaps the password form for `signInWithSSO({ domain: 'upenn.edu' })` redirect; mobile does browser-based SSO (supabase-kt SSO or external browser + deep-link back). The existing "Sign in with PennKey" button becomes real.
4. **Identity linking (main risk)**: map already-provisioned uuids to incoming SAML identities by email so historical `user_id`s stay stable (link `auth.identities`); otherwise SSO would mint new uuids and orphan every existing assignment. Plan a one-time linking migration/script before cutover.
5. **Provisioning shift**: hire flow moves from password `createUser` to SAML JIT / identity-link. Keep the invite/reset path (Workstream D) for any non-PennKey accounts.

## Sequencing

- **Phase 0 (enable pilot)** — Workstream A (gate) + Workstream D (invite/reset) + Workstream C wrapper. This is the only code that must ship before Harnwell can go live.
- **Phase 1 — Harnwell pilot**: author bands from screenshot, publish, invite roster, flip `launch_state = live`. Observe.
- **Phase 2 — High rises**: onboard Rodin + Harrison (now pure data ops via Workstream B). First real cross-house-float exercise between live houses.
- **Phase 3 — Gutmann.**
- **Phase 4 — Remaining houses.**
- **Parallel track — Workstream E (SSO)**: begin Penn IT engagement during Phase 0/1; cut over auth once metadata exchange + identity linking are ready. Non-blocking.

## Open items / risks

- Master-switch vs per-house default: confirm whether production should default all houses to `pre_launch` (safer) with an explicit flip, or default `live` with non-pilot houses flipped down. Recommendation: `system_config` master switch OFF by default in prod so the gate is explicit.
- SSO cutover timing: existing pilot accounts created with passwords must be linked to PennKey identities before the password path is removed.
- Fixed-schedule accuracy: the Harnwell screenshot translation should be reviewed by an SM/HM before publish, since publish stamps it across the whole period.
