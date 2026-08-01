# Shift@PennHousing - Stakeholder Presentation (v6, visual first)

> Supersedes `Final Slides Outline.md`. Same story, same order, same audience.
> Two things changed: **the text is cut to roughly a third**, and **six slides become
> diagrams**. There are no speaker notes anywhere in this file, by request.

**26 slides.** That is up from 22, and the talk is shorter, not longer. A diagram slide with
eight words on it takes less time to present than a paragraph slide, because the room is
looking instead of reading.

## The rule this rewrite follows

A slide is a **billboard**, not a document. If the room is reading, they are not listening.
So every slide is one of exactly three things:

| Type          | Rule                                         | Count |
| ------------- | -------------------------------------------- | ----- |
| **Statement** | One line. Under 12 words. Nothing else.      | 9     |
| **Diagram**   | A picture with labels. Under 25 words total. | 6     |
| **Evidence**  | A screenshot with a caption. Under 10 words. | 11    |

Total on-slide word count: **from about 1,150 down to about 320.**

---

## Before you present, confirm four things

1. **The escalation hours are wrong in the old deck, and they are corrected here.** The old
   slide 16 said "4 hrs" in one line and "3 hours (modifiable)" in the next. Neither is right.
   What the system actually does (BSpec 5.4): the **broadcast** goes out at **T-3h** and the
   shift stays claimable. The **pickup lock and the automatic float lookup** both fire at
   **T-2h**. Slide 20's diagram uses those two numbers. Say those two numbers.

2. **The Allied contact ladder changed on 2026-07-29 and the old deck predates it.** It is no
   longer "the RSM during working hours, the HMOD outside them." It is now a fixed three rung
   ladder for everyone, always: **RSM, then HM, then HMOD** (BSpec 5.4a). The HMOD is rung
   three and terminal. Slide 20 build 3 is drawn to the new ladder. Do not describe the old one.

3. **The pre-shift reminder is not built yet.** Slide 12 claims a reminder before every shift.
   Per `screenshot-manifest.md`, there is no `shift_reminder` notification type, no cron, and no
   local scheduling on either client. The widget half is real and captured. Either build the
   reminder before the pilot, or change slide 12 to the widget alone.

4. **The Excel export is not built yet.** Slide 25 is the exit promise. The builder exports
   HTML and print to PDF today. There is no .csv or .xlsx download. Either build it or say
   "export the schedule" rather than "download the Excel sheet."

No adoption numbers, worker counts, or dollar costs anywhere. No em dashes anywhere.
"The Housing Manager" stands in for a real name on slide 23.

---

# The six diagrams

Build these first. Everything else is a screenshot you already have or a single line of text.

---

## DIAGRAM 1 - Today's float chain (slide 6)

**The job:** make the length of the chain visible so you never have to read the six steps out
loud. The room should feel "that is too long" before you say a word.

**Layout:** one horizontal chain, left to right, across the full slide. Six nodes. Between each
pair of nodes, a small arrow labelled with the medium and a **clock icon**, because every hop is
a wait on a human.

```
[Worker drops]  →  [House RSM]  →  [Other houses]  →  [Quad]  →  [Harnwell RSM]  →  [One worker]
                 email          email, no reply     email       email             asks, waits for reply
```

Then a **seventh box, offset below the end**, in a different colour: `Two spreadsheets updated by hand`.

**Under the chain, three counters, large:**

```
6 steps      4 people      2 spreadsheets
```

**One line under that, in red or your accent colour:**

```
Every arrow waits on somebody reading something and remembering to act.
```

**Design notes:** keep every node a plain grey box. The only colour on the slide is the counters
and the red line. If you have build animation, reveal the six nodes one at a time, quickly, then
drop the counters. The reveal is what sells the length.

**On-slide words: 24.**

---

## DIAGRAM 2 - Open shifts (slide 15)

**The job:** show that one drop reaches everyone at once, and the race resolves itself. This is
the visual answer to the Gregory story from slide 3, so draw both halves.

**Layout:** two stacked bands, clearly labelled `Today` and `In the app`.

**Top band, `Today`:** one person icon on the left, four separate arrows fanning out to four
house icons. Each arrow labelled `email`. Under the first house, a green tick and `replied first`.
Under the other three, a grey X and `never told it was gone`.

**Bottom band, `In the app`:** one person icon on the left, a **single** arrow into one wide box
labelled `Open Shifts feed`. Out of that box, four arrows to four house icons, all at once, all
the same weight. On the box, a small badge: `my house + other houses`.
Then one worker taps `Claim`, and the feed box turns grey with `Gone. Instantly. For everyone.`

**On-slide words: 18** (`Today`, `In the app`, `email`, `replied first`, `never told it was gone`,
`Open Shifts feed`, `my house + other houses`, `Claim`, `Gone. Instantly. For everyone.`)

**Design note:** the whole argument is the shape. Top band is a fan with three dead ends. Bottom
band is a fan with no dead ends. Do not add explanatory text.

---

## DIAGRAM 3 - Swaps (slide 16)

**The job:** show the manager is not in the loop. That is the entire point of the slide.

**Layout:** two worker cards facing each other, their shifts underneath, and two crossing arrows.

```
   Priya                              Marcus
   Tue 4pm to 8pm   ⇄ crossing arrows ⇄   Thu 12pm to 4pm

              [ Request ]  →  [ Accept ]
                     ↓
        Both schedules update. No email.
```

**Off to the right, deliberately outside the loop:** a dashed, greyed box labelled `You`, with
nothing connecting it to anything. Under it: `0 emails. 0 approvals.`

**One small note under the arrows, because it is the question she will ask:**

```
Partial swaps allowed. Requests expire on their own.
```

**On-slide words: 22.**

**Design note:** the dashed disconnected `You` box is the joke and the payload. Make sure it reads
as "excluded on purpose", not "broken". A soft grey dashed outline, no red.

---

## DIAGRAM 4 - The escalation chain (slide 20)

**The big one.** This replaces the old slide 16 entirely, including its wrong hour numbers. It is
one slide with **three build stages**. If you would rather not animate, split it into three
consecutive static slides, but do not put all three stages on screen at once. Nobody reads a
25-node flowchart.

**Standing title, present on all three builds:**

```
An open seat at your desk. Every path ends covered.
```

---

### Build 1 - The three ways it ends covered

Start with a gate, because this is the non-obvious rule and it protects you from the
"so it floats people constantly?" objection.

```
        [ A seat is open ]
                ↓
     ◇ Would the desk be EMPTY? ◇
        │no                    │yes
        ↓                      ↓
[ Stays claimable.      [ Open Shifts feed ]
  Nothing fires. ]              │
                    ┌───────────┼───────────────────┐
                    ↓           ↓                   ↓
             [ Someone       [ T-3h:            [ You force
               claims it ]     nudge to           a float,
                    │          subscribed         any time ]
                    │          workers ]              │
                    │              │                  │
                    │              ↓                  │
                    │      [ T-2h: still open.        │
                    │        Pickup locks.            │
                    │        Float runs. ] ───────────┤
                    ↓                                 ↓
              ✓ COVERED                        → to Build 2
```

**The one line to put under Build 1:**

```
In none of these does anyone have to remember to do anything.
```

**Design notes:** the `no` branch on the gate is the quiet win. Draw it, then grey it back, so it
reads as "handled, moving on." The three parallel paths should be visually equal weight, because
the point is that all three exist and all three work.

---

### Build 2 - What the float does

The three earlier paths converge here. Keep Build 1 on screen, greyed to about 30 percent, and
bring this in bright.

```
              [ Float lookup runs ]
                       │
          ┌────────────┴────────────┐
          ↓                         ↓
 [ Floater found ]          [ No one eligible ]
          │                         │
          ↓                         │
 [ Push + a card that               │
   will not go away                 │
   + the home screen widget ]       │
          │                         │
    ┌─────┴──────┐                  │
    ↓            ↓                  │
[ Accept ]  [ Decline]               │
 ✓ COVERED       │                  │
                 └────────┬─────────┘
                          ↓
                    → to Build 3
```

**Two labels worth adding, small, on the edges:**

- On the `Floater found` edge: `Quad first, then Harnwell. Never below one worker at the source.`
- On the `Push + card + widget` box: `Reminders get louder: 6h, 2h, 1h, 30m, 5m.`

**Design note:** the `Accept` path is the fat green one. The failure path is thin and grey. The
room should see that missing a float is the narrow exception, not the default.

---

### Build 3 - When nobody answers, it climbs

This is the part she personally cares about, because it is the part that reaches her. Keep builds
1 and 2 greyed, bring the ladder in bright.

```
        [ Allied coverage request opens ]
                       │
                       ↓
              ┌─────────────────┐
              │  1.  RSM        │ ──┐
              └────────┬────────┘   │
                       │ timeout    │
                       ↓            │  any manager who can
              ┌─────────────────┐   │  build for the house
              │  2.  HM         │ ──┤  can acknowledge and
              └────────┬────────┘   │  stop the ladder
                       │ timeout    │
                       ↓            │
              ┌─────────────────┐   │
              │  3.  HMOD       │ ──┘
              │     terminal    │
              └────────┬────────┘
                       ↓
        [ Close it out: what actually happened? ]
         Allied secured · Covered internally ·
         Desk went unstaffed · No longer needed
```

**Two callouts beside the ladder:**

- `A rung with nobody reachable is skipped straight away, not waited on.`
- `It never fans out to other managers or other houses.`

**The line under Build 3, and this is the one to land:**

```
It only reaches a person when it genuinely needs one.
```

**Design notes:** number the rungs, big. The `terminal` label on rung 3 matters, because the
obvious question is "and then what?" and the answer is "it stays there and keeps reminding
somebody, it never gives up and it never quietly disappears."

**Accuracy anchors for this diagram** (so it can be checked, and so it survives a technical
question): BSpec 5.4 for the T-3h and T-2h steps and the empty-desk gate, 5.4a for the three rung
ladder and the four close-out outcomes, 6.2 for Quad before Harnwell, 6.6 for force trigger,
7.1 for the T-10m deadline and the five reminders, 7.3 for the silent-at-T-10m path.

---

## DIAGRAM 5 - Four tools, none connected (slide 9)

**The job:** the turn in the story. It has to look broken without saying "broken."

**Layout:** four icons spread across the slide with **deliberate empty space between them and no
lines at all**. That negative space is the whole idea.

```
   📄 Spreadsheet        💬 Text            ✉️ Email          📞 Call
   goes stale         gets buried       easy to miss      needs a number
```

**Under them, one line:**

```
None of them talk to each other. None of them is live.
```

**On-slide words: 22.**

**Design note:** resist every instinct to connect the icons. If your slide software auto-aligns
them into a neat row, nudge them out of alignment slightly. Scattered reads as chaos, a tidy row
reads as a system.

---

## DIAGRAM 6 - What gets kept, and what does not (slide 22)

**The job:** answer the privacy question with a picture, so it lands as a design decision rather
than a reassurance.

**Layout:** a short left to right pipeline with a visible filter in the middle.

```
[ An incident, a page,       [ ✂ Names, IDs, anything     [ The lesson,
  a manager's guidance ]  →    pointing at a person   →     stored ]
                               removed here ]
```

Above the filter, a small red label: `Nothing past this point identifies anyone.`

**Under the pipeline, one line:**

```
The lesson is kept. The person is not.
```

**On-slide words: 24.**

---

# The slides

---

## Section 1 - What this is

### Slide 1 - Title

**Type:** Statement

```
Shift@PennHousing
One app for desk staffing.
```

_(Was 14 words. Now 6. The "no more emails, texts and spreadsheets" line is the next three
slides, so do not spend it here.)_

---

## Section 2 - Her day today

### Slide 2 - The inbox

**Type:** Statement

```
Your inbox is the scheduling system.
```

_(Was 15 words. Now 6.)_

---

### Slide 3 - First reply wins

**Type:** Diagram. Reuse the **top band of Diagram 2** on its own here.

```
One open shift. Four emails. Three people turned away.
```

**Why it is its own slide now:** this is the Gregory story, and it is the single most concrete
pain in the deck. It was buried as a sub-bullet before. When Diagram 2 shows up at slide 15, the
bottom band lands as a direct answer to a picture the room has already seen.

_(New slide. 9 words.)_

---

### Slide 4 - The sheet is already wrong

**Type:** Evidence

**Visual:** a spreadsheet, with one name circled in red and a small tag reading
`swapped 6 days ago, email never read`.

```
You cannot read the sheet and trust it.
```

_(Was 17 words. Now 8.)_

---

### Slide 5 - Picked it up, then forgot

**Type:** Statement

```
Picked it up. Forgot. The desk sits empty.
Nobody did anything wrong.
```

_(Was 12 words plus notes. Now 12 words, and the second line is the point rather than a note.)_

---

## Section 3 - Floating

### Slide 6 - What it takes today

**Type:** Diagram 1

```
Floating: sending a worker from one house to cover another.
```

Plus the chain, the three counters, and the red line, all specified in Diagram 1.

_(Was 62 words. Now 24.)_

---

### Slide 7 - Three ways a float dies

**Type:** Statement, as three cards

```
Never saw it.        Said yes, forgot.        Never replied.
```

Three equal cards, one line each, nothing else. Optionally a faint icon per card: an unopened
envelope, a calendar with nothing on it, a message with no reply.

_(Was 58 words. Now 8. This is the single biggest cut in the deck, and the one that will feel
most uncomfortable. Trust it. You tell all three stories out loud, and three words each is
exactly enough scaffolding for the room to follow you.)_

---

### Slide 8 - Nobody could reach anyone

**Type:** Diagram, small and custom

**Visual:** the Hill desk in the middle. Two arrows coming in from Harnwell, drawn as two separate
people who cannot see each other (a dotted line between them with a small X on it). A phone icon
beside the Hill desk with a question mark.

```
Two floaters walked to Hill. Neither knew about the other.
```

_(Was 55 words. Now 9. The story is yours to tell. The picture just holds the shape of it while
you do.)_

---

### Slide 9 - Nobody failed. The tools did.

**Type:** Diagram 5

```
Nobody failed. The tools did.
```

Plus the four scattered icons and the "none of them talk to each other" line.

_(Was 40 words. Now 22 including the diagram labels.)_

---

## Section 4 - From the worker's side

### Slide 10 - One live schedule

**Type:** Evidence

**Visual:** `slide-10a-ios-my-shifts.png` and `slide-10b-ios-house-week-grid.png`, side by side.

```
Not a copy of the schedule. The schedule.
```

_(Was 18 words. Now 8.)_

---

### Slide 11 - Tap anyone to call them

**Type:** Evidence

**Visual:** `slide-10c-ios-contact-card-call.png`, large, with the Call button visibly highlighted.
If you can, put a small ghosted version of slide 8's Hill diagram in the corner.

```
Tap anyone on the schedule. Call them.
```

**Why it is split from slide 10:** it is the direct answer to the Hill story, and it deserves to be
seen as one, not as the third bullet on a screenshot slide.

_(New slide. 7 words.)_

---

### Slide 12 - Where they already look

**Type:** Evidence

**Visual:** `slide-11a-ios-home-screen-widget.png` beside
`mockup-shift-reminder-c-wrong-desk.png` ("Heads up: you're at DuBois today").

```
Their next shift, on the home screen.
```

⚠️ See confirmation 3 at the top of this file. The reminder half is a mockup, not a shipped
feature. If it is not built by the pilot, drop the mockup and run this slide on the widget alone,
which is real and captured.

_(Was 24 words. Now 7.)_

---

### Slide 13 - Open shifts

**Type:** Diagram 2, with `slide-12a-ios-open-shifts-feed.png` small in the corner

```
One feed. One tap. Gone for everyone.
```

**Why this is now its own slide:** it was previously line one of four on a slide it shared with
swaps and breaks, which is why it never got the attention it earns. It is the mechanism that takes
the inbox to zero, and it is the direct answer to slide 3.

_(Was one line of a 4-line slide. Now a full slide, 7 words plus the diagram.)_

---

### Slide 14 - Swaps

**Type:** Diagram 3, with `slide-12b-ios-incoming-swap.png` small in the corner

```
Two workers. A few taps. You are not in the loop.
```

_(Was one line of a 4-line slide. Now a full slide, 11 words plus the diagram.)_

---

### Slide 15 - Break shifts

**Type:** Evidence

**Visual:** `slide-12c-ios-break-picker.png`. Use
`slide-12c-alt-ios-break-picker-claiming.png` instead if you want the gesture visible.

```
Pick from a calendar. First come, first served.
Whatever is left flows into Open Shifts.
```

Draw a small arrow from the calendar to a miniature of the Open Shifts feed, so the connection to
slide 13 is visual rather than spoken.

_(Was one line of a 4-line slide. Now a full slide, 15 words.)_

---

## Section 5 - When a desk is uncovered

### Slide 16 - A float you cannot ignore

**Type:** Evidence, three panels

**Visual:** `mockup-float-b-urgent.png`, `slide-13a-ios-float-card-home.png`, and
`slide-13b-ios-widget-pending-float.png`, in a row. Label each in two or three words:

```
A push.        A card that stays.        On the home screen.
```

**Under all three:**

```
One tap: yes or no.
```

_(Was 45 words. Now 14.)_

---

### Slide 17 - Every path ends covered

**Type:** Diagram 4, three builds

This replaces the old slide 16 and folds it into the float story, where it belongs. It also fixes
the two wrong hour numbers.

_(Was 78 words across two slides. Now one slide, about 45 words across three builds, and none of
them are on screen at the same time.)_

---

## Section 6 - From the manager's side

### Slide 18 - Building the schedule

**Type:** Evidence

**Visual:** `slide-14a-web-schedule-builder-ai-panel.png`. See the gap note in
`screenshot-manifest.md`: the builder renders but the grid is empty because the preference
deadline is still open. If you cannot close a deadline and generate before you present, use
`slide-16a-web-live-calendar.png` instead, which is populated and carries the same point.

```
It drafts. You decide.
```

**Optionally, a small before and after strip under the screenshot:**

```
Before: everyone's Excel, open at once.
After: a draft, then your edits.
```

_(Was 71 words. Now 5, or 18 with the strip.)_

---

### Slide 19 - Hours

**Type:** Evidence

**Visual:** `slide-15a-web-hours-report.png`

```
When approving timesheets, see every SWs hours with ease.
It shows you their total hours, plus any shifts they worked outside: how long, what time, when, and where that shift was worked
```

_(Was 34 words. Now 5. This slide had the most text and the least need for it. The screenshot is
a table of numbers, and it argues better than any sentence you could put above it.)_

---

## Section 7 - The problem nobody has solved yet

### Slide 20 - Things I did not know

**Type:** Statement, three lines

```
A resident needs to check in. I cannot remember how.
Temp card, and they do not know their Penn ID. Now what?
Belfor wants in through the back door. Are they allowed?
```

_(Was 41 words. Now 34. Barely cut, deliberately. These three questions are the content of the
slide, not a summary of it, and each one is a story you tell.)_

---

### Slide 21 - We did write it down

**Type:** Evidence

**Visual:** a photograph of the binder. A real one, on a real desk. If you can get a shot of both
the summer and the fall binder side by side, better.

```
We wrote it all down.
Nobody opens this at 11pm.
```

_(Was 33 words. Now 10.)_

---

### Slide 22 - Meet Snoopy

**Type:** Evidence

**Visual:** `slide-19a-ios-ask-snoopy.png` and `slide-19b-web-ask-snoopy.png`

```
Ask it the way you would ask a coworker.
```

**Small, underneath:**

```
Answers only from what this desk knows.
Not sure? It tells you to escalate.
```

⚠️ Per `screenshot-manifest.md`, both shots are the question screen, not an answer. The local
knowledge base has zero documents. If you want a mid-answer screenshot, ingest documents locally
and capture on the web build first.

_(Was 51 words. Now 21.)_

---

### Slide 23 - Privacy

**Type:** Diagram 6

```
The lesson is kept. The person is not.
```

Plus the pipeline and the filter, as specified in Diagram 6.

_(Was 32 words. Now 24 including the diagram labels.)_

---

## Section 8 - Bringing it together

### Slide 24 - Every problem, and where it went

**Type:** Statement, as a two column list

```
Email overload            →   happens in the app
Hours paperwork           →   writes itself
No live picture           →   one live screen
No-shows                  →   reminders and the widget
Float never seen          →   impossible to miss
Float forgotten           →   already on their schedule
Cannot reach the floater  →   tap to call
Knowledge walks out       →   Snoopy
```

Reveal these one row at a time if you can. All eight at once and the room reads ahead of you.

_(Was 78 words. Now 40.)_

---

## Section 9 - The ask

### Slide 25 - Pilot it this fall

**Type:** Statement

```
Run real staffing through the app this fall at Harnwell.
```

_(Was 60 words. Now 26.)_

---

### Slide 26 - Closing

**Type:** Statement

```
Today, keeping the desks covered runs on your inbox
and everyone's memory.

Let's prove it can run on the app instead.
```

Deliver it slowly. Add nothing after it.

_(Unchanged. It was already the right length.)_

---

# Appendix, for you only, not slides

## The seven lines to have automatic

With no speaker notes, these are the only things worth memorising. Everything else you can say in
your own words, because you built it.

1. **The chain today:** "every arrow waits on somebody reading something and remembering to act."
2. **The turn:** "the manager becomes the human glue holding all of it together by hand."
3. **The live schedule:** "this is not a copy of the schedule that gets updated. It is the schedule."
4. **The float:** "if someone does miss it, you know they missed it while there is still time to act."
5. **The chain now:** "it only reaches a person when it genuinely needs one."
6. **The binder:** "the binder is a reference book. What people need at the desk is an answer."
7. **The ask:** "I built the exit before I built the pitch, because a tool you cannot leave is a
   tool you should not adopt."

## Demo plan

Unchanged from the previous outline. Script it as the screenshots already in the deck, and repeat
a step live only if the room is warm. The riskiest live moment is Snoopy, and per the manifest the
local knowledge base is empty, so keep the screenshot as the fallback.

## Objections

Unchanged from `Final Slides Outline.md`, with one correction: on "who gets pulled in when a desk
cannot be covered", the answer is now the three rung ladder, RSM then HM then HMOD, not the old
hours-dependent split. The HMOD is the last rung, not the first contact.

## What changed from the previous outline, in one place

| Change                                      | Why                                                           |
| ------------------------------------------- | ------------------------------------------------------------- |
| Speaker notes removed entirely              | Your request                                                  |
| On-slide text cut from about 1,150 to 320   | The room cannot read and listen at the same time              |
| Open Shifts split onto its own slide        | It was line 1 of 4 and never got the attention it earns       |
| Swaps split onto its own slide              | Same                                                          |
| Break shifts split onto its own slide       | Same, and it connects visually back to Open Shifts            |
| Gregory story promoted to its own slide (3) | Sets up Diagram 2 so the fix lands against a picture they saw |
| Contact card split from the schedule slide  | It is the answer to the Hill story and was buried             |
| Old slide 16 folded into the float diagram  | It was the same content as the chain, with wrong hour numbers |
| T-3h and T-2h corrected                     | Old deck said 4h and 3h. Both wrong per BSpec 5.4             |
| Allied ladder redrawn as RSM, HM, HMOD      | BSpec 5.4a, amended 2026-07-29. Old deck predates it          |
| Six diagrams specified                      | The concepts that were hardest to explain out loud            |
