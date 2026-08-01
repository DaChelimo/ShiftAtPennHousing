# Go-Live Runbook

Companion to `PLAN.md`. That document is the reasoning; this is the sequence of commands.
Decisions were settled 2026-07-26; the seed set is generated and committed.

**Load order is not negotiable.** Tiers 04 to 06 are block-scoped and relink by
`(house_id, block_start_at)`, so they must load _after_ `apply_compiled_season` has
generated the blocks. Loading them earlier silently inserts nothing.

---

## What ships

| Tier | File                       | Contents                                                                      | Rows       |
| ---- | -------------------------- | ----------------------------------------------------------------------------- | ---------- |
| 1    | `01-reference.sql`         | 14 houses (13 staffable + `allied-house`), 7 `system_config`, 4 routing rules | 25         |
| 2    | `02-people.sql`            | 24 accounts (`auth.users` + identities + profiles + roles + memberships)      | 24         |
| 3    | `03-season.sql`            | Summer 2026 season, 13 house windows, 1 float window, 1 scheduling period     | 16         |
| 4    | `04-harnwell-schedule.sql` | Harnwell assignments through Aug 20, normalized                               | 5,227      |
| 5    | `05-preferences.sql`       | Summer 2026 submissions + per-worker hour targets                             | 4,347 + 18 |
| 6    | `06-kb.sql`                | 3 KB documents, 97 chunks with pgvector embeddings verbatim                   | 100        |

**The 24 accounts.** 11 Harnwell (10 workers + HM Mitchelle Majeski), 9 Gregory
(8 workers + SM Eleni), 2 Gregory placeholders (Hana `hm`, Diana `rsm`), the project
administrator, and the Allied pseudo-account.

**Deliberately excluded.** 99 fixture users (Alice Du Bois and friends), all transactional
history (floats, swaps, notifications, step status), 53 Desk Assistant chat transcripts,
the 456 Harnwell blocks from Aug 21 to Sep 7 (200 of them staffed), and every derived
config table.

---

## Two things that will bite if ignored

**1. Publish Gregory's schedule BEFORE launching Gregory.** Gregory migrates with zero
assignments by design. Measured: launching it empty puts **864 vacant seats** into the
escalation chain over 30 days. Every one broadcasts, then pulls a float lookup that can
drag Harnwell workers to Gregory, then pages Allied, addressed to Hana Gregory, who is a
placeholder with an undeliverable address. Generate and publish first, launch second.

**2. Gregory's HM and RSM are not real people, and 9 Gregory emails are placeholders.**
Fine for staging. Before the production load, replace the 9 `firstname@upenn.edu`
addresses with deliverable ones and decide who really holds Gregory `hm` / `rsm`, because
production is reset-only and every account needs to receive a recovery email.

**3. Check the project's compute region against where users actually are before you seed
it.** The 2026-04 project was created in `us-west-2`; every worker and manager is on the US
east coast. Cost: p50 130ms per database round trip with a fat tail (max measured 977ms),
against p50 49ms/max 98ms once moved to `us-east-1` — confirmed via `EXPLAIN ANALYZE`
staying flat at ~0.07ms server-side both before and after, so it was pure geography, not a
compute-tier difference. This is a config choice you make once at project creation and pay
for on every single query forever after. Set it correctly the first time; see
`docs/performance/WEB_NAVIGATION_PERF.md` for the full measurement.

---

## Phase A. Local prerequisites

```bash
supabase login
```

```bash
./scripts/gen-prod-seed.sh
```

Regenerates `supabase/seeds/prod/01..06` from local. Runs entirely inside rolled-back
transactions, so it never modifies your local database. Re-run it any time local changes.

---

## Phase B. Staging

Staging is `Staff@PennHousing` (`zrnvsxrtegbgpzdiflkt`). It currently holds an obsolete
prototype schema that collides by name with the real one, so it must be wiped, not merged.

**Take a backup in the Supabase dashboard before this. The wipe is irreversible.**

```bash
supabase link --project-ref zrnvsxrtegbgpzdiflkt
```

```bash
supabase db push
```

Then verify the crons actually exist. Hosted Supabase does not enable `pg_cron` / `pg_net`
by default, and every `cron.schedule` call site is wrapped in a guard that silently skips
when the extension is absent. An empty result here means the orchestrator will never run.

```bash
supabase db execute --file /dev/stdin <<'SQL'
SELECT jobname, schedule FROM cron.job ORDER BY 1;
SQL
```

Load the seed tiers in order, pausing after tier 3 for the season apply:

```bash
for f in 01-reference 02-people 03-season; do supabase db execute --file supabase/seeds/prod/$f.sql; done
```

Dry-run the season compile and read the impact counters before applying:

```bash
supabase db execute --file /dev/stdin <<'SQL'
SELECT apply_compiled_season('a0000000-0000-4000-8000-00000000000b', season_id, '{}'::jsonb, true) FROM operating_seasons;
SQL
```

Apply it, then load the block-scoped tiers:

```bash
for f in 04-harnwell-schedule 05-preferences 06-kb; do supabase db execute --file supabase/seeds/prod/$f.sql; done
```

Deploy functions and secrets:

```bash
supabase functions deploy
```

```bash
supabase secrets set CLAUDE_AI_CHATBOT_DESK_ASSISTANT=... VOYAGE_API_KEY=... FIREBASE_SERVICE_ACCOUNT_JSON="$(cat firebase.json)"
```

---

## Phase C. Verify staging

```bash
supabase db execute --file /dev/stdin <<'SQL'
SELECT 'houses',        count(*) FROM houses
UNION ALL SELECT 'accounts',     count(*) FROM users
UNION ALL SELECT 'harnwell seats', count(*) FROM shift_block_assignments a JOIN shift_blocks b USING (block_id) WHERE b.house_id='harnwell'
UNION ALL SELECT 'preferences',  count(*) FROM preferences
UNION ALL SELECT 'kb chunks',    count(*) FROM kb_chunks
UNION ALL SELECT 'orphan seats', count(*) FROM shift_block_assignments a LEFT JOIN shift_blocks b USING (block_id) WHERE b.block_id IS NULL
UNION ALL SELECT 'sim clock inert', (SELECT count(*) FROM dev_sim_clock WHERE offset_seconds <> 0);
SQL
```

Expect 14 / 24 / 5,227 / 4,347 / 97 / **0 orphans** / **0 non-zero clock**.

Then, by hand: log in as a real Harnwell worker, confirm My Shifts matches local for the
same week, claim an open shift and watch it vanish for another session.

---

## Phase D. Production

Do not start until staging has run clean twice from a fresh wipe.

Regenerate the people tier without passwords, so every production account must go through
recovery onboarding:

```bash
PROD_SEED_NO_PASSWORDS=1 ./scripts/gen-prod-seed.sh
```

**Before this load:** fix the 9 Gregory placeholder emails, settle Gregory's real HM/RSM,
configure SMTP (recovery mail is the only way in), and close the confused-deputy grant
exposure recorded as P0 in `PLAN.md` (roughly 37 `SECURITY DEFINER` functions still carry
default `anon` EXECUTE grants).

Then replay Phase B against the new project ref, and re-run Phase C.

---

## Phase E. Cutover, in this order

1. Build and publish the Gregory schedule from the web builder (AI generate, review, publish).
2. Verify Gregory has assignments: a non-zero count here is the gate for step 4.
3. Enable the launch gate.
4. Flip **Harnwell and Gregory** live. Every other house stays `pre_launch`.

```bash
supabase db execute --file /dev/stdin <<'SQL'
SELECT count(*) AS gregory_assignments FROM shift_block_assignments a
  JOIN shift_blocks b USING (block_id) WHERE b.house_id='gregory' AND a.user_id IS NOT NULL;
SQL
```

```bash
supabase db execute --file /dev/stdin <<'SQL'
INSERT INTO system_config (config_key, config_value, value_type)
VALUES ('staggered_launch_enabled','true','enum')
ON CONFLICT (config_key) DO UPDATE SET config_value='true';
UPDATE houses SET launch_state='live', launched_at=now() WHERE id IN ('harnwell','gregory');
SQL
```

Do not run the second block until the first returns a non-zero count.

---

## Rollback

Snapshot before the schema push and again after the seed load. Every seed file is
idempotent and `ON CONFLICT` guarded, so a partial load is safe to re-run. There is no
`db reset` on a hosted project: recovery is PITR or a snapshot restore, which is why the
snapshots are not optional.
