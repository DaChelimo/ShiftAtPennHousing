# Fall 2026 Du Bois preference package

Generated board for Du Bois, produced by the persona generator, alongside the Harnwell
pilot package. Contract: [`../PERSONA_SPEC.md`](../PERSONA_SPEC.md).

**Nothing in this directory has been applied to any database.** Both steps below are held
for sign-off, same as [`../fall-2026-harnwell/`](../fall-2026-harnwell/).

|               |                                                                             |
| ------------- | --------------------------------------------------------------------------- |
| Target        | Shift (`nctfnufnsczyhkcidlmd`), production                                  |
| Season        | Fall 2026, `fa112026-0000-4000-8000-000000000001` (same season as Harnwell) |
| Period        | same uuid (`apply_compiled_season` materializes `period_id == season_id`)   |
| Template week | 2026-08-24 (Mon) to 2026-08-30 (Sun), 224 blocks, headcount 1               |
| Cap           | 20h soft                                                                    |
| Seed          | `dubois-fall-2026-v1`                                                       |
| Checksum      | `60f7cbf77387b78d`                                                          |

## Contents

| File                     | What it is                                                             |
| ------------------------ | ---------------------------------------------------------------------- |
| `season.sql`             | Proposal to add Du Bois to the existing Fall 2026 season. Not applied. |
| `generate.ts`            | Reproducible generator entry point. Pure, offline.                     |
| `package.json.generated` | The generated board, for review.                                       |

## Roster

Synthetic — Du Bois has no real hires yet. Seeded into production on 2026-08-12 by
[`supabase/seeds/prod/04-dubois-people.sql`](../../../supabase/seeds/prod/04-dubois-people.sql):
12 SW + 1 SM + 1 RSM + 1 HM, login-capable, placeholder `<firstname>-dubois@upenn.edu`
addresses flagged for replacement before any real launch. This package's roster is the 12
SW + 1 SM (13 people) — RSM and HM are excluded from the preference board, matching the
Harnwell package's precedent (they hold shifts but do not submit boards).

## Why this can be reviewed before the season exists

Same mechanism as the Harnwell package: block identity here is positional
(`weekday:minuteOfDay`), not by real `block_id`, so the board can be reviewed now and bound
to real block ids unchanged once `season.sql` is applied. `generate.ts` re-run after apply
must print the same checksum; if it does not, the season was applied with different bands
and the package is stale.

## Prerequisites, in order

1. Confirm Du Bois should open on the same dates and desk hours as Harnwell
   (2026-08-24 to 2026-12-20, 08:00–00:00). `season.sql` assumes so.
2. Apply `../fall-2026-harnwell/season.sql` first if it has not run yet (this file's
   `season_house_windows` row FKs to the `operating_seasons` row it creates).
3. Apply this directory's `season.sql` through `/admin/operations` (or run it directly,
   **dry-run first**).
4. Re-run `npx tsx docs/preference-generation/fall-2026-dubois/generate.ts` and confirm
   the checksum still reads `60f7cbf77387b78d`.

## Applying the package

Only after the above. The write goes through `admin_seed_preferences`, which is admin-only
and service-role-only.

Read this before approving:

- The RPC is **idempotent by wiping**. It deletes every `preferences` and `period_targets`
  row for the period, for every user, then inserts the package. Because Harnwell's package
  targets the SAME period, applying one after the other WIPES the first one's rows before
  reinserting — **apply both packages in the same operation**, or re-apply Harnwell's after
  this one. Check first:
  ```sql
  select count(*) from preferences where period_id = 'fa112026-0000-4000-8000-000000000001';
  ```
- It is one transaction. A single out-of-range target aborts all of it. G3 passes, so this
  should not fire.
- **There is no undo.**
- The 0 non-submitters means every row in this package should be written; nobody needs to
  be omitted for this house specifically (unlike Harnwell's 1 never-submitted worker,
  which still must be omitted from Harnwell's own payload).

## What the board contains

13 workers: 12 submitting boards, 1 opted out, 0 never submitted. 180h of stated appetite
against 112h of demand, so the house is staffable with headroom.

Availability offered runs 10.5h to 32h, median 25h.

4h of the week attract **no interest at all** (budget 4h): Sat 08:00, Sat 08:30, Sat 09:00,
Sat 09:30, Sun 08:00, Sun 08:30, Sun 09:00, Sun 09:30. Those are left deliberately
uncovered rather than repaired away: they are the hours the desk will be fighting to fill,
and they will fall through to the coverage ladder in week one. Every other block carries at
least 1 preferred mark (median 2); 28 blocks needed coverage repair.

All four roster guarantees pass. Detail and the per-worker boards are in the review
artifact (`package.json.generated`).
