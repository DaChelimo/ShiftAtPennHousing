# Persona-Based Preference Generation

**Status:** active spec. Governs `packages/core/src/preference-generation/`.
**Applies to:** any house, any season. Nothing in this document is Harnwell-specific or
fall-specific.

---

## 1. What this is for

An SM cannot build a schedule until workers have painted their preferences. Real
collection takes weeks and depends on 30 students remembering to open an app. This
generator produces a **plausible preference board for a whole roster in one shot**, so a
season can be built, reviewed, and stress-tested before (or instead of) real collection.

The output is indistinguishable in shape from real submissions: same tables, same
statuses, same sparse encoding. It is written through
`admin_seed_preferences` (migration `20260711000002`), which is admin-only and
service-role-only.

**What makes a generated board useful is not randomness, it is structure.** A board where
every worker independently coin-flips each 30-minute block is useless: nobody works in
30-minute specks, the aggregate is uniform mush, and the resulting schedule teaches you
nothing about whether your staffing bands are achievable. This spec exists so the board
carries the structure real rosters have, which is people with _coherent, different, and
partly conflicting_ lives.

---

## 2. The unit of realism: a persona

A worker is **one draw from each of five independent axes**. The axes are orthogonal by
construction, so a roster of 28 spans a wide space rather than clustering on five
archetypes. `evening + weekend + long + selective + high` (the person who wants three
long Friday-through-Sunday nights and nothing else) and `evening + weekend + long +
flexible + low` (same taste, six hours a week, will take anything) are different people
and must generate different boards.

A worker's `personaLabel` is the five members joined by `+`. It is carried on the output
row for the review artifact and never written to the database.

### Axis A: day part

Which hours of the day the worker wants. Bands are resolved against the season's **desk
window**, not hardcoded clock times, so a season that opens at 05:30 and one that opens
at 08:00 both work.

| Member      | Peak band                 | Weight |
| ----------- | ------------------------- | ------ |
| `early`     | desk open to 12:00        | 3      |
| `afternoon` | 12:00 to 17:00            | 4      |
| `evening`   | 17:00 to desk close       | 5      |
| `any_time`  | flat, no day-part opinion | 3      |

Weights encode the real scarcity: evening is the most-wanted band on a student desk,
early morning the least. `any_time` exists so the roster is not fully polarized.

A band with no blocks in a given season (a desk that opens at 17:00 has no `early` band)
simply contributes nothing. No configuration change is needed.

### Axis B: day type

| Member    | Peak                             | Weight |
| --------- | -------------------------------- | ------ |
| `weekday` | Mon to Fri                       | 5      |
| `weekend` | Sat and Sun, plus Friday evening | 3      |
| `any_day` | flat                             | 4      |

Friday evening counts as weekend for `weekend` workers and is neutral for `weekday`
workers, because Friday night is socially a weekend shift even though Friday is a
weekday.

### Axis C: shift length

The contiguous run the worker wants to work. This is the axis that most changes how a
board _looks_, and the one an unstructured generator gets most wrong.

| Member   | Run                 | Weight |
| -------- | ------------------- | ------ |
| `short`  | 2 hours (4 blocks)  | 4      |
| `medium` | 4 hours (8 blocks)  | 5      |
| `long`   | 6 hours (12 blocks) | 3      |

Preferred blocks are painted **in runs of this length**, never as scattered individual
blocks. See Section 4.

### Axis D: selectivity

How much of the week the worker is willing to mark preferred, expressed as a multiple of
what they actually want to work. A selective worker paints barely more than their target;
a flexible one paints a wide net and lets the SM choose.

| Member      | Overpaint factor | Weight |
| ----------- | ---------------- | ------ |
| `selective` | 1.05x target     | 3      |
| `moderate`  | 1.35x target     | 5      |
| `flexible`  | 1.7x target      | 4      |

These are **calibrated against how people actually submit**, not invented. Someone wanting
20h offers about 32h; someone wanting 8h offers 13 to 14h; and a selective worker often
offers exactly what they want, 8h for 8h. The three factors reproduce all three of those
observations. An earlier 1.4 / 2.2 / 3.5 produced 60-hour boards, which read to the SM as
"available all week" and made the board useless.

Selectivity also scales how aggressively the worker marks `cannot` (Section 5).

### Axis E: hours appetite

Target hours as a fraction of the season's cap. **This is the axis that reads the maximum
hours.** The cap is never hardcoded: it is `operating_profiles.default_hours_cap` for the
period's profile, resolved by the caller.

| Member   | Fraction of cap | On a 20h cap | On a 40h cap | Weight |
| -------- | --------------- | ------------ | ------------ | ------ |
| `low`    | 0.25 to 0.45    | 5h to 9h     | 10h to 18h   | 3      |
| `medium` | 0.55 to 0.75    | 11h to 15h   | 22h to 30h   | 5      |
| `high`   | 0.85 to 1.00    | 17h to 20h   | 34h to 40h   | 4      |

`targetHours = clamp(round(cap * fraction), 1, cap)`.

The clamp to `cap` is load-bearing, not defensive: `period_targets_enforce_hours_cap`
**rejects** a target above the profile cap, and because the whole package is written in
one statement, a single over-cap target aborts the entire seed.

### D and E are correlated, not independent

Axes A, B, and C are drawn independently. D and E are drawn with a **joint bias**: after
selectivity is drawn, the appetite weights are tilted.

| Selectivity | Appetite weights (low / medium / high) |
| ----------- | -------------------------------------- |
| `selective` | 5 / 5 / 2                              |
| `moderate`  | 3 / 5 / 4                              |
| `flexible`  | 2 / 5 / 6                              |

This makes "very selective, low target hours" the most common shape of a selective
worker, which is what the archetype describes, without forbidding the selective
maximizer: the person who will work only Saturday nights but wants every one of them.
That person exists on real rosters and is exactly the case that breaks a naive builder.

---

## 3. Target hours drive the paint, not the other way round

The single most common failure of a generated board is a worker who wants 6 hours a week
and has painted 40 hours of preferred. The SM's builder then reads them as wide open,
schedules them for 18, and the board taught you nothing.

The rule:

```
wanted   = round(targetHours * 2 * overpaintFactor)   // *2 converts hours to blocks
ceiling  = min(
             capHours * 2 * (generous ? 1.75 : 1.5),  // against the CAP
             floor(targetHours * 2 * 1.8)             // against their OWN target
           )
budget   = max(runLength, targetHours * 2, min(totalBlocks, ceiling, wanted))
```

### The two ceilings, and why both are needed

**Against the cap**, because submissions rarely pass 1.5x it: 30h on a 20h cap. The rare
generous worker reaches 1.75x (35h), which does happen but is unusual, so it is drawn per
worker (10%) rather than applied to everyone. Expressing it as a multiple of the cap rather
than a fixed hour count is what makes it travel to a 40h summer.

**Against the worker's own target**, because someone wanting 5h should never end up
offering 30h just because the cap would allow it. This second bound is the one that is easy
to omit and it is load-bearing in a non-obvious place: **the coverage repair pass in
Section 7 also has to respect it.** Repair patches thin blocks onto whoever wants them most,
which preferentially inflates exactly the low-target workers whose boards should stay small.
Without the personal ceiling, repair alone pushed workers to 2x their target.

A `selective + low` worker on a 20h cap lands around 5h target and ~5h of preferred: two
runs, tightly clustered. A `flexible + high` worker lands around 19h target and ~30h
offered. Both are realistic, and the difference is visible at a glance in the artifact.

One consequence to keep: **a worker's preferred run shrinks if their target cannot hold
it.** Someone who wants 3h a week does not ask for 6-hour runs, and without that the
run-length floor would force them past the overpaint model entirely.

---

## 4. How a board is painted

Per worker, deterministically:

1. **Enumerate candidate runs.** A candidate is `runLength` consecutive blocks that lie
   entirely within one NY day, entirely inside the desk window, and start on a clock hour.
   The clock-hour alignment mirrors the AI scheduler's rule that no generated shift starts
   at :30, with the desk open and close as the only exceptions.
2. **Score each run** as the mean affinity of its blocks, where affinity combines the Axis
   A day-part match, the Axis B day-type match, a small baseline desirability, and a
   per-worker jitter drawn from that worker's seeded stream. Jitter is what stops two
   workers with identical personas from producing byte-identical boards.
3. **Take runs greedily**, highest score first, skipping any that overlap an
   already-taken run, until the preferred budget is spent. Adjacent runs are allowed:
   that is how a `long + high` worker ends up with a genuine 8-hour Saturday.
4. **Mark every block in every taken run `preferred`.**

Runs, not blocks, are the atom. That is the whole point.

---

## 5. `cannot` marks

Two sources, in this order:

1. **A recurring commitment.** Each worker gets 1 to 3 weekly windows at the _same clock
   time_ on 2 or 3 weekdays, sized 1 to 2 hours, drawn from the worker's least-preferred
   day part. This is a class, and it is what makes a real board look real: hard vertical
   stripes in the weekday grid at 10:00 and 14:00, not noise.
2. **An anti-affinity sweep** over the day-part band most opposed to Axis A, with
   probability scaled by selectivity. A `selective + evening` worker marks most mornings
   `cannot`; a `flexible + evening` worker leaves them merely unmarked.

The sweep rolls once per **clock hour**, not per 30-minute block. Rolling per block
produces speckle: a lone `cannot` at 09:30 with 09:00 and 10:00 left open. Nobody paints
that, and on the SM's board it reads as noise rather than as a constraint.

A block already marked `preferred` is never overwritten with `cannot`.

Only `preferred` and `cannot` are ever emitted. The painter persists only those two, and
both read sides (`buildInitialGrid`, `AiRosterWorker.prefs`) collapse available and
unmarked to the same sparse default, so an explicit `available` row is dead weight.

---

## 6. Non-participants

Two distinct shapes, both real, both configurable:

- **Opted out** (`optOutRate`, default 0.07): the worker clicked "no hours this period".
  A `period_targets` row exists with `opted_out = true` and zero preference entries.
- **Never submitted** (`nonSubmitterRate`, default 0.05): the worker did nothing before
  the deadline. **No row of any kind.** The builder surfaces them as "no preference
  submitted", which is a different state from opting out and exercises a different code
  path.

A generator that emits only opted-out workers never tests the non-submitter path. Keep
both non-zero on any board intended as a realistic rehearsal.

---

## 7. Roster-level guarantees

Per-worker realism is not enough. A board can be individually plausible and collectively
unbuildable. Every generated package is **validated** against these, and the validation
result ships with the package:

| ID  | Guarantee                                                                                          | On failure                                                                         |
| --- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| G1  | Every block reaches `requiredHeadcount`, **except an allowed budget of genuinely unwanted blocks** | Repair: promote the highest-affinity workers who are still under their own ceiling |
| G2  | No block is `cannot` for every submitting worker                                                   | Repair: clear the `cannot` on the highest-affinity worker                          |
| G3  | Every `targetHours` is in `[1, cap]`                                                               | Hard error. The write would abort anyway                                           |
| G4  | Sum of `targetHours` >= total seat-hours in the template week                                      | **Report only, never repair**                                                      |

### G1 and G2 are not in tension: there are three states, not two

Read side by side, G1 (some blocks may attract no interest) and G2 (no block may be
`cannot` for everyone) look contradictory. They are not, and the reason is the state that
is easy to forget because it is never written to the database:

| State       | Meaning                                  | Stored      |
| ----------- | ---------------------------------------- | ----------- |
| `preferred` | I want this block                        | a row       |
| `cannot`    | I actively cannot work this block        | a row       |
| _unmarked_  | I can work it, I just did not ask for it | **nothing** |

G1 is about the absence of `preferred`. G2 is about the presence of `cannot` from everyone.
A block can easily be the first without being the second, and in practice always is: on the
Fall 2026 Harnwell board, Sat 08:00 has **0 preferred, 8 cannot, and 18 workers who left it
unmarked and are therefore available.**

That gap is the whole operational difference:

- **G1's unwanted blocks are fillable.** Nobody volunteered, so the SM has to ask rather
  than pick from a list, but 18 people can be assigned without contradicting anything they
  said. This is the normal, expected state of the worst hour of the week.
- **A G2 violation is not fillable from the board.** Every worker has actively refused, so
  assigning anyone means overriding a stated "I cannot work then". That is a categorically
  worse situation and deserves its own guarantee.

Honest limitation: at a realistic roster size G2 almost never fires. It failed in 1 of 40
seeds on a 3-worker roster and 0 of 40 on rosters of 4, 6, and 26. Treat it as a
small-roster and narrow-window guard, not as a check doing daily work.

One subtlety in the implementation, because it produced a wrong report before it was fixed:
`[].every()` is vacuously **true**, so a roster where everyone opted out would report every
block as refused by all. It is guarded. That board is broken, but G1 is the guarantee that
should say so, and it does.

### The unwanted-block budget

**A generated board must not promise that every hour of the week has a taker.** Real ones
do not. Roughly 4 hours of a template week attract no interest at all, and the opening
hour on a quiet weekday is the canonical case. `uncoveredBudgetHours` (default 4) is how
much of the week is allowed to stay at zero.

The budget is spent on the **least wanted** blocks, ranked by the best affinity anyone on
the roster has for them, so what survives uncovered is what nobody would have taken anyway
rather than an arbitrary slice. Everything else is repaired to headcount.

This is not a cosmetic detail. Repairing every slot away erases the single most useful
thing the board can tell an SM before the season starts: **which hours they will be
fighting to fill.** Those blocks are the ones that will fall through to the coverage
ladder in week one, and it is much cheaper to see them now.

Two properties worth stating because they are easy to lose:

- The repair pass **respects each worker's personal availability ceiling** (Section 3). If
  a block is short and nobody is left under their ceiling, it stays short and G1 reports
  it. Fabricating availability to make a number go green defeats the exercise.
- `minPreferredPerBlock` is measured over the **covered** blocks only. Folding the
  deliberately-unwanted ones in would peg the minimum at 0 and say nothing.

G4 is deliberately not repaired either. A roster whose combined appetite is below the
season's seat-hours is a **real finding about the season**: either the staffing bands are
too rich or the house is under-hired. Inflating targets to hide it would be generating
away the signal the rehearsal exists to produce.

### Where the unwanted blocks actually land

An output, not a contract. In practice they cluster at the desk's opening hour and at the
seam between the afternoon and evening bands, where a slot is nobody's first choice. Do
not write a test that asserts a specific weekday or hour; assert the **ranking rule** (that
what stays uncovered is less wanted than the typical block), which is what the code
guarantees.

The mechanism that lets any slot go unwanted is the weight on baseline desirability inside
the affinity blend, currently **0.25**. Below roughly 0.2 the persona terms dominate hard
enough that somebody always wants everything, and the budget goes unspent because there is
nothing to spend it on. If a future change makes unwanted blocks disappear, look there
first.

---

## 8. Determinism

The generator is a pure function: no clock, no I/O, no Supabase imports, per
`packages/core`'s purity rule.

Every random draw comes from a stream keyed `(seed, periodId, userId)`. The same tuple
reproduces the same board byte for byte; a different period diverges.

**Block identity is positional, never by id.** A worker's rolls are drawn in template-week
order (weekday, then minute of day), so the package depends on the _shape_ of the template
week and not on the uuids in it. This has a specific and useful consequence:

> A package can be generated and reviewed **before the season exists in the database**,
> against a modelled template week, and then bound to real `block_id`s at apply time. As
> long as the slot set is unchanged, the applied board is exactly the reviewed board.

That is what makes the review-then-apply workflow in Section 10 possible without
provisioning a season first.

---

## 9. What is season-specific and what is not

Everything in the left column is read from the season. Everything in the right column is
fixed by this spec and is the same for summer, fall, and a winter break.

| Read from the season                      | Fixed by this spec                                    |
| ----------------------------------------- | ----------------------------------------------------- |
| Hours cap and cap enforcement             | The five axes and their members                       |
| How much of the week may go unwanted      | Availability ceilings, as multiples of cap and target |
| Desk open and close bounds                | Axis weights and the D/E joint bias                   |
| Per-day-type staffing bands and headcount | Overpaint factors                                     |
| Which houses are open                     | Run lengths (2h / 4h / 6h)                            |
| The roster, per house, as of the period   | Appetite fractions as a share of cap                  |
| `period_id`                               | Guarantees G1 to G4                                   |
|                                           | The 0.25 baseline-desirability weight                 |

Adding a house means passing a different roster and a different block set. Adding a season
means passing a different cap and window. **Neither requires touching the persona model**,
and that is the property this spec is protecting.

---

## 10. The workflow: generate, review, approve, apply

Generation is never the same step as application. The board overwrites real rows and the
write is not reversible, so it goes through an explicit gate.

1. **Resolve the context.** Period, cap, desk window, open houses, roster per house,
   template week.
2. **Generate.** Pure call, one package.
3. **Validate.** G1 to G4, plus the distribution report: persona mix, target-hours
   histogram, preferred coverage per block, repair count.
4. **Render for review.** A per-worker week heatmap, the persona mix, and the validation
   result. A reviewer must be able to point at one worker and say "that is not a real
   person" before anything is written.
5. **Approve.**
6. **Apply** through `admin_seed_preferences`.

### What applying actually does

`admin_seed_preferences` is **idempotent by wiping**. It deletes _every_ `preferences` and
`period_targets` row for the period, for every user, including manual tweaks and rows
belonging to workers who have since left, and then inserts the package. It temporarily
sets `preference_deadline` to NULL to get past `enforce_preference_deadline` (which is not
service-role-bypassed and fires on DELETE too) and restores it afterwards.

Consequences worth stating plainly before anyone approves:

- **Any genuine submissions in that period are destroyed.** Check for them first. Seeding
  a _new_ period touches nothing that exists.
- The whole package is one transaction. One bad target aborts all of it.
- There is no undo.

---

## 11. Extending this

Add a member to an axis rather than adding an axis. Four axes of three members give 81
combinations, which is already more than any real roster covers; a sixth axis adds
combinatorial surface nobody reviews. If a new behaviour cannot be expressed as a member
of an existing axis, it probably belongs in the affinity function instead.

Any change to the axes, weights, overpaint factors, or appetite fractions changes every
future board. Update this document in the same commit, and state what moved and why.

---

## 12. Grounding

| Claim                                                        | Source                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Sparse `preferred`/`cannot` encoding                         | `packages/core/src/preference-generation/types.ts`                         |
| Wipe-and-rewrite, deadline reopen, one transaction           | `supabase/migrations/20260711000002_admin_seed_preferences.sql`            |
| Target hours capped by the profile                           | `period_targets_enforce_hours_cap`; `operating_profiles.default_hours_cap` |
| Preferences are a template week, not a whole season          | `apps/web/lib/actions/devSeeding.ts:183-214`                               |
| Purity rule for `packages/core`                              | `packages/core/AGENTS.md`                                                  |
| No shift starts at :30                                       | `docs/design/` AI scheduler clock-hour rule                                |
| Cap is 20h soft on `regular_school_year`, 40h hard on summer | `operating_profiles`                                                       |
