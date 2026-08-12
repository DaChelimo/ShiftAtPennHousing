# Fall 2026 Harnwell preference package

Generated board for the Harnwell-only fall pilot, produced by the persona generator.
Contract: [`../PERSONA_SPEC.md`](../PERSONA_SPEC.md).

**Nothing in this directory has been applied to any database.** Both steps below are held
for sign-off.

|               |                                                                           |
| ------------- | ------------------------------------------------------------------------- |
| Target        | Shift (`nctfnufnsczyhkcidlmd`), production                                |
| Season        | Fall 2026, `fa112026-0000-4000-8000-000000000001`, Harnwell only          |
| Period        | same uuid (`apply_compiled_season` materializes `period_id == season_id`) |
| Template week | 2026-08-24 (Mon) to 2026-08-30 (Sun), 224 blocks, headcount 2             |
| Cap           | 20h soft                                                                  |
| Seed          | `harnwell-fall-2026-v2`                                                   |
| Checksum      | `c2602060986f1689`                                                        |

## Contents

| File                     | What it is                                                         |
| ------------------------ | ------------------------------------------------------------------ |
| `season.sql`             | Fall 2026 season **proposal**. Authoring tables only. Not applied. |
| `generate.ts`            | Reproducible generator entry point. Pure, offline.                 |
| `package.json.generated` | The generated board, for review.                                   |

## Why this can be reviewed before the season exists

Preferences reference `block_id`s, and Fall 2026 has no blocks yet: Harnwell's last live
block on Shift is `2026-08-20 23:30`. The generator sidesteps the chicken-and-egg because
**block identity in it is positional, not by id** (spec §8). It runs against slot keys
(`weekday:minuteOfDay`), and binding those to real uuids after the season is applied
reproduces the reviewed board exactly, as long as the template week's slot set is
unchanged. `generate.ts` re-run after apply must print the same checksum; if it does not,
the season was applied with different bands and the package is stale.

## Prerequisites, in order

1. **Confirm the fall dates** against Penn's published Fall 2026 academic calendar.
   `season.sql` proposes 2026-08-24 to 2026-12-20 and explains why it starts on a Monday.
2. **Set `created_by`** in `season.sql` to the administrator's real `user_id`. It is a
   zero-uuid placeholder.
3. Apply the season through `/admin/operations` (or run `season.sql` then
   `apply_compiled_season`, **dry-run first**). This is what creates the ~3,800 fall blocks.
4. Re-run `npx tsx docs/preference-generation/fall-2026-harnwell/generate.ts` and confirm
   the checksum still reads `c2602060986f1689`.

## Applying the package

Only after the above. The write goes through `admin_seed_preferences`, which is admin-only
and service-role-only.

Read this before approving:

- The RPC is **idempotent by wiping**. It deletes every `preferences` and `period_targets`
  row for the period, for every user, then inserts the package. For a brand-new fall
  period that is empty, so nothing is destroyed. If real fall preferences have been
  collected by then, **they are destroyed**. Check first:
  ```sql
  select count(*) from preferences where period_id = 'fa112026-0000-4000-8000-000000000001';
  ```
- It is one transaction. A single out-of-range target aborts all of it. G3 passes, so this
  should not fire.
- **There is no undo.**
- The 1 non-submitter must be **omitted** from the payload entirely. Writing a row for
  them turns "never submitted" into "opted out", which is a different state the builder
  renders differently.

## What the board contains

28 workers: 26 submitting boards, 1 opted out,
1 never submitted. 346h of stated appetite against
224h of demand, so the season is staffable with headroom.

Availability offered runs 5h to
30h, median 18h. Nobody
offers more than 1.5x the cap, and the ratio of offered-to-wanted stays inside 1.0x to
1.8x, matching how people actually submit.

3h of the week attract **no interest at all** (budget
4h): Sat 08:00, Sat 08:30, Sun 08:00, Sun 08:30, Sun 09:00, Sun 09:30.
Those are left deliberately uncovered rather than repaired away: they are the hours the
desk will be fighting to fill, and they will fall through to the coverage ladder in week
one. Every other block carries at least 2 preferred marks
(median 4); 28 blocks needed coverage repair.

All four roster guarantees pass. Detail and the per-worker boards are in the review
artifact.
