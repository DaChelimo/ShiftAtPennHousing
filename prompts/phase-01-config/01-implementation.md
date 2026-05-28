# Phase 01 — Config Layer: Implementation

## Session Metadata

|                   |                                                                   |
| ----------------- | ----------------------------------------------------------------- |
| **Model**         | Claude Opus 4.7 (`claude-opus-4-7`)                               |
| **Interface**     | Claude Code CLI                                                   |
| **Thinking mode** | Standard                                                          |
| **TDD split**     | N/A — data-only phase, schema validation tests written inline     |
| **Note**          | No cross-model split. Schema + seed + pgTAP tests in one session. |

---

## Prompt

You are implementing Phase 01: Configuration Layer.

Branch: `phase-01-config` (off main, after phase-00 is merged).

Sources of truth (read in full before writing any code):

- ARCHITECTURE.md §2.1 through §2.10 (the 10 configuration table layers)
- ARCHITECTURE.md §1.1 (Configuration Over Code principle)
- ARCHITECTURE.md §1.6 (Time Zone — all timestamps must be `timestamptz`, America/New_York)
- ARCHITECTURE.md §3.10 (system_config table)
- BEHAVIORAL_SPECIFICATION.md §1.1 (13 houses — Harnwell, Quad, 11 single-staff)
- BEHAVIORAL_SPECIFICATION.md §3.2 (operating profiles and their exact rule values)
- BEHAVIORAL_SPECIFICATION.md §3.3 (staffing patterns per profile and house)
- AGENTS.md

---

### Deliverables

**1. Database migrations** in `supabase/migrations/` (one file per table, timestamped).

Create tables in this order (respecting FK dependencies):

```
houses
operating_profiles
operating_calendar
staffing_patterns
float_routing
weekly_cap_overrides
hmod_rotor
hm_leave
ack_cadence_config
break_periods
scheduling_periods
system_config
```

Each migration must:

- Enable RLS immediately (`ALTER TABLE x ENABLE ROW LEVEL SECURITY;`)
- Add a service-role bypass policy: `CREATE POLICY "service-role bypass" ON x TO service_role USING (true) WITH CHECK (true);`
- Add a comment like: `-- RLS: user-scoped policies added in phase-{N} when {feature} is introduced`
- Be reversible (include a `-- rollback` comment block or a separate down migration)

Column requirements to verify from the spec:

- `operating_profiles.escalation_chain`: `jsonb NOT NULL`
- `staffing_patterns.block_headcounts`: `jsonb NOT NULL` (compressed range format)
- `hm_leave.status`: enum `('active', 'cancelled_early')`
- `system_config.value_type`: enum `('integer', 'interval', 'time_of_day', 'enum')`
- `break_periods.break_type`: enum `('thanksgiving', 'fall_break', 'spring_break', 'spring_fling', 'winter_break', 'other')`
- `scheduling_periods.preference_deadline`: `timestamptz NULLABLE` (null until SM sets it)
- `scheduling_periods.published_at`: `timestamptz NULLABLE`
- All `*_at` columns: `timestamptz`, never `timestamp`

**2. Seed data** in `supabase/seed.sql`.

Houses (13 rows):

```sql
-- Harnwell, Quad, and 11 placeholders
-- NOTE: real house names are TODO before launch (see AGENTS.md)
INSERT INTO houses (id, name) VALUES
  ('harnwell', 'Harnwell'),
  ('quad', 'Quad'),
  ('house-03', 'House-03'),
  ('house-04', 'House-04'),
  ('house-05', 'House-05'),
  ('house-06', 'House-06'),
  ('house-07', 'House-07'),
  ('house-08', 'House-08'),
  ('house-09', 'House-09'),
  ('house-10', 'House-10'),
  ('house-11', 'House-11'),
  ('house-12', 'House-12'),
  ('house-13', 'House-13');
```

Operating profiles (3 rows with exact values from ARCHITECTURE.md §2.2):

- `regular_school_year`: shift bounds 08:00–24:00, 20h soft cap, sm_built, float_enabled=true, escalation_chain with broadcast@-3h + float_lookup@-2h + hmod_notify_allied@-2h on failure
- `winter_break`: 08:00–24:00, 40h hard cap, claim_based, float_enabled=false, escalation chain broadcast@-3h + hmod_notify_allied@-2h (no float step)
- `short_break`: 08:00–24:00, 40h hard cap, claim_based, float_enabled=true, same escalation as regular_school_year, claim_phase_open=-14d, alert=-3d, close=-1d

Staffing patterns per BEHAVIORAL_SPECIFICATION.md §3.3:

- regular_school_year × Harnwell: headcount 2, 08:00–24:00, all days
- regular_school_year × Quad: headcount 3, 08:00–24:00, all days
- regular_school_year × each of 11 single-staff houses: headcount 1, 08:00–24:00, all days
- winter_break × Harnwell: headcount 1, 08:00–24:00, all days
- winter_break × all other 12 houses: NO ROW (closed = no row)
- short_break × Harnwell: headcount 2
- short_break × Quad: headcount 3
- short_break × each of 11 single-staff houses: headcount 1

Float routing (from ARCHITECTURE.md §2.4):

- regular_school_year: Quad → all 11 single-staff houses (precedence 1), Harnwell → all houses including Quad (precedence 2)
- short_break: same as regular_school_year
- winter_break: zero rows

system_config (from ARCHITECTURE.md §3.10 key list):

```
drop_horizon_days           = 30
min_float_chunk_blocks      = 2
float_retention_days        = 14
shift_block_minutes         = 30
shift_swap_expiry_anchor    = 'T-3h'
float_swap_expiry_hours     = 24
permanent_swap_expiry_days  = 7
hm_working_hours_start      = '08:00'
hm_working_hours_end        = '17:00'
no_ack_trigger_offset_minutes = 5
ack_deadline_offset_minutes = 10
```

**3. pgTAP schema validation tests** in `supabase/tests/phase-01-schema.sql`.

Tests must cover:

- All 12 tables exist (including `houses`)
- Every column from §2.1–§2.10 and §3.10 exists with correct type
- `timestamptz` used for all timestamp columns (no plain `timestamp`)
- `jsonb` used for `escalation_chain`, `block_headcounts`
- RLS is enabled on every table
- Service-role bypass policy exists on every table
- FK relationships are correctly defined
- Seed data: 13 houses, 3 profiles exist
- Profile values match spec exactly (e.g., `regular_school_year` has `float_enabled = true`)

**4. Update AGENTS.md.**
Under "Phase-Specific Notes" append:

```
- [Phase 01] Houses: Harnwell and Quad have special rules throughout.
  11 single-staff houses use placeholder IDs house-03..house-13 — real names TODO.
- [Phase 01] RLS: all tables have service-role bypass; user-scoped policies come later.
- [Phase 01] staffing_patterns stores compressed jsonb ranges.
  Application layer expands them at read time.
```

**5. Regenerate shared types.**

```bash
supabase gen types typescript --local > packages/shared/src/database.types.ts
```

---

### What you are NOT to do

- No application logic, Edge Functions, or SQL functions beyond what migrations need.
- No `users` table, no `shift_blocks`, nothing beyond the config tables listed.
- No indexes beyond PKs and FKs (performance work comes later).
- Do not touch `BEHAVIORAL_SPECIFICATION.md`, `ARCHITECTURE.md`, or `.claudeignore`.

---

### Verification checklist before committing

- [ ] `supabase db reset` reapplies all migrations cleanly on a fresh DB.
- [ ] `supabase test db` runs pgTAP — all tests pass.
- [ ] `packages/shared/src/database.types.ts` is generated and well-formed TypeScript.
- [ ] All 12 tables visible in Supabase Studio (local).
- [ ] Seed data visible: 13 houses, 3 profiles.

---

### Commit

```
git commit -m "phase-01: config layer (houses + 10 config tables), seeds (3 profiles, 13 houses, staffing patterns, float routing, system_config), RLS placeholders, pgTAP schema tests"
```
