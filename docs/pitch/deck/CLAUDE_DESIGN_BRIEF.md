# Design brief: four conference-style slides

Paste everything below the line into Claude Design. Attach `float-shot.png` (the phone
screenshot) alongside it. Do NOT attach `v1-baseline.html`, so the response is an
independent take rather than a variation on what we already have.

---

## What I need

Four slides from a longer presentation, built as **one self-contained HTML file**. I want a
distinctive, well-crafted visual system that I can then apply across the remaining 34 slides.
Design the system, and show it working on these four.

## Context you need, and nothing more

The presenter is a student who works front-desk shifts at a university residence, presenting
to his manager, who runs desk staffing across 13 buildings. The subject is a scheduling app
he built to replace the current process of emails, spreadsheets, group chats, and phone
calls. The deck's structure is: state every problem, then walk them one at a time, pairing
each problem with what the app does instead.

The four slides below are representative of the whole deck. Between them they cover the four
compositions I need solved:

1. A **grid of parallel items** (an inventory of problems)
2. A **verbatim quoted artifact** (a real message, reproduced exactly)
3. A **hero statistic** paired with a small timeline
4. A **split**: text on the left, a phone screenshot on the right

## Audience and setting, which should drive your choices

- She is **not technical**. Nothing clever, nothing that needs decoding.
- This is **projected in a meeting room with the lights on**. Legibility beats subtlety.
  Thin light-gray text on white will disappear. Assume a mediocre projector with washed-out
  contrast.
- She **lives this problem daily** and is sympathetic to it. The tone is diagnosis and
  relief, not alarm. Avoid anything that reads as a scare-tactic sales deck.
- The presenter speaks over each slide for roughly 80 seconds. Slides support the talk, they
  are not the talk. Restraint is correct.

## Hard constraints

1. **The copy is final and immutable.** Use the exact strings in the appendix. Do not
   rewrite, shorten, embellish, or "improve" any of it, and do not add new copy: no invented
   taglines, subtitles, labels, statistics, feature names, or filler. Every word has been
   fact-checked against the real system, and anything you add would be unverified. If a
   layout needs a label that is not in the appendix, use one of the section names given.
2. **No em dashes or en dashes anywhere.** Use periods, commas, colons, or parentheses. This
   is a house style rule with no exceptions.
3. **16:9 slides**, fixed aspect ratio, each rendered as a discrete slide-shaped block. I
   will present from a browser. Stack the four vertically on the page so I can scroll through
   them.
4. **Fully self-contained.** No external requests of any kind. No CDN scripts, no external
   stylesheets, no font URLs, no remote images. A strict CSP will block them and the page
   will silently fall back. If you want a specific typeface, embed it as a base64 data URI.
   Otherwise use a system font stack, and pick it deliberately.
5. **The phone screenshot is attached and is dark-themed** (a dark UI with a blue accent).
   It is a real screenshot and cannot be recolored or re-rendered. Design around it. Embed
   it as a data URI. It may be cropped, framed, given a device bezel, angled, masked, or
   bled off the slide edge, whatever serves the design, as long as the float request card
   with its Accept and Decline buttons stays legible.
6. **Avoid orange, amber, brown, and rust entirely.** Previously explored and rejected: they
   read as muddy when projected. Reds should be used sparingly if at all.
7. **Blue is the product's own color** and should remain the accent that signals "the app"
   or "the fix." The specific blue is yours to choose; the app's own UI blue is roughly
   `#0061FC` and appears in the screenshot, so whatever you pick should sit comfortably
   next to it.

## What is open to you

Everything else. Palette, typography and type pairing, scale and hierarchy, grid,
composition, how much white space and where, how the eye is led, how quoted material is
treated, how the statistic is dramatized, whether slides carry any recurring furniture like
a progress indicator or section marker.

I would rather see a strong point of view than a safe one. If you want to commit to a single
visual world (a strictly typographic system, an editorial broadsheet feel, a precise
technical-document look, something else) then commit to it fully across all four.

Two things worth knowing about the content, which may or may not affect your approach:

- The **contrast between "today" and "with the app"** runs through the entire deck. Some
  visual mechanism for that opposition, applied consistently, would earn its keep.
- **Slide 2 is the emotional low point** of the deck and slide 4 is the relief. They should
  not feel the same.

## Appendix: exact copy

### Slide 1. Problem inventory (grid)

- Section label: `The problem`
- Headline: `Seven things that go wrong today`
- Supporting line: `Every one of these still runs on an inbox, a group chat, or someone's memory.`
- The seven items, numbered 01 through 07, in order:
  1. `Drops turn into an email negotiation`
  2. `Pickups are a group chat lottery`
  3. `Picked up, then forgotten`
  4. `Floating runs on email and trust`
  5. `Paged for what experience already answers`
  6. `The pages that matter arrive incomplete`
  7. `Schedules are built by hand`
- Closing line: `Seven problems. One cause. Stop me on any of them.`
- Note: item 04 is the one the deck spends the most time on later. Marking it somehow is
  welcome but optional.

### Slide 2. Verbatim artifact (the emotional low point)

- Section label: `Picking up a shift`
- Headline: `I claimed a shift. It was already gone.`
- Attribution line: `Direct message, from a Harrison student manager, 3:32 PM`
- The quoted message, reproduced exactly:

  `Hi Andrew, this is Adailia from Harrison! I made an error on my end and listed Mon 5-9pm as an available shift, it was taken by someone else prior. My apologies for that, but please let me know if you'd like any of the remaining shifts in the main gc!`

- Within that quote, emphasize this fragment: `it was taken by someone else prior`
- Closing line: `The shifts are not unfillable. People have learned not to bother.`
- This slide should feel quiet and should sit with the reader. It is the one moment in the
  deck that is allowed to be uncomfortable.

### Slide 3. Hero statistic

- Section label: `Floating, failure 3`
- Headline: `Nobody knows if the floater is coming`
- The statistic: `5h45m`
- The statistic's caption: `to confirm one hour of cover`
- Timeline, three entries:
  - `3:20 PM` / `The float request goes out by email.`
  - (a gap, no timestamp) / `No reply. No status anywhere. Nobody can tell whether the desk is covered.`
  - `9:05 PM` / `The worker replies to acknowledge.`
- Closing line: `Real dates, one of my own floats to Mayer Hall.`

### Slide 4. Split, text and phone screenshot (the relief)

- Section label: `What happens now`
- Headline: `The float finds them, and answers back`
- Supporting line: `No email to miss. It arrives as a notification and a card they cannot scroll past.`
- Four items:
  - `Accept or decline with one tap.`
  - `A visible deadline, counting down.`
  - `Reminders at 6h, 2h, 1h, 30m, and 5m.`
  - `You see who has answered, at a glance.`
- The attached screenshot goes on this slide.
