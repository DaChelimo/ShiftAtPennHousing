---
name: architecture-review
description: Review code you are about to write or have just written for clean-architecture violations in the Shift@PennHousing repo — layering and dependency direction (packages/core purity, commonMain UI-freedom, business rules leaking into views), God classes and oversized files/functions, and premature or missing abstraction. Invoke when adding a file to an already-large module, when a file crosses ~600 lines or a function ~60, when deciding whether to extract an interface/helper/wrapper, when a change spans several layers at once, or when asked "is this the right structure", "should I abstract this", "review the architecture", or "is this a God class". Judgment calls a linter cannot make; the file-size hook only warns.
---

# Architecture Review

Goal: code a human or an agent can still safely change in a year. Run the three checks in
order. Report findings as **must fix** versus **optional**, and do not invent work.

Scope note: this reviews **structure**, not correctness. For bugs, use `/code-review`.

---

## Check 1 — Dependency direction

Each layer may be depended on by the ones below it, never the reverse.

```
domain (pure)  ->  packages/core/src/**          zero I/O, zero SDK imports, deterministic
orchestration  ->  supabase/functions/**         thin wrappers: snapshot, call core, write results
data           ->  apps/mobile/shared/data, apps/web/lib/data
presentation   ->  androidApp (Compose), iosApp (SwiftUI), apps/web/components
```

Verify mechanically:

```bash
# packages/core purity: must return nothing
grep -rn "^import\|from ['\"]" packages/core/src/ | grep -i supabase

# commonMain must import no UI framework
grep -rl "androidx.compose" apps/mobile/shared/src/commonMain/
```

(Path comments mentioning `supabase/migrations/...` are fine. An `import` is not.)

Then read for the violations a grep cannot catch:

- **A clock inside domain logic.** `now` must be a parameter. A `Date.now()`, `Clock.System`,
  or `now()` inside `packages/core` or a tested ViewModel breaks determinism and testability.
- **Business rules in a view.** If a Composable or SwiftUI View decides eligibility,
  claimability, or precedence, it is in the wrong layer. Views render state and emit events.
- **Domain logic called per-row inside a transaction loop.** The orchestrator must build the
  snapshot once and call the pure function once.
- **An Edge Function that is not thin.** If it contains branching business rules rather than
  snapshot / call / write, the rules belong in `packages/core`.

## Check 2 — Size

| Unit                               | Soft ceiling |
| ---------------------------------- | ------------ |
| Source file                        | 600 lines    |
| Function, Composable, or View body | 60 lines     |
| Function parameters                | 6            |

```bash
find apps packages -name '*.kt' -o -name '*.swift' -o -name '*.ts' -o -name '*.tsx' \
  | grep -v -e node_modules -e '/build/' | xargs wc -l | sort -rn | head -20
```

**Quarantined offenders** (verified 2026-07-23; predate the rule, and are not a licence to
add more):

- `apps/mobile/iosApp/iosApp/ContentView.swift` (~5,500 lines, by far the worst)
- `apps/web/components/builder/ScheduleBuilder.tsx` (~1,570)
- `apps/mobile/shared/.../data/WorkerShiftsRepository.kt` (~1,490)
- `apps/web/components/knowledge/KnowledgeIntake.tsx` (~1,215),
  `apps/mobile/androidApp/.../ui/ShiftsScreen.kt` (~1,100),
  `apps/web/components/operations/SeasonEditor.tsx` (~1,060)

Re-derive rather than trusting these numbers if they look stale. Beware `xargs wc -l`: with
many files it emits several `total` lines, and `sort -rn` floats one to the top where it can
be misread as a filename's count. Filter with `grep -v ' total$'`.

The rule for these is **do not grow them**. New surface goes in a new file. When a change
lands inside one, extract the section you touched on the way out. Do **not** propose a
speculative full rewrite unless the user asks; report the delta, not the backlog.

A God class usually announces itself before the line count does: a name ending in `Manager`,
`Helper`, or `Utils`; a class touching three or more unrelated domain concepts; a file whose
imports span every layer at once.

## Check 3 — Abstraction, in both directions

The failure mode runs both ways. Check for both.

### Under-abstracted (extract)

- The same logic appears a third time. Two occurrences are fine; the third is the signal, and
  by then you know the right shape.
- A function takes six or more parameters that always travel together.
- A view is reimplementing a decision the domain already makes.

### Over-abstracted (inline it)

- A wrapper that only forwards.
- A factory producing exactly one type.
- An interface with one implementation and no test seam.
- A config object read in one place.
- **A boolean parameter added so an existing function can serve a second case.** That is the
  wrong abstraction announcing itself. Write the second function.

### Abstraction that earns its keep at one caller

Do not flag these as premature. An abstraction is justified with a single caller when it:

- **Marks a boundary the architecture requires:** an `expect`/`actual` platform hook, a
  repository interface keeping `commonMain` pure, a port that lets domain logic stay testable
  without I/O.
- **Names a domain concept the spec names.** If BSpec calls it a "float exclusion," a
  `FloatExclusion` type earns its keep on day one. Types that mirror spec vocabulary make the
  code searchable against the spec, which is the main way anyone navigates this repo.
- **Enforces an invariant at the type level** so violations cannot compile. Preferable to a
  runtime check plus a comment.

When it is genuinely a coin flip, state the tradeoff in one sentence and pick the simpler
option. A wrong abstraction costs more than a duplicated block, because every later change
has to bend around it.

---

## Reporting

For each finding give: the file and line, which check it fails, and the smallest fix. Rank
must-fix above optional. If a finding is a judgment call, say so and give your recommendation
rather than presenting it as a rule violation.

If all three checks pass, say so plainly in one line. Do not manufacture findings; a reviewer
asked to find problems will always find some, and chasing them produces exactly the
over-engineering check 3 exists to prevent.
