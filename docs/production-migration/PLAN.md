# Production Migration Plan

Status: PROPOSED (not started). Authored 2026-07-26.

Two goals, one plan:

1. **Kill the physical-device URL problem.** Device builds stop depending on the Mac's
   current LAN IP.
2. **Get Harnwell live on hosted Supabase**, with staging in front of it.

This is a working document (per AGENTS.md, `docs/**` is never spec). When it lands, the
deploy-time requirements it introduces get promoted into BEHAVIORAL_SPECIFICATION.md §14
and ARCHITECTURE.md's deploy-config section in the same commit as the code.

---

## 0. Decisions locked

| Question                                     | Decision                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| Project topology                             | Two projects: **staging** + **prod**                                           |
| `Staff@PennHousing` (`zrnvsxrtegbgpzdiflkt`) | Wipe its obsolete prototype schema, becomes **STAGING**                        |
| Production                                   | **New project**, born clean from zero                                          |
| Physical-device URL                          | Device builds point at the **hosted** URL (fixed `https://<ref>.supabase.co`)  |
| Accounts                                     | Carry `auth.users` rows over verbatim; **existing passwords preserved**        |
| Other 12 houses                              | **Full config incl. their Summer 2026 windows**, no workers, no assignments    |
| Also in scope                                | Edge Functions + crons, Firebase push, Desk Assistant KB, config rows/contacts |

### The 11 Harnwell accounts (all already exist locally)

| Name              | Email                      | Role        |
| ----------------- | -------------------------- | ----------- |
| Mitchelle Majeski | mmajeski@upenn.edu         | `hm`        |
| Amaltuas Taye     | amtaye@upenn.edu           | `rsm`       |
| Abraham           | ndlovuab@sas.upenn.edu     | `sm` + `sw` |
| Valeria           | mercadov@sas.upenn.edu     | `sw`        |
| Aaron             | akkirui@sas.upenn.edu      | `sw`        |
| Andrew Chelimo    | chelimo@seas.upenn.edu     | `sw`        |
| Drew              | dbukasa@sas.upenn.edu      | `sw`        |
| Eleni             | elenikan@sas.upenn.edu     | `sw`        |
| Lealem            | lmelesse@seas.upenn.edu    | `sw`        |
| Ornella           | ornellar@sas.upenn.edu     | `sw`        |
| Purity            | liseche1@nursing.upenn.edu | `sw`        |

("Onela" = Ornella, "Michelle" = Mitchelle Majeski.) No `admin` account exists among them.
See open item **O1**.

---

## 1. Current-state facts this plan is built on

Verified against the repo and the local DB on 2026-07-26.

- **138 migrations**, 26 Edge Functions (+ `_shared`).
- **Local sim clock offset is ~1.4 days**, so local dates are effectively real. No date
  shifting is needed anywhere in this migration.
- **Summer 2026 season**: `2026-06-01 -> 2026-08-20`, `sm_built`, 40h hard cap,
  bounds `05:30 -> 00:00`. 13 `season_house_windows` (one per staffable house).
- **Harnwell volume**: 3,445 `shift_blocks` spanning `2026-06-01 -> 2026-09-07`, and
  6,123 `shift_block_assignments`.
- **14 house rows**: the 13 real houses plus `allied-house` (`is_staffable = false`).
  Every house is currently `launch_state = 'pre_launch'`.
- **123 users locally**; only 11 belong to Harnwell. The other 112 are seed/test fixtures
  and do not migrate.
- **3 `kb_documents`** with pgvector embeddings.
- **13 `system_config` keys.**
- Mobile config is baked at build time: Android `buildConfigField` from
  `local.properties` or `-P` flags ([apps/mobile/androidApp/build.gradle.kts:45](apps/mobile/androidApp/build.gradle.kts:45)),
  iOS `$(SUPABASE_URL)` in [Info.plist:52](apps/mobile/iosApp/iosApp/Info.plist:52).
- Secrets already flow from Infisical via [scripts/sync-secrets.sh](scripts/sync-secrets.sh),
  but only for a `Development` environment.

### Two landmines found while grounding

**L1. The cron jobs will silently not exist in prod.**
All 7 `cron.schedule(...)` call sites are wrapped in
`IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN`. Hosted Supabase
does **not** enable `pg_cron` / `pg_net` by default. So `supabase db push` will report
success, every migration will apply green, and the orchestrator tick, notification
delivery, swap expiry and house-transfer crons will simply never be created. Nothing will
warn you. Addressed in §4, step 2.

**L2. The confused-deputy exposure is a production blocker.**
Per `project_confused_deputy_and_anon_view_audit`: `REVOKE ... FROM PUBLIC` never strips
Supabase's default `anon` / `authenticated` EXECUTE grants, so roughly 37 `SECURITY
DEFINER` functions are still callable by any anon key holder. The permanent-ops trio was
fixed 2026-07-24; the rest were not. Today that is a local-only curiosity. The moment real
Harnwell accounts and a public anon key exist online it is a live privilege-escalation
hole. This must be closed before prod carries real data (§7, P0).

---

## 2. Track 1: the physical-device URL problem

Two distinct cases; the chosen answer solves the common one, and a cheap fallback covers
the other.

### 2a. Common case: device runs against hosted (primary fix)

Once staging/prod exist, a device build targets a permanent `https://<ref>.supabase.co`.
Network changes become irrelevant. To make switching trivial rather than a flag-juggling
exercise, introduce **named environments** instead of a single `SUPABASE_URL`:

- `local` -> `http://127.0.0.1:54321` (host) / `http://10.0.2.2:54321` (Android emulator)
- `staging` -> the wiped `Staff@PennHousing` ref
- `prod` -> the new project ref

**Android.** Keep the existing `localOrGradle()` helper and add a `SUPABASE_ENV` selector
that picks among `SUPABASE_URL_LOCAL` / `_STAGING` / `_PROD` (and the matching anon keys)
in `local.properties`. Existing explicit `-PSUPABASE_URL=` overrides keep working, and an
empty resolution still falls through to DemoData, so the Maestro flows are unaffected.

```bash
./gradlew :androidApp:assembleDebug -PSUPABASE_ENV=staging
```

**iOS.** Add `Local.xcconfig` / `Staging.xcconfig` / `Production.xcconfig` (gitignored)
feeding the existing `$(SUPABASE_URL)` / `$(SUPABASE_ANON_KEY)` in `Info.plist`, selected
per build configuration. No Swift changes; `AppConfig` already reads the plist.

**Secrets.** Extend [scripts/sync-secrets.sh](scripts/sync-secrets.sh) to materialize
`apps/mobile/local.properties` and the three xcconfigs, sourced from three Infisical
environments (`Development`, `Staging`, `Production`). One `pnpm sync:secrets` then
provisions web, Edge Functions, and both mobile platforms for all three targets.

### 2b. Residual case: device against the _local_ DB (fallback)

Hosted does not cover "I need this phone to hit an unpushed migration on my Mac." For
that, install Tailscale on the Mac and set `SUPABASE_URL_LOCAL` to the stable MagicDNS
name (`http://<machine>.<tailnet>.ts.net:54321`). It is stable across every network,
including ones with client isolation, and needs no rebuild when you move. Optional, but it
is about 15 minutes of work and permanently retires the problem.

Note: Supabase's local API binds to `127.0.0.1` by default. Serving it over Tailscale
needs `[api] ... ` bound to `0.0.0.0` in `supabase/config.toml` (or a Tailscale serve
proxy). Tailscale-only exposure keeps that safe.

---

## 3. Track 2: project topology

|              | Staging                                                 | Production                               |
| ------------ | ------------------------------------------------------- | ---------------------------------------- |
| Project      | `Staff@PennHousing` (`zrnvsxrtegbgpzdiflkt`), **wiped** | New: `Shift@PennHousing`                 |
| Rename to    | `Shift@PennHousing (staging)`                           | (n/a)                                    |
| Region       | us-west-2 (existing, fine)                              | **us-east-1** recommended (Philadelphia) |
| Postgres     | 17.6 (existing)                                         | 17.x (default)                           |
| Purpose      | Rehearse every step below, twice if needed              | Real data, real accounts                 |
| Reset policy | Freely resettable                                       | **Never** reset; backups + PITR          |

**Wiping staging.** The prototype schema (`user_profiles`, `semesters`, `schedule_slots`,
`shift_assignments`, `coverage_requests`, `float_assignments`, `allied_coverage`,
`notification_preferences`, `device_tokens`, `audit_log`, plus its own `houses`) collides
by name with the real schema, so it must go, not coexist. Procedure: take a manual backup
first, then `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` with the standard grants
restored, plus `DELETE FROM auth.users` for the 7 prototype profiles. Confirm before
running (this is irreversible for that prototype).

### R1. Postgres major-version mismatch (risk)

`supabase/config.toml` pins `major_version = 15`; both hosted projects are Postgres 17.
The 138 migrations have therefore never been exercised on 17. Recommendation: bump the
local `major_version` to 17, `supabase db reset`, and run the full suite (pgTAP, Vitest,
e2e-lifecycle) locally **before** touching staging. Staging is the second net, not the
first. See open item **O4**.

---

## 4. Track 3: schema deploy (identical on staging, then prod)

1. `supabase link --project-ref <ref>`.
2. **Enable `pg_cron` and `pg_net` before the first push.** Rather than a dashboard step
   that a future environment will forget, add a new migration
   `supabase/migrations/2026xxxxxxxxxx_enable_scheduling_extensions.sql`:

   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_cron;
   CREATE EXTENSION IF NOT EXISTS pg_net;
   ```

   It must sort **before** `20260527000005_schedule_builder.sql` (the earliest
   `cron.schedule` site) to have any effect. Since the existing migrations are already
   applied locally, the practical form is: a new timestamped migration that creates the
   extensions **and** re-runs the seven `cron.schedule` blocks idempotently
   (`cron.unschedule` + re-`schedule`, guarded). The existing `to_regprocedure` guards then
   become belt-and-braces rather than the only line of defence.

3. `supabase db push`.
4. **Verify the crons actually exist**: `SELECT jobname, schedule FROM cron.job ORDER BY 1;`
   Expect the orchestrator tick, `deliver_pending_notifications`, swap expiry, permanent
   swap expiry, break-claim timing, and `apply-due-house-transfers`. An empty result means
   L1 bit you.
5. `supabase gen types typescript --linked > /tmp/remote.types.ts` and diff against
   `packages/shared/src/database.types.ts`. Any diff is schema drift; stop and reconcile.
6. Set the pg_net settings the notification path reads:

   ```sql
   ALTER DATABASE postgres SET app.supabase_url = 'https://<ref>.supabase.co';
   ALTER DATABASE postgres SET app.service_role_key = '<service role key>';
   ```

---

## 5. Track 4: the data

**Governing principle: migrate authored inputs, regenerate derived outputs.**

The four runtime config tables (`operating_profiles`, `staffing_patterns`,
`operating_calendar`, `float_routing`) and every `shift_blocks` row are _derived_. They are
produced by `apply_compiled_season` from the authoring tables. Copying them would import
local block UUIDs and desynchronise from the compiler. Instead we copy the authoring rows
and run the RPC online, then attach assignments by natural key. This is exactly the pattern
`supabase/seeds/harnwell-real-workers.sql` already uses (assignments linked by
`(house_id, block_start_at)` because block ids are random per generation).

### Deliverable

A new committed, ordered, idempotent seed set at `supabase/seeds/prod/`, generated from
local by a new `scripts/gen-prod-seed.sql` (mirroring the existing
[scripts/gen-harnwell-seed.sql](scripts/gen-harnwell-seed.sql)). Committing it means
staging and prod receive byte-identical data, the payload is reviewable in a diff, and the
whole load is repeatable. This is strictly better than piping `pg_dump`.

### Tier 1: `01-reference.sql`

- 14 `houses` rows (13 staffable + `allied-house`), with `desk_phone` and `is_staffable`.
  `launch_state` stays `pre_launch` for all, including Harnwell (flipped at cutover, §8).
- 13 `system_config` rows, verbatim except `project_administrator_user_id`, which is
  written in Tier 2 once a prod admin exists.
- Duty-phone rows (`smod_duty_phone` and friends), Allied contact rows, the
  `offhours_ladder_enabled` switch.

### Tier 2: `02-people.sql`

- 11 `auth.users` rows with `encrypted_password` carried verbatim, so passwords survive
  (per your decision) and `user_id`s stay identical, which keeps every downstream FK and
  the 6,123 assignments linkable without remapping.
- 11 `public.users` rows, `user_roles` (1 hm, 1 rsm, 1 sm+sw, 8 sw),
  `user_house_memberships` (one open-ended row each, dated to the real hire date so
  `membership_house_for_date` is correct for forward-looking surfaces).
- One `admin` account (open item **O1**), then
  `UPDATE system_config SET config_value = '<admin uuid>' WHERE config_key =
'project_administrator_user_id';`. Without this the urgent HMOD-for-Allied terminal
  contact degrades to a `RAISE WARNING`.

> **Flagged, not blocking.** Dev-grade passwords will be guarding a production system. You
> chose to carry them and I am implementing that. Recommendation: rotate them (a single
> bulk password-reset email) before the launch gate opens to real users. See **O8**.

### Tier 3: `03-season.sql`

- `operating_seasons` (the Summer 2026 row), 13 `season_house_windows` with their
  `weekday_bands` / `weekend_bands` jsonb, and `season_float_windows`. `created_by` is
  repointed at the prod admin.
- Then run `apply_compiled_season` **dry-run first**, read the impact counters, then apply.
  This materialises all four runtime config tables and generates blocks for **all 13
  houses**, satisfying your "full config incl. their summer windows" answer. No workers, no
  assignments anywhere except Harnwell.
- Note: the RPC only reconciles blocks with `block_start_at > app_now()`. Blocks earlier
  than "now" are not generated by it. Handled in Tier 4.

### Tier 4: `04-harnwell-schedule.sql`

- The `scheduling_periods` row for the summer period (its `profile_name` matches `s_%`,
  which the widened check constraint admits).
- Explicit block creation for any Harnwell range the season compiler will not regenerate:
  the historical `2026-06-01 -> now` portion, and the `2026-08-21 -> 2026-09-07` tail that
  falls outside the Summer 2026 end date (open item **O2**).
- 6,123 `shift_block_assignments`, attached by `(house_id, block_start_at)` natural key.
- Post-load assertion: assignment count matches, no orphans, and
  `enforce_block_occupied_headcount` reports no violations.

### Tier 5: `05-kb.sql`

- 3 `kb_documents`, their chunks, and their pgvector embeddings dumped as literals.
  Preserving the vectors avoids re-embedding cost and guarantees identical retrieval
  behaviour. (Re-embedding online is the fallback if the dump proves unwieldy.)

### Explicitly NOT migrated

- The other 112 local users and every fixture seed (`manual-test.sql`, `seasons-test.sql`,
  `demo_break.sql`, `harnwell-summer-sandbox.sql`, `seasons-cast.ts`).
- Transactional history: `float_assignments`, `swap_requests`, `notifications`,
  `pending_notification_deliveries`, `hmod_urgent`, audit rows. Prod starts with a clean
  operational ledger.
- `dev_sim_clock` offset (must be 0 in prod, see §7).
- `draft_*` schedule-builder rows (regenerate in the builder if wanted).

---

## 6. Track 5: runtime services

1. **Edge Functions**: `supabase functions deploy` for all 26.
2. **Function secrets** via `supabase secrets set`:
   - `CLAUDE_AI_CHATBOT_DESK_ASSISTANT`
   - `VOYAGE_API_KEY`
   - `FIREBASE_SERVICE_ACCOUNT_JSON`
     Per the AGENTS.md dedicated-key rule, prod gets **its own** keys, not the dev ones, so
     per-environment cost stays attributable. Staging may reuse the dev keys. See **O6**.
3. **Web env** (`apps/web`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `CLAUDE_AI_CREATE_SCHEDULE_KEY`,
   `CLAUDE_AI_CHATBOT_UPLOAD_CHUNKER`, `CLAUDE_AI_CHATBOT_PROPOSE`, `VOYAGE_API_KEY`, one
   set per environment, driven from Infisical.
4. **Firebase push** (currently never wired up anywhere):
   - Create a Firebase project; register the Android app (`com.pennhousing.shift`) and the
     iOS bundle id.
   - Android: drop in `google-services.json` and **apply the
     `com.google.gms.google-services` plugin**, which
     [AGENTS.md](AGENTS.md) records as deliberately not applied today. That is a real code
     change gated on having the file.
   - iOS: add the Firebase SPM package, upload the APNs auth key to Firebase. The
     `#if canImport(FirebaseMessaging)` guard in `AppDelegate` then activates.
   - Both clients already POST the FCM token to `register-push-token`.
5. **Auth configuration**:
   - `site_url` -> the deployed web URL (needed by the GoTrue recovery-onboarding flow from
     the staggered-launch work).
   - **SMTP**: Supabase's built-in sender is rate-limited to a handful of emails per hour
     and is not usable for onboarding or password resets. Configure a real provider
     (Resend or Postmark). See **O7**.
   - Email templates for recovery/onboarding.

---

## 7. Track 6: production hardening

**P0. Close the confused-deputy exposure (L2).** Audit every `SECURITY DEFINER` function
for lingering default `anon` / `authenticated` EXECUTE grants and revoke them explicitly.
Roughly 37 remain. This blocks prod carrying real accounts, and it is best fixed as a
migration so both environments and local converge.

**P1. Sim clock must be inert.** Assert `SELECT app_now() = now();` on prod, confirm the
offset row is 0, and revoke the setter from every non-superuser role. A non-zero offset in
prod would silently misfire every escalation deadline.

**P2. Lock out the dev harness surfaces.** The web "Run orchestrator now" control and the
mobile SimClock UI must be compiled out or env-gated in prod builds.

**P3. Advisors.** Run the Supabase security and performance advisors on both projects and
work the findings, especially missing RLS on any new table and unindexed FKs at Harnwell's
row counts.

**P4. Backups.** Prod on the paid plan gets daily backups; enable **PITR**. Take an
explicit snapshot immediately after schema push and again after the seed load, so a bad
load can be rewound without a full rebuild.

**P5. Never `db reset` prod.** There is no reset safety net online. The AGENTS.md
scoped-destructive-SQL rule (SELECT count(\*) first, verify the WHERE clause against the
real schema) becomes mandatory rather than advisory.

---

## 8. Sequence

**Phase A. Local prerequisites** (before touching any hosted project)

1. Bump `major_version` to 17, `supabase db reset`, run pgTAP + Vitest + e2e-lifecycle. (**O4**)
2. Write the `pg_cron` / `pg_net` migration (§4 step 2).
3. Fix the confused-deputy grants (P0).
4. Write `scripts/gen-prod-seed.sql`, generate `supabase/seeds/prod/01..05`.
5. Implement the mobile named-environment config (§2a).

**Phase B. Staging rehearsal** 6. Back up, then wipe `Staff@PennHousing`; rename it. 7. Run §4 (schema) end to end, including the cron verification. 8. Run §5 (data) end to end. Record the actual runtime of the 6,123-assignment load. 9. Run §6 (Edge Functions, secrets, push, auth). 10. Verify (§9). Fix, and **re-run the whole thing from step 6** until it is clean twice in
a row. That repeatability is the entire point of having staging.

**Phase C. Production** 11. Create the new project (region, plan, PITR). 12. Replay steps 7 to 9 verbatim from the committed seeds. 13. Run §7 hardening; snapshot. 14. Smoke-test with one real account before telling anyone.

**Phase D. Clients** 15. Build and install device apps against prod. Confirm login, My Shifts, Open Shifts,
House grid, and a push notification arriving on a real handset. 16. Deploy the web app (open item **O5**).

**Phase E. Go live** 17. Flip `harnwell.launch_state` to launched; the other 12 stay `pre_launch`. 18. Rotate passwords if you take that recommendation (**O8**). 19. Promote the deploy-time requirements into BSpec §14 and ARCHITECTURE.md, in the same
commit (AGENTS.md spec-sync rule).

---

## 9. Verification checklist (run on staging, repeat on prod)

Schema

- [ ] `cron.job` contains all expected jobs.
- [ ] Generated types match `packages/shared/src/database.types.ts` exactly.
- [ ] `app_now() = now()`.
- [ ] Security advisor: zero criticals.

Data

- [ ] 14 houses; exactly one non-staffable (`allied-house`).
- [ ] 11 users, roles exactly as tabled in §0.
- [ ] `project_administrator_user_id` resolves to an active user.
- [ ] Summer 2026 season present; `operating_calendar` covers Jun 1 to Aug 20 for 13 houses.
- [ ] Harnwell assignment count equals 6,123; zero orphaned assignments.
- [ ] No `enforce_block_occupied_headcount` violations.
- [ ] Weekly hours for each of the 11 match local for the same week.

Behaviour

- [ ] pgTAP suite passes against the hosted DB (needs `pgtap` enabled; note the raw-psql
      grant limitation recorded in `reference_pgtap_raw_psql_grants`).
- [ ] Log in as a real worker on web and on a physical device.
- [ ] Claim an open shift; it disappears for other users in realtime.
- [ ] Drop a shift; it appears in the open feed.
- [ ] An orchestrator tick runs on schedule and writes nothing unexpected.
- [ ] A push notification lands on a real handset.
- [ ] Desk Assistant answers a KB-grounded question.

---

## 10. Open items (need your answer before Phase A completes)

| #       | Item                                                                                                                                                                 | Recommendation                                                                                                |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **O1**  | Who is the prod `admin` / `project_administrator_user_id`? None of the 11 has the `admin` role.                                                                      | You (Andrew) as `admin`; keep Mitchelle as `hm`.                                                              |
| **O2**  | Harnwell has blocks to **2026-09-07** but Summer 2026 ends **2026-08-20**. Extend the season, add a follow-on season, or carry explicit block creation for the tail? | Add a follow-on season for Aug 21 to Sep 7 so config owns every block and nothing lives outside the compiler. |
| **O3**  | Migrate the full Jun 1 history, or only today (Jul 26) forward?                                                                                                      | Full range. Hours history and the week navigator both read backwards.                                         |
| **O4**  | Postgres 15 (local) vs 17 (hosted).                                                                                                                                  | Bump local to 17 and re-run the suite before staging.                                                         |
| **O5**  | Web app has no deploy config. Admin surfaces (builder, `/admin/*`, KB upload, force-trigger) are web-only, and auth emails need a real `site_url`.                   | Vercel, two deployments. Needed before Phase E.                                                               |
| **O6**  | Prod API keys: 4 Anthropic + 1 Voyage.                                                                                                                               | New dedicated prod keys (AGENTS.md rule); staging reuses dev keys.                                            |
| **O7**  | SMTP provider for auth email.                                                                                                                                        | Resend.                                                                                                       |
| **O8**  | Dev passwords will guard prod.                                                                                                                                       | Bulk reset before the launch gate opens.                                                                      |
| **O9**  | Prod region.                                                                                                                                                         | us-east-1.                                                                                                    |
| **O10** | Cost: a second project plus PITR on the Pro plan.                                                                                                                    | Confirm before I create the project.                                                                          |

---

## 11. What could go wrong

| Risk                                    | Mitigation                                                               |
| --------------------------------------- | ------------------------------------------------------------------------ |
| Crons silently absent (L1)              | Explicit extension migration + `cron.job` assertion in the checklist     |
| Anon key reaches definer functions (L2) | P0 grant audit before prod holds real data                               |
| Migrations never run on PG17            | O4: bump local first, then staging, then prod                            |
| Assignment relink misses blocks         | Natural-key join plus a hard count assertion; rehearsed twice on staging |
| Orchestrator fires on half-loaded data  | Load with crons unscheduled, re-schedule only after the checklist passes |
| Prod mistakenly reset                   | No reset ever; PITR on; snapshots at each phase boundary                 |
| Push never tested before launch         | Phase D requires a real handset receiving a real push                    |
