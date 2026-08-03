# Interactive onboarding pattern (design spec)

**Status:** implemented once, on iOS only — My Shifts → "Manage a shift" (drop / swap /
hand off). Not yet on Android, not yet on any other screen. This doc is the spec for
applying the SAME pattern consistently everywhere else, so a future session can build,
say, the break-calendar drag-to-claim tour or the preference-paint tour without
re-deriving the reasoning from scratch or (worse) inventing a visually inconsistent
variant.

Reference implementation: `apps/mobile/shared/src/commonMain/kotlin/.../onboarding/
ShiftTour.kt` (pure step data + copy), `apps/mobile/shared/.../viewmodel/
ShiftTourViewModel.kt` (sequencing), `apps/mobile/iosApp/iosApp/ShiftTourView.swift`
(rendering). Read those three files alongside this doc — this is the "why", they are
the "how".

## The problem this replaces

The pre-existing pattern for teaching a feature was a single contextual tip: a grey card,
one paragraph, a "Got it" button (`Onboarding.CONTEXTUAL_TIPS`, deleted 2026-08-03). For My Shifts specifically,
that paragraph was doing too much work: _"Tap any shift to drop it, swap it, or hand it
off to a housemate. You can give just part of a shift, or make it permanent."_ That's
three verbs and a part/whole × once/permanent matrix, compressed into one sentence nobody
reads before tapping "Got it". The fix is not better copy — it's a different _format_ for
content that is inherently multi-step and interactive.

**The diagnostic question for any screen:** does teaching this feature require the user to
understand more than one verb, or a control whose behavior isn't obvious from looking at
it? If yes, a paragraph is the wrong tool regardless of how well it's written.

## The psychology, principle by principle

Each principle below names the mechanism, then says exactly where it shows up in the
`ShiftTour` code, so it's a checklist, not a mood board.

1. **Show, don't tell.** A paragraph describing an action is decoded once, silently, and
   forgotten. A short demo the user _watches happen_ on a realistic mock of the real
   screen builds a mental model in one pass. This is why the tour renders a fake My-Shifts
   card + fake bottom nav (`stage(_:)` in `ShiftTourView.swift`) instead of an illustration
   or icon grid — the visual vocabulary has to be the SAME vocabulary the real screen uses,
   or the lesson doesn't transfer.

2. **Chunking.** Three verbs (drop / swap / hand off) plus a part-vs-whole and
   once-vs-permanent axis is too much for one screen to hold at once. Split into three
   single-focus steps (`ShiftTour.STEPS`), each with exactly one idea, is easier to
   encode than one dense screen — this is the entire reason the interactive-tour format
   exists instead of a richer single tip card.

3. **The testing effect (active recall beats passive reading).** Step 2 is not a
   read-only mockup of the range slider — it's the REAL `BlockRangeSlider`, live and
   draggable, wired to the real `ShiftTour.summaryLine` math. A user who drags the handle
   and watches "Giving 2h · 18:00 to 20:00 · this week" become "Giving 4h · 16:00 to 20:00
   · permanently" has _performed_ the skill once already, inside the tour. That's a much
   stronger encoding than being told the control exists. **Corollary: whenever the real
   control can be dropped into a tour step live (not re-implemented as a mockup), do
   that** — a fake, non-interactive slider would have taught the wrong thing (that it's
   just decoration).

4. **Discoverability priming for non-standard affordances.** iOS/Android users have
   decades of learned convention for buttons, switches, and tabs — those never need extra
   teaching. A **custom two-handle range slider has no such convention**; nothing about
   its appearance screams "drag me" the way a button screams "tap me". This is why the
   drag-hint badge exists (`dragHintBadge` / `showDragHint` / `hasInteractedWithSlider` in
   `ShiftTourView.swift`): a small hand icon wiggles on the real handle until the user's
   OWN drag fires (`from`/`to` actually changing — the real signal, not a timer), then it
   disappears for good. **Rule: any custom/non-native interactive control introduced in a
   tour step needs an explicit affordance hint. Any standard OS control (button, switch,
   segmented control) does not** — don't add hint chrome to things people already know how
   to use, it reads as condescending and adds visual noise.

5. **Motion as consequence, not decoration.** Step 3 doesn't say "dropped shifts appear in
   Open" and stop there — the sample card visibly falls away and the Open tab visibly
   bounces amber. This spatially demonstrates cause → effect (the SAME mechanism as a UI
   toast confirming a real action, just staged). Users retain "where did it go" far better
   from watching it happen than from reading it. **Rule: if a step's whole point is "and
   then X happens elsewhere in the app", animate that consequence in the mock UI. Don't
   just say it in the body text.**

6. **Information architecture must not lie.** Step 1 could have shown three equal, flat
   chips (Drop / Swap / Hand off) — simpler to build, but WRONG, because in the real sheet
   Hand off is a sub-mode inside Swap, not a third top-level intent. The tour visually
   groups Swap + Hand off in one outlined cluster, separate from Drop, so the taught
   mental model matches the real sheet exactly. **Rule: never simplify a tour's structure
   in a way that misrepresents the real UI's hierarchy — a mismatch between the lesson and
   reality causes confusion the moment the user leaves the tour, which is worse than not
   teaching it at all.**

7. **Progressive disclosure across teaching tiers, not within one tour.** This app already
   has three onboarding tiers (`onboarding/Onboarding.kt`): a first-run WELCOME tour
   (orientation to the five tabs, fires once, ~20s), one-time CONTEXTUAL TIPS (a single
   card the first time a worker reaches a surface), and now this new tier — an
   INTERACTIVE TOUR for one specific feature that's complex enough to earn a dedicated,
   multi-step, gesture-driven teaching moment. Don't fold everything into the welcome
   tour (front-loading kills retention — nobody remembers step 5 of a 12-step tour) and
   don't build an interactive tour for something a one-line tip already covers fully. See
   the decision framework below.

8. **Respect the user's time and autonomy.** Skip is always present and always exits
   cleanly (marks done, doesn't nag again). Steps are capped at three. This is a work tool
   for shift workers, not a consumer growth funnel — a worker who already knows how to
   drop a shift should never be forced through a demo to keep using the app.

9. **Crisp, neutral copy — no marketing voice.** No exclamation points, no "Awesome!",
   sentence case, short declarative sentences (`ShiftTour.STEPS` bodies: "Tap a shift, then
   pick what to do with it." / "Drag to choose how much of the shift to give."). The
   product's register is a scheduling tool for residential staff, not an app trying to
   delight a consumer into a purchase. Matching tone across every future tour matters as
   much as matching visuals — a tour that suddenly sounds "salesy" reads as inconsistent
   with the rest of the app even if the mechanics are identical.

10. **One-time by default, always replayable on demand.** Every tour/tip fires exactly
    once automatically (a persisted seen-flag), then only reappears if the user explicitly
    asks. Never re-show unprompted — repetition of something already learned reads as the
    app not remembering the user, which erodes trust fast. But always leave a deliberate,
    discoverable way back in (see next principle) — the user's context for "did I already
    see this" is unreliable, especially weeks later.

11. **Re-entry should be a lightweight pointer, not another interruption.** The very first
    version of this feature ended the tour with a subtle pulsing ring on a "?" button — a
    passive visual, easy to miss. The corrected version (built this session, in direct
    response to the same kind of "how would the user actually discover this" reasoning
    that produced the drag-hint) is a small directional speech-bubble-and-arrow
    (`ShiftTourPointerCallout`) that points AT the real button, states plainly what it does
    ("Find this again here / Tap to replay the tour"), and fades on its own after ~3s
    with no dismiss action required. It never blocks the screen (`allowsHitTesting(false)`,
    no scrim) — the user can start using the app immediately while it's still fading.
    **Rule: a one-time "here's where that lives" cue should be a non-modal, self-dismissing,
    accurately-positioned pointer — never a card requiring another explicit dismissal.**
    A user who just finished a tour and immediately hits a second dismissable modal
    experiences that as nagging, even though the intent is helpful.

12. **Live feedback closes the loop immediately.** The step-2 summary line updates on
    every frame of the drag, not on release. Immediate feedback (as opposed to "confirm
    then see the result") is what makes a single practice rep during the tour actually
    teach the mechanic — delayed feedback is a well-documented weaker learning signal.

## The three-tier system (where a new tour fits)

```
INTERACTIVE TOUR                   WRITTEN GUIDE
(multi-step, gesture-driven,       (knowledge base, sought out,
 teaches ONE feature that is        answers a question the worker
 multi-verb or has a non-           already has)
 standard control)
```

**Tiers 1 and 2 no longer exist (removed 2026-08-03).** The old Tier 1 was a first-run
walkthrough of the five bottom tabs; Tier 2 was the one-card contextual tip above. Both
were cut, and the reason is worth keeping: a card that arrives uninvited, before the
worker has a reason to care, teaches nothing and trains a dismiss reflex — which the
interactive tours then inherit. There is now no passive teaching layer at all, by design.
See BEHAVIORAL_SPECIFICATION.md §20.1.

Decision framework for a new screen/feature:

- **Does the feature involve two or more distinct outcomes (verbs), OR a custom
  interactive control whose affordance isn't obvious, OR a "this happens, then that
  happens elsewhere" flow worth demonstrating spatially?** → Build an interactive tour
  using this pattern.
- **Anything less than that** → No in-app teaching. Write a knowledge-base guide and let
  the worker (or the Assistant) find it. Do NOT reach for a one-card tip: that tier was
  deliberately deleted, and reintroducing it for one surface reintroduces it for all.
- **Is it orientation to a tab or persistent nav element?** → Nothing. The bottom bar is
  five labelled icons; a walkthrough of it was tried and removed.

## Anatomy of a Tier-3 interactive tour (the reusable parts)

Building a new one should reuse this shape, not reinvent it:

1. **Shared pure module** (`onboarding/<Feature>Tour.kt`): step copy (kicker/title/body),
   any sample data needed for the mock (a representative fake record, not "Lorem ipsum"),
   pure formatting helpers for any live-recomputed text, and a `DONE_KEY`. Zero I/O, zero
   clock — testable with plain `kotlin.test`, same as `ShiftTourTest.kt`.
2. **Shared ViewModel** (`viewmodel/<Feature>TourViewModel.kt`): `autoStart` / `replay` /
   `next` / `back` / `skip`, owns the seen-flag, exposes a `StateFlow`. Copy
   `ShiftTourViewModel.kt` almost verbatim — the shape is deliberately uniform across
   tours so a developer who's read one has read them all.
3. **A "stage"**: a miniature, visually faithful mock of the real screen the lesson is
   about, built from the SAME kit components (`ui/kit` on Android, `Kit/` on iOS) the real
   screen uses — not bespoke illustration assets. Reuse real interactive controls live
   wherever the lesson benefits from active recall (principle 3).
4. **A coach-mark card**: kicker ("STEP n"), title, body, `n of N` progress, Skip / Back /
   Next-or-Done. All six tours share this chrome exactly, so any one of them feels like
   part of the same product rather than a separate mini-app. (Until 2026-08-03 the
   reference for this chrome was the deleted `OnboardingOverlayView`; `ShiftTourView` is
   the reference now.)
5. **Discoverability hints** on any non-standard control introduced (principle 4) — gated
   on the real interaction actually happening, not a timer.
6. **Consequence animation** for any "and then this happens elsewhere" step (principle 5).
7. **Own seen-key namespace**, separate from every other tour's (`shift_tour_seen_keys`
   here) — persisting one tour must never clobber another's state.
8. **A re-entry pointer**, not a modal (principle 11) — reuse the
   `ShiftTourPointerCallout` shape (anchor-preference-positioned speech bubble + arrow,
   non-blocking, auto-fades) rather than inventing a new re-entry mechanic per tour.
9. **A help affordance on the real screen** ("?" in the header, or equivalent) that calls
   `replay()`, plus a matching row in Settings, so there are always two ways back in.

## Cross-platform contract

- Both platforms render from the SAME shared step data and VM state — only chrome/motion
  is platform-native (SwiftUI vs Compose). Never fork copy or sequencing per platform.
- Selector/testTag naming: `<feature>_tour`, `_help`, `_pointer`, `_skip` / `_back` /
  `_next`, plus one per interactive control exercised (e.g. `_range`, `_summary`). Follow
  this convention exactly so a future Maestro flow (or, per the separate testing-strategy
  discussion, an XCUITest/Espresso suite) can drive any tour with the same selector
  pattern regardless of which feature it teaches.
- Settings gets one "Replay <feature> tour" row per Tier-3 tour that exists. Don't merge
  multiple tours' replay into one row — a worker replaying "the shift tour" should not
  also see an unrelated break-calendar demo.

## Anti-patterns (explicit — these were considered and rejected)

- **A modal "look here" card as the re-entry cue.** Rejected in favor of the non-blocking
  pointer (principle 11) — see the git history of this feature for the earlier, weaker
  ring-pulse version this replaced.
- **A static, non-interactive mockup of a control that's interactive in real life.** If a
  step teaches "you can drag this", the tour must let the user actually drag it.
- **Any passive card that appears uninvited and clears with one tap.** This is the whole
  reason Tiers 1 and 2 were deleted. If a surface is worth interrupting for, it earns an
  interactive tour; if it isn't, it gets a written guide and nothing in the app.
- **Marketing copy.** No exclamation points, no growth-funnel language, ever, in this app.
- **Flattening a feature's real information architecture for tour simplicity.** If the
  real UI has two top-level intents and a nested sub-mode, the tour must show two
  top-level intents and a nested sub-mode (principle 6), even if three flat chips would
  have been an easier build.
- **Re-showing an already-seen tour unprompted.** One auto-fire, ever, per seen-flag.

## Candidate screens (backlog for future sessions)

Features with 2+ verbs or a non-standard control, worth auditing against the decision
framework above:

- **Break calendar drag-to-claim** (`BreakCalendarView` / `BreakCalendarViewModel`) — a
  custom drag-across-blocks gesture with no native affordance; a strong Tier-3 candidate.
- **Preference paint gesture** (`PreferencesScreen` — hold-then-drag-to-paint, see
  [[project_preference_paint_gesture]]) — non-standard gesture (hold ~250ms then drag),
  exactly the kind of control principle 4 exists for.
- **Partial swap segmented timeline** ([[project_swap_segmented_timeline]]) — multi-verb
  (give/take across two legs) plus a custom control (the segmented timeline itself).
- **House grid contact tap** — one verb (tap a name to call). Built anyway, as part of a
  broader grid tour; on its own it would not have earned one.

**Status: all six on this list shipped**, and the list is closed. Six tours is the
deliberate ceiling — the point of removing the passive layers was to make in-app teaching
rare enough that a worker still reads it. Always re-run the decision framework per-screen,
and treat "this screen needs a tour too" as a claim to argue for, not a default.
