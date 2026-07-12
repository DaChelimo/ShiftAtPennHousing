# Float / Escalation Edge Case Test Matrix — one-command loaders

Idempotent, click-free staging for the 12 edge cases in the Notion matrix:
**Float/Escalation Edge Case Test Matrix**
(https://app.notion.com/p/390575b722ec8174b0b5e32a50d14683).

Each case owns its own date, so you never hand-build shifts or fiddle the clock.
One command stages the whole world and parks the simulated clock at the exact
step-fire moment; then you just open the app and click, or add `--tick` to fire
the orchestrator and print the outcome with no clicking at all.

## Prerequisites

```bash
pnpm db:reset:manual                       # once: 3 houses + period + blocks
docs/float-testing/cases/run.sh 01 --reset # --reset rebuilds source crews/rotor (setup.sql)
```

Local Supabase must be running (`supabase start`). The apps are only needed if
you want to click through; `--tick` verifies straight against the DB.

## Usage

```bash
docs/float-testing/cases/run.sh <case> [--tick] [--reset]
```

- `<case>`  one of `01 02 03 04 05 06 07a 07b 08 09 10 11 12`
- `--tick`  also fire the orchestrator once and print floats + Allied alerts
            (no-click self-verify). Otherwise click "Run orchestrator now" in
            the web dev-clock card.
- `--reset` run `setup.sql` first (rebuild Quad/Harnwell crews, HMOD rotor,
            silence placeholder houses). Use it the first time and any time the
            source crews look wrong.

The clock is **shared** (web + orchestrator + worker app all read `app_now()`),
so after staging, the worker app catches up when you foreground it.

## How the staging works (why it's clean)

The manual-test DuBois desk is claim-based and mostly empty, so a naive "drop a
shift" would leave the orchestrator escalating thousands of vacant blocks at
once. Each loader instead **crews the destination house to its headcount all day
and then carves only the target span** (`ft_crew` + `ft_vacate` in
`_helpers.sql`), so exactly one gap escalates. Sources are shaped per case
(`ft_crew` to a floor, `ft_add_worker` for a partial spare). The clock is parked
with `ft_park(target)` = store `target - now()` as the `dev_sim_clock` offset.

## House remap (the Notion page names DuBois loosely)

Real headcounts in the seed: **DuBois = 1, Harnwell = 2, Quad = 3**; placeholder
houses `house-03..13` have **no generated blocks**. So some cases are remapped to
the house that actually has the right shape (noted per row).

## The 12 cases (all verified via `--tick` on 2026-06-30)

| # | Cmd | Date / clock | What is staged | Expected (verified) |
|---|-----|--------------|----------------|---------------------|
| 1 | `run.sh 01` | Thu Jun 25, 6:00 PM | DuBois empty 8-10 PM; Quad crewed 3 | Quad worker floats the full 2h to DuBois; Quad stays ≥1; floater's Quad seat reopens |
| 2 | `run.sh 02` | Fri Jun 26, 6:00 PM | DuBois empty 8-10 PM; Quad sparable only 8:00-8:30; Harnwell no spare | **Single block IS floated** (MIN_FLOAT_CHUNK_BLOCKS=1); remainder escalates to Allied on later ticks. See note ⚠️ |
| 3 | `run.sh 03` | Mon Jun 29, 6:00 PM | **Quad** 2-of-3 present (remap: DuBois is single-staff) | No escalation at all; the short seat stays passively claimable |
| 4 | `run.sh 04` | Tue Jun 30, 6:00 PM | Harnwell desk empty; Quad has spare | No inbound float to Harnwell (training ban); straight to Allied (HMOD) |
| 5 | `run.sh 05` | Wed Jul 1, 6:00 PM | DuBois empty; Quad no spare (forces p2) | A **Harnwell** worker floats out to DuBois (outbound allowed) |
| 6 | `run.sh 06` | n/a | (invariant only) | Single-staff houses never source; proven by a routing query + "no placeholder blocks". Nothing to click |
| 7a | `run.sh 07a` | Thu Jul 2, 10:00 AM | DuBois empty midday; sources unavailable → Allied | Alert routes to the house **RSM** (diana-dubois) — in HM hours |
| 7b | `run.sh 07b` | Thu Jul 2, 6:00 PM | DuBois empty evening; sources unavailable → Allied | Alert routes to the **HMOD** on duty (hana-quad) — outside HM hours |
| 8 | `run.sh 08` | Mon Jul 6, 7:50 PM | DuBois empty one block 8:00-8:30; floater exists | Float lookup **skipped** (T-15m DOA guard); straight to Allied |
| 9 | `run.sh 09` | Tue Jul 7, → 7:45 PM | Pre-armed: a Quad float was assigned, left un-acked | Next tick voids it (`float_no_acknowledgment`) and escalates to Allied |
| 10 | `run.sh 10` | Wed Jul 8, 6:00 PM | Empty desk passes its T-2h lock, then gets re-staffed | `coverage_locked_at` stays set; block not reopened to pickup (one-way, §5.5) |
| 11 | `run.sh 11` | n/a | (advanced — documented) | Earliest-start gap wins the shared floater; loser → Allied; same worker may be *offered* to both gaps in-tick. Needs a 2nd block-having destination to stage live |
| 12 | `run.sh 12` | Fri Jul 10, 6:00 PM | Off-hours gap; rotor emptied; admin set | Urgent alert routes to `project_administrator_user_id`; unset it → RAISE WARNING, no row |

## ⚠️ Case 2 — reconciled against current code

The Notion page (captured 2026-06-30) expects "no float → Allied" for a sub-hour
spare, from the **old** 2-block floor. Current code has
`MIN_FLOAT_CHUNK_BLOCKS = 1` (`packages/core/src/float-lookup/index.ts:6`,
lowered 2→1 on 2026-06-30), so the single sparable block **is** floated and only
the uncovered remainder escalates. Loader `02` asserts this **current** behavior
(your call). The remainder → Allied is a multi-tick effect: each block reaches
its T-2h float step at its own time, so after the first tick you advance the
clock (e.g. +30m) and tick again to watch the rest route to Allied. Update the
Notion row to match, or file a code change if the 2-block floor was intended.

## Notes / caveats

- **Case 10** locks one block per tick (each block locks at its own T-2h). The
  loader arms the first gap block and proves it stays locked after re-staffing;
  to lock the whole gap, tick again at each later T-2h.
- **Case 11** can be staged live only after generating blocks for a second
  Quad-destination house (e.g. `house-03`); the seed leaves placeholders
  block-less. The in-tick reservation behavior is described in the row above.
- **Idempotency:** every case begins with `ft_clear()` (all float state, locks,
  notifications, clock → real time) and re-crews its own date, so re-running any
  case — or a different case — always lands in the same clean state. A case's
  per-date source shaping persists on its own date until the next `--reset`;
  other dates are unaffected.
- **Reset to real life:** `run.sh <any> --reset` or
  `psql ... -f docs/float-testing/reset.sql` clears everything and sets the
  clock back to real time.

## Files

- `run.sh` — the loader / dispatcher (one command per case)
- `_helpers.sql` — `ft_*` SQL helpers (park clock, clear state, crew, vacate, rotor)
- `../setup.sql` / `../reset.sql` — base crews + between-run reset (unchanged
  except a null-safety guard for the claim-based DuBois desk)
- `../GUIDE.md` — the original click-by-click manual walkthroughs
