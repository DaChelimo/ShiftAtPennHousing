# Shift@PennHousing — Stakeholder Presentation Outline (Content Only)

> STATUS: Draft for wording review. No layout, visuals, colors, or .pptx work happens until
> you sign off on this text.
> PRIMARY SOURCE: `docs/pitch/monday-superior-info-sheet.md` — this rewrite treats that file
> as the spine of the story. Everything else (BSpec/ARCH) is used only to confirm the info
> sheet's claims and to fill in the "what's built" slide.

---

## ⚠️ Read first: audience change from the last draft

The info sheet targets a **single direct superior, Monday, who personally feels the daily
staffing pain** — not the broader "residential life leadership, house managers, possibly
students" audience I outlined last time. That changes the deck materially per the info
sheet's own golden rules:

- **Lead with admin burden and worker experience. Never lead with money or technology.**
  Cost/savings and "ghosting" are explicitly reserved for a _later, higher-up_ pitch, not
  this one.
- **Pain before fix, every slide.** Never show a feature before the audience feels the
  problem it removes.
- **One idea per slide.**
- **The floating story is the emotional centerpiece.** It gets the most room in this deck.
- **End with a small, low-risk ask: a pilot in one or two houses**, not a broad rollout
  announcement.

If this is actually still going to a broader leadership audience, the ask and tone on the
final slides need to change (a pilot ask reads very differently to one superior versus a
room of house managers). Confirm which audience this now targets before wording locks in.

## ⚠️ What's confirmed vs. what I'm still flagging

- **The "before" pain points, the floating failure chain, and the built-capability list are
  now sourced directly from your info sheet**, not inferred by me. That resolves the
  biggest gap from the last draft (I previously had no documented "before" state).
- **Pilot houses (Harnwell and Quad)** are the info sheet's own suggestion for the ask, so
  this is no longer my inference either, it is what you asked me to propose.
- **Still not spec'd or in the info sheet, so still absent from every slide:** adoption
  numbers, worker counts, dollar costs, and any measured "this reduced X by Y%" claim. The
  info sheet is explicit that money and outcomes-with-data belong to a later pitch, so I've
  kept the deck consistent with that instruction rather than reintroducing numbers.
- **No em dashes or en dashes anywhere below**, on-slide or in notes, per both the info
  sheet and the project's own copy rule.

---

## Section 1 — What this is (one line, fast)

### Slide 1 — Title

**On-slide text:**

```
Shift@PennHousing
One app for desk staffing. No more emails, texts, and spreadsheets.
```

**Speaker notes:** Shift replaces the scattered
emails, spreadsheets, GroupMe chats, and phone calls used today with a simpler, more efficient system - and I will tell you how

---

## Section 2 — Her day today (the pain, told as her day, not a list)

### Slide 2 — Email overload

**On-slide text:**

```
Every swap, pickup, and drop becomes an email
Your inbox is the scheduling system.
```

**Speaker notes:** Right now, every swap, pickup, and drop requires an email that has to
be written by students, read by you or the SMs, and updated in the Google Sheet.
As an RSM, your email inbox is very important: where residents reach out, leadership passes info, and critical communication happens.
When it is flooded with info That is repetitive and not even necessary (the point in time in which a student manager deals with the shift swap/drop/pickup) since there's nothing you have to do on your side.
So you end up getting another email that isn't even helpful and distracts you from what you should focus on most.
a normal week as an RSM would be filled with this, but what makes Hanwha more special and even harder is the fact that floating happens. You end up not only receiving emails from students at your house but also from RSMs at different houses.

I was talking to the RSM at Gregory, and she told me that if she wants to have another student cover an open shift at her desk, she will send out emails to different houses at the same time. The first person to claim the shift from those houses will get it. That creates a problem where the other houses don't know that the shift has already been taken. Therefore, you have people reaching out to her, but they get turned down because the shift is no longer available. This is a critical issue, and it's a core motivation behind this product.

---

### Slide 3 — Manual paperwork just to approve hours

**On-slide text:**

```
A worker covers another desk
Someone has to email the RSM and both managers, just to prove it happened
```

**Speaker notes:** When a worker works a desk that isn't their home desk, they have to
email the RSM and the student managers of both the home desk and the covering desk, purely
to create a paper trail so hours can be approved.

This is manual, repetitive, and creates friction on both the student workers' side and the RSM's side. When approving hours, the RSM not only has to look at their home schedule, but also read through past emails to find the proof for the hours worked outside the home desk. This makes approving hours take a much longer time than it should.

---

### Slide 4 — No live picture of what's actually happening

**On-slide text:**

```
The truth is spread across inboxes, texts, and spreadsheets
No single screen she can trust
```

**Speaker notes:**
Because two SWs might have swapped a shift and sent an email, if that email has not yet been read and acted upon, then the schedule contains the wrong info and this causes an issue when someone is late and the previous person at the desk wants to give them a call to find out if they are on their way.
You can't read the house spreadsheet and trust it fully.

---

### Slide 5 — No-shows from forgotten shifts

**On-slide text:**

```
A worker picks up a shift, then forgets
The desk sits empty
```

**Speaker notes:**
This is one of the biggest problems, and it's been worse during the academic year. The reason is that people get used to patterns, and after a few weeks into a new semester, they get used to their shifts. When they pick a new shift or choose to cover for someone else, it becomes challenging to remember that shift.

There are two ways you can go about this:

1. Not add it to your calendar and risk forgetting it, which is very likely and has happened to me a couple of times.
2. Add it to your calendar, but that process has so much friction when you start picking multiple shifts since it consumes too much time and effort.

In either case, it's disadvantageous.

---

## Section 3 — Floating: the centerpiece story

### Slide 6 — What floating is

**On-slide text:**

```
Floating: sending a worker from one house to cover another
Two kinds. One works okay today. One breaks constantly.
```

**Speaker notes:**
One of the interesting things I learned about Working at Harnwell is Floating.

There are 3 kinds:

1. No-show. Someone fails to show up to the desk so a floater is needed. This one has a simple solution: Call the Quad and Harnwell to get a floater.
2. Uncovered Open Shift. You have an open shift at another house and no one's picked it yet, and you need someone to come and cover it. Three hours before the shift happens, you trigger a floater escalation, which checks the quad fast and then checks Harnwell if the quad has no floaters. If Harnwell also doesn't have any floaters, it requests for allied coverage.
3. Advance coverage need. Days in advance, you know that there is an open shift that no one at your home desk wants and wish to seek floater coverage for it in advance. This is the scenario that's easiest to go wrong, and it is the one I'll be diving deeper into on the next slide.

---

### Slide 7 — The chain today

**On-slide text:**

```
Current situation:
- Worker drops a shift a week out, no one picks it up
- Gregory RSM sends a coverage request to other houses to see if their workers are interested
- Gregory RSM gets no interest from other houses
- Gregory RSM emails Quad RSM to see if they have floaters and then if not, emails Harnwell RSM
- Harnwell RSM asks a specific worker to float
- Worker must acknowledge through an email and remember to add it to their calendar
- Harnwell and Gregory Google sheet must be updated to floater
```

**Speaker notes:** If you felt as if that was a very lengthy process, it's because it is, and there are so many places that this could fail. I'll address each possible failure, and then show you the solution I built that solves this.

---

### Slide 8 — Failure: the email never gets seen

**On-slide text:**

```
The worker never sees the request
They never know they were supposed to float
```

**Speaker notes:** The float request lives in an email. If it's missed, the worker has no idea they were ever asked. Nobody did anything wrong, the request simply never reached them.

---

### Slide 9 — Failure: forgot, went to the wrong desk

**On-slide text:**

```
Forgets to update their calendar
Shows up at their home desk instead
```

**Speaker notes:** Even a worker who said yes can forget to actually add it to their own
calendar. Autopilot sends them to their home desk. The desk they were supposed to cover sits empty.

---

### Slide 10 — Failure: no one knows if anyone is coming

**On-slide text:**

```
Worker never replies yes or no
RSM have no idea if the student saw and therefore, whether coverage is actually on the way
```

**Speaker notes:** Even when the calendar gets updated, if the worker never explicitly confirms, the people responsible for that desk are flying blind. They can't tell the
difference between "help is coming" and "no one is coming" until the shift starts.

---

### Slide 11 — Failure: no way to reach the floater en route

**On-slide text:**

```
Floater (advance schedule) is five minutes from arriving.
Desk doesn't know who is coming, and if they do, do not have their number.
Desk calls Harnwell for floater, pages HMOD, get Allied coverage gotten, you end up with Allied and student heading to the same place
```

**Speaker notes:** Here's a concrete version of it: a floater (scheduled in advance) is walking from Quad to Hill.
Hill waits five minutes past 8pm and no one is still there, so they call Harnwell.
Harnwell pages HMOD, HMOD secures Allied coverage. Two minutes later the floater arrives. Now the desk is double covered, and, all because no one could just reach the person already on their way.

---

### Slide 12 — Failure: the rules can be gamed

**On-slide text:**

```
Quad has three workers, Harnwell has two
Quad just says "we have no floater"
No way to check, so Harnwell is stuck covering instead
```

**Speaker notes:** There's no enforcement behind any of this. If a house doesn't want to
send someone, it can simply claim it has no one available, and there's no way to verify
that. The burden quietly shifts onto whichever house doesn't push back, which isn't fair to
anyone.

---

### Slide 13 — Land the story

**On-slide text:**

```
Every failure here is a person doing their best
Inside a process with no reminders, no live truth, no way to reach each other, no fairness
```

**Speaker notes:** This is the turn in the story. None of this is about anyone failing at
their job, it's a process with no memory, no live information, and no way to hold anyone
accountable. That's exactly what the next section fixes, piece by piece.

---

## Section 4 — Why the current tools can't fix this

### Slide 14 — The tools today, and why each one hurts

**On-slide text:**

```
Spreadsheets: go stale the moment anything changes
Group texts: buried messages, no record
Email: easy to miss, not a live picture
Phone calls: only works if you have the number and they pick up
```

**Speaker notes:** None of these four tools talk to each other, none of them is live, and
none of them reminds anyone of anything. The manager becomes the human glue holding all of
it together by hand. That's the job this app takes off her plate.

---

## Section 5 — The solution, pain by pain

### Slide 15 — Kills email overload

**On-slide text:**

```
Swaps, pickups, drops, and floats all happen in the app
Workers agree directly with each other, one tap to accept
She's no longer cc'd on everything
```

**Speaker notes:** Remember the inbox from slide two? That's gone. The app is the system
now, not her inbox. Two workers agree to a swap directly with a tap, no manager approval
step, no manager email required.

---

### Slide 16 — Kills the documentation burden

**On-slide text:**

```
The live schedule is the record
Hours automatically split into home, floated, and picked-up
No more emailing the RSM and two managers just to prove it happened
```

**Speaker notes:** Remember the paper trail from slide three? The schedule updates
instantly the moment anyone drops, picks up, swaps, or floats, and it's color coded so
cross-house coverage is visible at a glance. Each worker's hours report automatically
breaks their week into hours at home, hours floated out, and hours picked up elsewhere.
That breakdown is the documentation. Nobody has to write an email to prove it happened.

---

### Slide 17 — Kills the "no live picture" problem

**On-slide text:**

```
One screen, always correct
Scroll back to see who worked any past shift
```

**Speaker notes:** Remember slide four, no single trustworthy screen? Now there is one.
Anyone with permission opens the schedule and sees, right now, who's on every desk, and can
scroll back to see exactly who worked any block in the past. The calendar is the record.

---

### Slide 18 — Kills no-shows

**On-slide text:**

```
Your next shift lives on your phone's home screen
Any float you owe shows up there too
Personal alerts for your own shift cannot be turned off
```

**Speaker notes:** Remember the forgotten pickup from slide five? A worker's next shift, and
any float they owe, sits right on their phone's home screen, they don't have to remember to
check anything. A second view shows open shifts they could grab at their own house or
elsewhere. And anything that affects them personally sends a notification they can't silence.

---

### Slide 19 — Answers the floating failures, one by one

**On-slide text:**

```
Never saw it: arrives as a push notification and an in-app card
Forgot to add it: it's automatically on their schedule and their widget
Never replied: they tap yes or no, with reminders at 6h, 2h, 1h, 30m, and 5m
Couldn't reach them: tap the floater to see contact info and call, one tap
Quad said "no one available": the system assigns floats itself, based on real staffing
```

**Speaker notes:** Walk this straight back against the five failures from the floating
story. No buried email, because it's a notification and a card. No forgetting, because it's
already on their calendar and home screen. No guessing whether they're coming, because they
confirm in the app and reminders escalate automatically as the deadline nears, with managers
able to see acknowledgment status at a glance. No more calling the wrong house in a panic,
because tapping the floater on the schedule brings up their details and a one-tap call
button, this works today, including for a floater who's incoming to your desk. And the rules
can't be gamed anymore, because the system decides who floats based on actual staffing, not
on a house's say-so, and it will never let a desk drop below one worker on it.

---

### Slide 20 — Bonus: coverage is found automatically, in order

**On-slide text:**

```
Notify workers, offer for pickup, then float, then paid backup as a last resort
Only when a desk would actually be empty
```

**Speaker notes:** When a desk is genuinely about to have zero people on it, the system
works through the options in order on its own, starting with notifying and offering the
shift for pickup, then floating, and only reaching for paid outside coverage as the very
last resort. It only kicks in when a desk would truly be empty, so it never spams people or
burns paid coverage on a desk that's already staffed. Keep this light, the budget angle is
for the later, higher-up conversation, not today's room.

---

## Section 6 — What's built and working today

### Slide 21 — This is real, and it works today

**On-slide text:**

```
One live schedule, all 13 houses, correct in real time
In-app drops, pickups, claims, and swaps
Automatic float assignment with yes/no confirmation and reminders
Automatic coverage cascade, ending in paid backup only as a last resort
Home-screen widgets and personal push notifications
Automatic hours breakdown for easy approval
Tap any shift to call the worker directly
Works on iPhone, Android, and a web view for managers
```

**Speaker notes:** This is not a roadmap, everything on this slide exists and works today.
It's worth saying plainly, because the temptation in a room like this is to treat it as a
concept pitch. It isn't. This has been built.

---

### Slide 22 — A brief look ahead (only if time allows)

**On-slide text:**

```
The app can draft a full schedule for a house automatically
The manager reviews it and stays in control
```

**Speaker notes:** Keep this short and don't lead with it. The app can now generate a full
draft schedule for a house on its own, and the manager reviews and approves it before
anything goes live. Frame it simply: it drafts the schedule for you, and you stay in
control. This is a newer capability, worth a brief mention if the room has energy for it,
not a slide to dwell on.

---

## Section 7 — The ask

### Slide 23 — A small, safe pilot

**On-slide text:**

```
Pick one or two houses, Harnwell and Quad make sense
Run real staffing through the app for a defined trial window
Runs alongside the current process. Nothing breaks if we pause.
```

**Speaker notes:** End with the smallest possible yes. Harnwell and Quad carry the most
floating complexity, so they're the houses where this proves itself fastest. It runs
alongside the current process at first, so if anything needs to pause, nothing breaks. This
is a trial, not a rip and replace. What's needed from her: a blessing to pilot, and a point
of contact for real worker and schedule data.

---

### Slide 24 — Closing line

**On-slide text:**

```
Today, keeping the desks covered runs on your inbox and everyone's memory.
Let's prove it can run on the app instead. One house at a time.
```

**Speaker notes:** Close on the takeaway line, delivered slowly: today, keeping the desks
covered runs on her inbox and everyone's memory. This app makes the schedule live, reminds
people so shifts aren't forgotten, lets workers reach each other, and fills empty desks
automatically and fairly. Let's prove it in one house.

---

## Appendix (not slides, presenter prep only)

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

### Demo plan (screenshots as backbone, live as flourish)

Script the demo as screenshots inside the deck first, so a live hiccup doesn't sink the
story. Repeat a step or two live only if the room is warm.

1. The live schedule for a house. "One screen. Always correct."
2. A worker drops a shift in-app. "No email. It just happens."
3. The shift appears in the open-shifts feed, including at eligible other houses.
4. A float assignment shows up as a notification and an in-app card. "They cannot miss it."
5. The worker taps yes. Manager sees the status. "No more guessing."
6. The home-screen widget with the next shift and float alert. "This is why they don't forget."
7. Tap a worker to see details and the call button. "The person at the desk can reach the
   floater directly."
8. Optional: the AI drafting a schedule, manager reviewing it.

Safety rules: pre-load real-looking data so nothing looks empty, have the phone and web view
already open and logged in before the room starts, never demo live a step that only exists
as a screenshot.

### Objections to have answers ready for (don't put on slides unless asked)

- Who maintains this if you graduate or leave? Have a one-line answer on handover,
  documentation, and standard supportable tools.
- Will workers actually adopt it? It removes work for them, so adoption is a benefit, the
  pilot proves it.
- Privacy and student data? It uses only the scheduling and contact info already used today,
  access is limited by role, nothing leaves Penn's control. Don't over-claim, offer to
  confirm any detail you're not sure of.
- Does this replace current tools overnight? No, it runs alongside first, the pilot is
  reversible.
- What does it cost? Keep it light for this room, the detailed cost and savings case is
  exactly what belongs in the next conversation with her superiors.
- Aren't Penn's floating rules full of exceptions? Agreed, and that's the point, the
  exceptions (Harnwell training required, never leaving a desk below one worker, Harnwell
  never being a float destination) are already built in as hard rules the system enforces.
  introduce purity
