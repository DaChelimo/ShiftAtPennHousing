# Revised Stakeholder Deck Guidance

I reviewed the outline and the biggest opportunity is not the slide structure, but the speaker notes.

## Recommended changes

- Keep slides visually minimal. Aim for one core idea per slide.
- Reduce speaker notes to 3–6 bullets.
- Replace references like "Callback: slide 3" with natural transitions (e.g. "Earlier we saw that schedules quickly become outdated...").
- Each note should contain:
  - Opening sentence
  - 2–3 supporting beats
  - One memorable closing line
- Reserve detailed implementation for an appendix or Q&A.

## Overall assessment

The story arc is already strong:

1. Establish pain
2. Show why current tools fail
3. Introduce the solution
4. Demonstrate how each capability removes a specific pain
5. End with a low-risk pilot

The largest improvement will come from shortening the presenter notes rather than changing the overall flow.

---

Below is the original outline for editing.

# Shift@PennHousing — Stakeholder Presentation Outline v2 (Content Only)

> STATUS: Draft for wording review. No layout, visuals, colors, or .pptx work happens until
> you sign off on this text.
> PRIMARY SOURCE: `docs/pitch/monday-superior-info-sheet.md` — this rewrite treats that file
> as the spine of the story. Everything else (BSpec/ARCH) is used only to confirm the info
> sheet's claims and to fill in the "what's built" slides.
>
> LENGTH: 23 slides. The compression rule was: **a slide earns its place if it is a distinct
> root cause or a distinct decision, not if it is a distinct feature.** That is why the five
> floating failures are now three slides (failures 1, 2, and 3 share one root cause and later
> share one answer), and why several v1 slides became a spoken line on a neighbouring slide
> instead of a frame of their own.
>
> IF YOU NEED 22: cut slide 9. The turn ("nobody failed, the process did") can be delivered
> over slide 8 instead of getting its own frame. It is the only slide here that is pure
> punctuation. Do not cut slides 13, 15, or 21, they carry the most weight.

## How to read the speaker notes

Notes are written to be **glanced at, not read**. Every slide follows the same shape so your
eye always knows where to land:

| Marker               | Means                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Plain bullet         | A beat to hit. Your own words.                                                                             |
| **Say:** "..."       | Worth delivering close to verbatim.                                                                        |
| **THE LINE:** "..."  | The one line on that slide worth landing perfectly. If you only nail one thing, nail this.                 |
| **Callback:**        | Name the earlier slide out loud. This is what makes the walkthrough feel like an answer instead of a demo. |
| ⚠️                   | A caution or something to confirm before you present.                                                      |
| Indented sub-bullets | Detail you only need if the room asks. Skip freely.                                                        |

Bullets are in delivery order. Nothing is a paragraph, so you can find your place after
looking away.

---

## ⚠️ Read first: audience

The info sheet targets a **single direct superior, Monday, who personally feels the daily
staffing pain** — not a broad "residential life leadership" audience. Per the info sheet's
own golden rules:

- **Lead with admin burden and worker experience. Never lead with money or technology.**
- **Pain before fix, every slide.** Never show a feature before the audience feels the
  problem it removes.
- **The floating story is the emotional centerpiece.** It still gets the most room.
- **End with a small, low-risk ask: a pilot.**

If this is actually going to a broader leadership audience, the ask and tone on the final
slides need to change. Confirm before wording locks in.

## ⚠️ Three things to confirm before you present

1. **The pickup cutoff hour.** You said three hours. In the code, the three-hour step is the
   _broadcast_ (the shift is still claimable then), and the step that _locks_ pickup and
   starts float escalation runs at _two_ hours out. Slide 16 is worded to survive either
   answer, but decide which number you want to say out loud.
2. **The Excel exit ramp.** Today the builder exports **HTML and print/PDF**
   (`apps/web/lib/export/scheduleHtml.ts`). There is no `.csv` or `.xlsx` download anywhere
   in the codebase. Slide 22 is worded honestly around what exists. If you want to say
   "download the Excel sheet" on stage, that export needs building first.
3. **The persistent break card.** Written as you described it, now folded into slide 12.
   Verify on a device that it genuinely does not dismiss.

**Also:** no adoption numbers, worker counts, or dollar costs anywhere, per the info sheet.
No em dashes or en dashes in any on-slide text or speaker notes. I used "the Housing
Manager" rather than a real name in the privacy story on slide 20.

---

## Section 1 — What this is

### Slide 1 — Title

**On-slide text:**

```
Shift@PennHousing
One app for desk staffing. No more emails, texts, and spreadsheets.
```

**Speaker notes:**

- Open simple. Do not oversell here, the pain does the selling.
- One app that replaces the scattered emails, spreadsheets, GroupMe chats, and phone calls.
- **Say:** "and I am going to tell you how."
- Do not explain anything else yet. Go straight to the next slide.

---

## Section 2 — Her day today

### Slide 2 — Your inbox is the scheduling system

**On-slide text:**

```
Every swap, pickup, and drop becomes an email
A worker covers another desk? More email, to you and both managers, just to prove it happened
Your inbox is doing a job an inbox cannot do
```

**Speaker notes:**

- Frame: two email problems, same root cause.
- **PROBLEM 1, volume.** Every swap, drop, and pickup becomes an email you cannot even act on.
  - Written by students, read by you or the SMs, then typed into the Google Sheet.
  - Your inbox is where residents reach you and where leadership passes information. This
    buries that.
  - Harnwell is worse: you get it from your own students **and** from other houses' RSMs.
- **The Gregory story.** Tell this one properly, it is the strongest thing in the section.
  - She emails several houses at once for one open shift. First to claim wins.
  - The other houses never learn it is gone. People reach out and get turned down.
  - **Say:** "that is a core motivation behind this product."
- **PROBLEM 2, documentation.** Work a desk that is not yours, and someone emails the RSM plus
  the student managers of both houses, purely as proof.
  - So approving hours means reading the schedule **and** searching old emails for evidence.
  - **THE LINE:** "approving hours takes far longer than it should, and none of that time is
    actually spent deciding anything."

---

### Slide 3 — No live picture of what is actually happening

**On-slide text:**

```
The truth is spread across inboxes, texts, and spreadsheets
No single screen you can trust
```

**Speaker notes:**

- Two workers swap and send an email. The email sits unread. The schedule is now wrong.
- Where it actually bites: someone is late, the person at the desk wants to call and ask if
  they are on the way, and the sheet names the wrong person.
- **THE LINE:** "you cannot read the house spreadsheet and fully trust it."

---

### Slide 4 — Picked it up, then forgot

**On-slide text:**

```
A worker picks up a shift, then forgets
The desk sits empty
```

**Speaker notes:**

- One of the biggest problems, and worse during the academic year.
- Why: people settle into patterns. They know their **own** shifts cold, which is exactly why
  a one-off pickup is the thing that gets lost.
- Two options today, both bad:
  - Do not add it to your calendar, and risk forgetting. Very likely. Has happened to me.
  - Add it, but that is enough friction that people stop once they are picking up several.
- **THE LINE:** "the desk sits empty and nobody did anything wrong."

---

## Section 3 — Floating: the centerpiece story

### Slide 5 — Floating, and what it takes today

**On-slide text:**

```
Floating: sending a worker from one house to cover another

Today, when a shift needs a floater a week out:
- Worker drops a shift, nobody picks it up
- The house RSM emails other houses looking for interest
- No interest, so they email Quad, then Harnwell
- Harnwell RSM asks a specific worker to float
- That worker has to reply, and remember to add it to their calendar
- Two houses' spreadsheets have to be updated
```

**Speaker notes:**

- Open personal: "one of the first things I learned working at Harnwell is floating."
- Three kinds, name them fast:
  - No-show, someone does not turn up. Manageable today, it is a phone call.
  - Uncovered open shift, a few hours out.
  - **Advance coverage, days ahead.** This is the one that breaks, and it is the chain on
    screen.
- Walk the chain slowly. Do not rush it, the length is the argument.
- Count it out loud: six steps, four people, two spreadsheets.
- **THE LINE:** "every single step depends on somebody reading something and remembering to
  act."
- **Say:** "if that felt long, it is because it is long."
- Set up what follows: "the next three slides are the places it fails, and I have seen every
  one of them."

---

### Slide 6 — Three ways a float dies in an inbox

**On-slide text:**

```
They never saw the request. They never knew they were supposed to float.
They saw it, said yes, and forgot to add it. Autopilot took them to their home desk.
They never replied at all. Nobody knows if coverage is coming until the shift starts.
```

**Speaker notes:**

- Frame first: three separate failures, **one** root cause. It lives in an email, and
  everything after depends on human memory.
- **(1) Never saw it.** The request is in an inbox. If it is missed, they have no idea they
  were ever asked.
  - **Say:** "nobody did anything wrong. It just never reached them."
- **(2) Saw it, agreed, forgot to add it.** Autopilot sends them to their home desk.
  - The desk they were meant to cover is empty, and they are sitting at one that did not
    need them.
- **(3) Never replied.** This is the expensive one, slow down.
  - You cannot tell "help is coming" from "nobody is coming" until the shift starts.
  - **THE LINE:** "you are making decisions blind for a week."
- Plant the setup: keep these three together in your head, because later one mechanism
  answers all three at once.

---

### Slide 7 — Nobody can reach the floater

**On-slide text:**

```
8:05pm. The floater is five minutes away.
The Hill worker does not know that, and calls Harnwell for a floater.
Now two floaters are walking to Hill, and paid coverage has been secured for nothing.
The desk is double covered, because the Hill worker had no way to know who to call.
```

**Speaker notes:**

- Flag the difference: this is not the last slide. **Here everything went right.**
  - Float assigned, worker agreed, they are physically on their way.
- And it still ends badly, because the destination desk cannot reach the person walking toward
  them.
- Walk the sequence:
  - Waits five minutes. Nobody appears. Does the reasonable thing and escalates.
  - Calls the house they **think** the floater came from. Wrong house.
  - That gets paged, paid coverage gets secured, and two minutes later the real floater walks
    in.
- **THE LINE:** "nobody in that story made a bad decision. The information simply did not
  exist anywhere."

---

### Slide 8 — The rules can be gamed

**On-slide text:**

```
Quad has three workers, Harnwell has two
Quad says "we have no floater"
There is no way to check, so Harnwell covers instead
```

**Speaker notes:**

- There is no enforcement behind any of this.
- A house that does not want to send someone can simply say it has no one. No way to verify.
- The burden quietly shifts onto whichever house does not push back.
- **THE LINE:** "which means the houses that are most cooperative end up carrying the most."

---

### Slide 9 — Nobody failed. The tools did.

**On-slide text:**

```
Every failure you just heard is a person doing their best
Spreadsheets go stale. Texts get buried. Email is easy to miss. Calls need a number.
None of these tools talk to each other. None is live. None reminds anyone of anything.
```

**Speaker notes:**

- ⚠️ **This is the turn in the story. Slow down here.**
- Nobody failed at their job. The process has no memory, no live information, no way to reach
  each other, and no way to enforce fairness.
- And it is not fixable with what we have. Point at each:
  - Spreadsheet: wrong the moment anything changes.
  - Group texts: buried, no record.
  - Email: easy to miss, not a live picture of anything.
  - Phone calls: only work if you have the number and they pick up.
- **Say:** "four tools, none connected, none live, none reminding anybody of anything."
- **THE LINE:** "so the manager becomes the human glue holding all of it together by hand."
- Pivot: "that is the job this app takes off your plate."

---

## Section 4 — The app, from the worker's side

> PRESENTER FRAMING: you have spent eight slides making her feel the problem. Do not now read
> a feature list. Every slide in this section opens with a callback. Say the slide number out
> loud. That is what makes a walkthrough feel like an answer instead of a demo.

### Slide 10 — Introducing Shift: one live schedule

**On-slide text:**

```
Shift@PennHousing
Your week, the house week, and who is coming in next. Live.
Tap anyone to call them.
```

**Visual:** three panels. The worker's My Shifts screen, the house week grid, and the contact
card with the Call button.

**Speaker notes:**

- Frame: "I am going to open with the screen that answers the most problems at once."
- **Callback: slide 3, no live picture you can trust.**
- A worker sees their week as it actually is this second, not as of the last save.
  - Swapped an hour ago, it is here. Picked up elsewhere, it is here. Floated, it is here.
- **THE LINE:** "this is not a copy of the schedule that gets updated. It **is** the
  schedule."
  - No other version sitting in an inbox waiting to be applied.
  - **Say:** "almost every problem in this deck was a synchronization problem in disguise."
- Same thing at house level: every desk, every block, live.
  - The person at the desk can see who is coming in next before their own shift ends.
  - A worker covering from another house is visibly marked, with their home house shown.
- **Callback: slide 7, the Hill incident.** Tap the person, get their card and a call button.
  - **Say:** "that five minute panic that ends in paid coverage nobody needed just stops
    happening."

---

### Slide 11 — Shifts they cannot forget

**On-slide text:**

```
A reminder before every shift
Your next shift on your phone's home screen
Alerts about your own shifts cannot be turned off
```

**Visual:** the home-screen widget next to a lock-screen notification.

**Speaker notes:**

- **Callback: slide 4, picked it up and forgot.**
- Two things, and they work together.
- **(1) Reminders.** The app tells them before the shift. Nothing to check.
- **(2) The widget.** This is the one people underestimate, so give it a beat.
  - On the home screen they already look at fifty times a day. Not inside an app they have to
    open.
  - **Say:** "the problem was never that workers do not care."
  - It is that adding every pickup to a personal calendar is enough friction that people skip
    it.
  - **THE LINE:** "so we removed the step. They do not add it. It is already there."
- Personal alerts cannot be silenced.
  - **Say:** "you can mute the noise. You cannot mute your own responsibility."

---

### Slide 12 — Coverage happens between workers, not through you

**On-slide text:**

```
Open shifts, your house and every other house, in one feed. One tap to claim.
Swaps agreed directly between the two workers. One tap to accept.
Break shifts picked from a calendar, first come first served.
Nobody is cc'd. It is already in the schedule.
```

**Visual:** the open shifts feed, the incoming swap card, and the break picker calendar.

**Speaker notes:**

- **Callback: slide 2, the inbox.** This is where that volume goes to zero.
- Frame: three mechanisms, all doing the same thing, letting workers transact directly.
- **OPEN SHIFTS.** This is the Gregory story answered, say so explicitly.
  - One feed, own house and other houses, one tap to claim.
  - It disappears for everyone else that instant.
  - Nobody emails four houses. Nobody gets turned down for a shift already gone.
  - Bonus worth naming: a Gregory shift is now visible to a Harnwell worker who wants hours.
  - **THE LINE:** "that is coverage you are leaving on the table purely because two people
    never found each other."
- **SWAPS.** Offer a shift, pick what you want back, other worker taps accept. Done.
  - **Say:** "there is no approval step, because there was never anything for you to approve."
  - You were only on that email so the sheet could be updated. The sheet updates itself now.
- **BREAKS.** Drag to pick blocks on a calendar, first come first served.
  - Whatever nobody picks flows into the open shifts feed automatically.
  - A card sits on their home page until they have picked.
  - **Say:** "break coverage fails today because it is announced once, in an email, weeks
    ahead, and then forgotten."
- ⚠️ Only if asked: the rules still apply to all three. The app will not allow a claim or swap
  that breaks training requirements or leaves a desk short.

---

### Slide 13 — A float you cannot ignore

**On-slide text:**

```
A push notification
A card on the app's home page that does not go away
The pending float on your phone's home screen widget
Yes or no, in one tap
```

**Visual:** the float alert on the app home page, and the widget showing the pending float.

**Speaker notes:**

- ⚠️ **This is the payoff of the whole floating story. Slow down.**
- **Callback: the three failures on slide 6.** Never saw it, forgot it, never replied.
  - **Say:** "all three were the same failure, so one mechanism answers all three."
- Three places at once, deliberately loud:
  - A push notification when it is assigned.
  - A card on the app's home page that stays until answered. It does not scroll away and it
    does not get marked as read.
  - On the home screen widget, so even a worker who never opens the app sees they owe a float.
- Then they tap yes or no. That is the whole interaction.
- No answer? Reminders escalate: six hours, two hours, one hour, thirty minutes, five minutes.
- The manager sees acknowledgment status at a glance.
- **THE LINE:** "a float here is genuinely hard to miss. And if someone does miss it, you know
  they missed it while there is still time to act."

---

## Section 5 — The app, from the manager's side

### Slide 14 — Building the schedule

**On-slide text:**

```
The app drafts a full week for the house, reading everyone's availability and hours targets
Placing people yourself? Their target hours are on screen, and blocked workers cannot be placed
It drafts. You decide. You can edit the real schedule at any time.
```

**Visual:** the builder with the AI draft panel, and the worker picker for a single block
showing preferred, available, and blocked with hours remaining.

**Speaker notes:**

- Set up the pain in one sentence: building a week by hand is the slowest job a student
  manager has, and the one most often done late. Tedious rather than difficult.
- **The app drafts the whole week.** It reads availability, hours targets, and the house's
  staffing requirements.
- **Manual placement is still fully supported**, and that matters.
  - Click a block: who wants it, who is available, who cannot work it. Pre-sorted.
  - Each name carries their target hours and how many they have left. You see instantly who is
    under and who is nearly full.
  - A worker who marked themselves unavailable **cannot be placed there**. Not a warning you
    can click past.
- **THE LINE, and it is the one she cares about:** "it drafts, it does not decide."
  - Nothing is live until a human accepts it.
  - An SM or RSM can open the schedule and change it directly, any time, any reason, including
    reasons the app has no way to know about.
  - **Say:** "the app is very good at the work you do not want to do, and it gets out of the
    way for the work only you can do."
- Only if the room still has energy: this works all year, not just the regular semester.
  Summer runs different houses, hours, and staffing. Configure the season once and everything
  downstream follows.

---

### Slide 15 — Hours transparency, and the paper trail writes itself

**On-slide text:**

```
Every worker's total hours, always current
Every hour worked outside their own desk: how long, where, and when
The record already exists, so nobody has to build it
```

**Visual:** the hours breakdown for a worker showing home hours, floated hours, and cross-house
pickups with dates and houses.

**Speaker notes:**

- **Callback: the second half of slide 2, the emails written purely as proof.**
- Frame it directly: "I think this is the one that saves you the most personal time."
- Every worker has a running total.
- Any hour away from their home desk is broken out: how long, which house, what date.
- **Say:** "that is exactly what those emails were trying to convey, except the system
  produced it as the work happened, instead of three people reconstructing it afterwards."
- **THE LINE:** "approving hours stops being an investigation."
  - Not the schedule in one window and your inbox in another hunting for proof of a Tuesday
    float.
  - One screen, already correct.

---

## Section 6 — An open shift in your house

### Slide 16 — Three paths, and all three end covered

**On-slide text:**

```
1. It sits in the open feed and someone picks it up
2. You force a floater now, and the app runs the chain in seconds
3. Nobody acts, so past a set point pickup closes and the app takes over

The chain: check the eligible houses, assign and alert the floater,
and only if there is genuinely nobody, raise paid coverage to the right person
```

**Speaker notes:**

- Frame: "a shift is open at your desk. These are the only three things that can happen, and
  all three end with the desk covered."
- **THE LINE, say it up front and let it hang:** "in none of them does anybody have to
  remember to do anything."
- **PATH 1.** Sits in the feed, somebody claims it. Needs nobody's attention. Move on quickly.
- **PATH 2, you force a floater.** This is you choosing certainty today instead of waiting.
  - Runs the same chain you run manually, except in seconds and honestly.
  - Two hard rules it will never break: never pull a house below one worker on the desk, and
    never send anyone untrained to Harnwell.
  - Finds someone? Float assigned, and everything on slide 13 applies. You can see if they
    confirmed.
  - Genuinely nobody? Raises a paid coverage request. Business hours, the Housing Manager.
    Outside them, the manager on duty.
  - **THE LINE for path 2:** "a house cannot say 'we have no floater' when it does."
  - **Say:** "nobody has to take anybody's word for it, and nobody has to be the one who
    pushes back."
- **PATH 3, nobody acts.** This is the one a process document cannot fix.
  - A shift opens late, sits in the feed, nobody happens to look. Today that becomes an
    emergency at 7:55pm.
  - Past a set point, pickup closes, because a casual pickup that late is not reliable
    coverage.
  - Same moment, the app starts running the same chain on its own.
  - **Say:** "that cutoff is a dial, not a law of physics. If two hours or five works better,
    we change one setting."
  - **THE LINE for path 3:** "none of that sequence required a human being to notice
    anything."
- **CLOSE on the principle**, it is worth naming out loud:
  - The manager on duty gets alerted as little as possible. That is a design goal, built in
    deliberately.
  - By the time they are contacted, everything that did not need a human has been tried.
  - And it arrives with context: which desk, which hours, what was already tried.
  - **Say:** "not a forwarded email chain they have to reconstruct at eleven at night."
- ⚠️ Confirm the cutoff number before you present, see the flag at the top. If asked on the
  spot, the safe answer is "a few hours out, and it is configurable."

---

## Section 7 — The problem nobody has solved yet

> PRESENTER FRAMING: this section deliberately breaks the pattern. Every other section went
> pain first, then app, within a slide or two. This one goes back to pure problem for two
> slides before you show anything. Do not preview the solution. Let the room sit in it,
> because most of them have lived it and nobody has ever named it out loud in a meeting.

### Slide 17 — People at the desk guess, and five of them are new

**On-slide text:**

```
What is the PUC number, and where do I check it?
Belford wants in through the back door. Are they allowed?
A resident needs to check out and I cannot remember the steps
Something just happened. Who do I call?
```

**Speaker notes:**

- Open: "every RSM and Housing Manager here has had the conversation where somebody at your
  desk did their own thing."
- **Say:** "and when you get to the bottom of it, it is almost never that they did not care.
  They were not sure, and they made a call."
- We all give the same instruction: if you are not sure, reach out, page, call. It is the right
  instruction.
- **Now tell your own story.** This is the credibility of the whole section, do not skip it.
  - I have paged about two things already tonight.
  - A third comes up. Similar to one of the first two, but not identical, and the difference
    might matter or might not.
  - I am running a calculation that has nothing to do with policy: do I disturb the manager on
    duty a third time tonight?
  - **THE LINE:** "most people, in that moment, guess. Not because they are lazy. Because they
    do not want to be the person who paged three times."
- Now escalate it: put that person in week three. Harnwell just hired five people who have
  never worked this desk.
- Read the four questions off the slide. Note they are real, not hypothetical.
- **Say:** "every one of these is known cold by somebody who has worked the desk two years.
  And not one is written anywhere they will actually reach in the moment."
- **Land it:** "the knowledge exists. It just lives in people, and it leaves when they
  graduate."

---

### Slide 18 — So how do we pass it down?

**On-slide text:**

```
Flowcharts. Guides. The binder.
There is one for summer and one for fall
Be honest: who is opening the binder at 11pm?
```

**Speaker notes:**

- Give credit first: we have tried. Flowcharts. Guides. The binder, one for summer and one for
  fall.
- **Pause here:** "you have all seen the binder. You know how big it is."
- **Say the quiet part:** "I do not believe many people are sitting at the desk opening that
  binder page by page to find one answer."
- Be fair to it: not because the binder is bad. Because it is the wrong shape for the moment.
- Describe the moment: something is happening right now, I have thirty seconds, I need one
  specific answer.
- **THE LINE:** "the binder is a reference book. What people need at the desk is an answer.
  Those are not the same product."
- **Pivot into the next slide:** "so the question is not how do we write it down. We have
  written it down. The question is how do we get it into them."

---

### Slide 19 — Meet Snoopy

**On-slide text:**

```
Ask Snoopy
An assistant that has read everything the desk knows
Ask in plain English, get the answer, at the desk, in seconds
Working today, on the phone and on the web
```

**Visual:** the assistant on the phone and on the web, mid-answer to a real desk question.

**Speaker notes:**

- Frame: "you ask it the way you would ask a coworker who has worked this desk for four
  years."
- It is grounded on the desk's **own** material: guides, procedures, documents, and how
  situations have actually been handled here.
- **Say:** "not general internet knowledge, and not making things up. It answers from what
  this desk actually knows."
- **Callback: slide 17.** That person now has a step in between.
  - Answer is in what the desk knows? Seconds, and they handle it correctly.
  - Genuinely needs a human? They still page, and now with a clearer question.
- ⚠️ **Guardrail, say it out loud, do not let the room assume otherwise:** "this does not
  replace paging, and it should never be sold that way."
  - **THE LINE:** "it removes the questions that never needed a human at all, so the pages you
    do get are the ones that actually deserve you."
- **Say:** "this is not a concept. It works today, in the mobile app and on the web."
- What is left is content, not development. Somebody hands over guides that already exist.
- **Close as an opportunity, not a request:** "right now, four years of desk knowledge walks
  out the door every May. This is the first mechanism we have had that keeps it."

---

### Slide 20 — Privacy first, and I want to be upfront about it

**On-slide text:**

```
Identifying details are removed before anything is stored
Names, student IDs, anything that points to a specific person
The lesson is kept. The person is not.
```

**Speaker notes:**

- **Raise it yourself, before anyone has to ask.** That is what makes it credible.
  - **Say:** "I want to answer the privacy question myself, because it is the right question."
- Walk how the desk actually learns something:
  - An emergency involving a resident. Written into the shift log. Paged. Resolved.
  - Afterward the Housing Manager writes an email about how to handle that next time.
  - **Say:** "that email is exactly the knowledge a new worker needs. It is also attached to a
    specific student on a specific night."
- So before it reaches the assistant, and before it is stored anywhere, identifying details are
  stripped: names, student IDs, anything tying it back to a person or an incident.
- **THE LINE:** "the lesson is kept. The person is not."
- Two results, state them plainly:
  - We never hold sensitive information about students in the first place.
  - Nobody can ask this assistant about a specific person and get anything back, because it is
    not in there to retrieve.
- **Own the tradeoff, do not hide it:** "we could make it slightly more knowledgeable by
  keeping more detail. We are not going to."
- **Close:** "a system that is useful and safe beats one that is marginally smarter and a
  liability."

---

## Section 8 — Bringing it back together

### Slide 21 — Every problem, and where it went

**On-slide text:**

```
Email overload           ->  swaps, claims, and breaks happen between workers, in the app
Hours paperwork          ->  the hours breakdown is the paper trail, written automatically
No live picture          ->  one schedule, live, that everyone reads and nobody reconciles
No-shows                 ->  reminders, plus the shift on their phone's home screen
Float never seen         ->  notification, a card that stays, and the home screen widget
Float forgotten          ->  already on their schedule, nothing to add
No yes or no             ->  one tap to confirm, escalating reminders, visible status
Cannot reach the floater ->  tap them on the schedule and call
Rules can be gamed       ->  the system checks real staffing, not a house's word
Nobody noticed in time   ->  pickup closes and coverage escalates automatically
Knowledge walks out      ->  Snoopy, grounded on what this desk knows
```

**Speaker notes:**

- ⚠️ **Do not read this line by line.** The room can read faster than you can talk. Say the
  shape instead.
- Every problem we started with was one of four things:
  - It lived in an inbox instead of a system.
  - It depended on a person remembering.
  - Nobody could see it.
  - Nobody could enforce it.
- What the app does to each, in the same order:
  - Moves it into the schedule.
  - Replaces it with reminders and the home screen.
  - Replaces it with one live screen.
  - Replaces it with rules that run in software rather than on trust.
- **Pause, then THE LINE:** "none of this required anyone to work harder. It required the work
  to stop being manual."

---

## Section 9 — The ask

### Slide 22 — Pilot it this fall, and here is the exit

**On-slide text:**

```
Run real staffing through the app for the fall semester
Start with the houses that carry the most floating
It runs alongside what you do today

And if it does not fit: the schedule exports out, and you are back on
spreadsheets the same day. The exit is built. You are not locked in.
```

**Speaker notes:**

- **The ask, stated plainly:** pilot this in the fall. Real workers, real shifts, real floats.
- Start where the pain is worst, because that is where it proves itself fastest.
- It runs alongside the current process. Nothing gets torn out, and nothing depends on this
  being perfect on day one.
- **What you need from her, name both:** a blessing to run the pilot, and a point of contact
  for the real worker and schedule data.
- **Now answer the concern before it is asked.** This is the part that gets the yes.
  - **Say:** "the question is not whether this app is good. It is what happens if you commit
    and it turns out not to fit."
  - The exit is built in. Export the schedule, and you are back on spreadsheets the same day,
    using the schedule that already exists.
  - You are not rebuilding anything and you are not waiting on me. No data hostage situation.
  - **THE LINE:** "I built the exit before I built the pitch, because a tool you cannot leave
    is a tool you should not adopt."
- **Close the ask:** "so the actual risk of trying this is one semester of running it
  alongside what you already do. That is the whole downside."
- ⚠️ Do not say the words "download the Excel file." Today's export gives a schedule you can
  open, print, or paste into a spreadsheet. Build the real export first if you want the
  stronger claim.

---

### Slide 23 — Closing line

**On-slide text:**

```
Today, keeping the desks covered runs on your inbox and everyone's memory.
Let's prove it can run on the app instead. One house at a time.
```

**Speaker notes:**

- ⚠️ Deliver slowly. Do not rush the ending and do not add anything after it.
- Today, keeping the desks covered runs on your inbox and everyone's memory.
- What the app does, in one breath: makes the schedule live, reminds people so shifts are not
  forgotten, lets workers reach each other, fills empty desks automatically and fairly, and
  keeps what the desk knows from walking out every spring.
- **THE LINE, then stop talking:** "let's prove it in one house."

---

## Appendix (not slides, presenter prep only)

### What was merged, and why (in case you want a slide back)

| v1 slides              | Now                | Reason                                                                     |
| ---------------------- | ------------------ | -------------------------------------------------------------------------- |
| 2 + 3                  | Slide 2            | Both are email doing a job an inbox cannot do                              |
| 6 + 7                  | Slide 5            | The chain defines floating, no separate definition needed                  |
| 8 + 9 + 10             | Slide 6            | One root cause (it lives in an inbox), one later answer                    |
| 13 + 14                | Slide 9            | The tools slide restated what slides 2 to 8 already proved                 |
| 15 + 16 + 21           | Slide 10           | Introduce the app by showing the live schedule, which is the core          |
| 18 + 19 + break picker | Slide 12           | Claiming, swapping, and break picking are all workers transacting directly |
| 22 + 23 + 26           | Slide 14           | "It does not replace your judgment" is a sentence you say, not a frame     |
| 24 (seasons)           | Spoken on slide 14 | Summer config matters but does not carry a slide for this audience         |
| 27 + 28 + 29 + 30      | Slide 16           | Three paths and one chain is one idea, not four                            |
| 31 + 32                | Slide 17           | The hesitation and the new hires are the same problem                      |
| 34 + 36                | Slide 19           | "Already built" is a closing sentence, not a slide                         |
| 38 + 39                | Slide 22           | The ask and the risk removal land harder in one frame                      |

### The seven lines to rehearse until they are automatic

If you only memorize seven things, memorize these. Everything else you can improvise.

1. Slide 5: "every single step depends on somebody reading something and remembering to act."
2. Slide 9: "the manager becomes the human glue holding all of it together by hand."
3. Slide 10: "this is not a copy of the schedule that gets updated. It is the schedule."
4. Slide 13: "a float here is hard to miss. And if someone does miss it, you know while there
   is still time to act."
5. Slide 16: "a house cannot say 'we have no floater' when it does."
6. Slide 18: "the binder is a reference book. What people need at the desk is an answer."
7. Slide 22: "I built the exit before I built the pitch, because a tool you cannot leave is a
   tool you should not adopt."

### Plain-language translation table

Never let the left column reach a slide.

| Internal term               | Say instead                                                            |
| --------------------------- | ---------------------------------------------------------------------- |
| Float / float lookup        | sending a worker to cover another house                                |
| Escalation chain            | the steps the app takes to fill an empty desk                          |
| Allied                      | paid outside coverage (last resort)                                    |
| Acknowledge a float         | the worker taps yes or no to confirm they're coming                    |
| Coverage floor / empty desk | a desk that would have nobody on it                                    |
| Cross-house pickup          | grabbing an open shift at another house                                |
| Source of truth             | the one screen that's always correct                                   |
| HMOD / RSM                  | keep role names only if she uses them, otherwise "the manager on duty" |
| Widget                      | the shift on your phone's home screen                                  |
| Push notification           | an alert on your phone                                                 |
| Force trigger               | you ask for a floater right now instead of waiting                     |
| Coverage lock / cutoff      | past a set point, the shift stops being pickable                       |
| Open shift feed / chips     | the list of shifts you can grab                                        |
| Break claim window          | the period when workers pick their break shifts                        |
| Operating season            | how the desk runs during that part of the year                         |
| Hard block / unavailable    | a time the worker said they cannot work                                |
| Target hours                | how many hours that worker is aiming for                               |
| RAG / grounded / embeddings | it answers from the desk's own documents                               |
| Redaction                   | names and identifying details are removed                              |
| Desk Assistant              | Snoopy                                                                 |

### Demo plan (screenshots as backbone, live as flourish)

Script the demo as screenshots inside the deck first, so a live hiccup doesn't sink the story.
Repeat a step or two live only if the room is warm.

1. The live schedule for a house. "One screen. Always correct." (slide 10)
2. A worker drops a shift in-app, and it appears in the open feed including at other houses.
   "No email. It just happens." (slide 12)
3. A float assignment as a notification and an in-app card. "They cannot miss it." (slide 13)
4. The worker taps yes. Manager sees the status. "No more guessing." (slide 13)
5. The home-screen widget with the next shift and float alert. (slide 11)
6. Tap a worker to see details and the call button. (slide 10)
7. The builder: the AI draft, then a manual placement showing target hours and a blocked
   worker. "It drafts. You decide." (slide 14)
8. The hours breakdown for one worker, showing a float with the house and the date. "That is
   the email you no longer have to read." (slide 15)
9. Ask Snoopy one of the slide 17 questions live. Pick one you have already tested and know it
   answers well. Highest upside live moment in the deck and also the riskiest, so have the
   screenshot ready as a fallback. (slide 19)

Safety rules: pre-load real-looking data so nothing looks empty, have the phone and web view
already open and logged in before the room starts, never demo live a step that only exists as
a screenshot.

### Objections to have answers ready for (don't put on slides unless asked)

- Who maintains this if you graduate or leave? Have a one-line answer on handover,
  documentation, and standard supportable tools. Slide 22's export is part of this answer.
- Will workers actually adopt it? It removes work for them, so adoption is a benefit. The
  pilot proves it.
- Privacy and student data? For scheduling: it uses only the scheduling and contact info
  already used today, access is limited by role, nothing leaves Penn's control. For the
  assistant, that is slide 20, and you raise it yourself rather than waiting to be asked.
- Does this replace current tools overnight? No, it runs alongside first, and slide 22 is the
  exit.
- What does it cost? Keep it light for this room. The detailed cost and savings case is
  exactly what belongs in the next conversation with her superiors.
- Aren't Penn's floating rules full of exceptions? Agreed, and that is the point. The
  exceptions (Harnwell training required, never leaving a desk below one worker, Harnwell never
  being a float destination) are built in as hard rules the system enforces.
- Can the assistant give a wrong answer? Any assistant can, which is why it is framed as a
  first stop and never a replacement for paging. It answers from the desk's own documents
  rather than general knowledge, which is what keeps it grounded. If she presses: the current
  failure mode is a new worker guessing with no information at all, and this is strictly better
  than that.
- Who decides what goes into the assistant? Housing decides. It only knows what it is given.
- What if a house games the automatic float chain? The system reads actual staffing rather than
  asking a house to self-report. That is the point of slide 16.
