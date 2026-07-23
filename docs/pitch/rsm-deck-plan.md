# Shift@PennHousing. RSM Presentation, Build Plan

> STATUS: Plan for review. No slides built yet.
> AUDIENCE: The RSM (same person the `monday-superior-info-sheet.md` was drafted for; she has not seen it).
> FORMAT: Self-contained HTML artifact deck.
> LENGTH: 45 to 60 minutes, ~38 slides.
> VISUALS: Real app screenshots that I capture from the iOS Simulator and the web admin.

---

## 0. Spec freshness (answering your question directly)

You asked whether the specs are up to date. Partly. I checked before planning:

| Area                                                                              | Where it lives                                                             | Up to date?                |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------- |
| Roles, houses, floats, escalation, drops, pickups, swaps, seasons, coverage floor | `BEHAVIORAL_SPECIFICATION.md` (1126 lines), `ARCHITECTURE.md` (1437 lines) | Yes, detailed and current  |
| Desk Assistant, knowledge base, page composer                                     | `docs/desk-assistant/V1_SCOPE.md`, `BUILD_PLAN.md`, `INTAKE_PLAN.md`       | Yes, but in its own docs   |
| AI schedule building                                                              | `packages/core/src/ai-schedule/` + commit history                          | Code only, no spec section |
| Widgets, onboarding, SMOD/CSMOD, Building Administrator                           | `docs/design/`, `AGENTS.md` notes, commits                                 | Scattered                  |

The two main specs contain **zero** mentions of the Assistant, the knowledge base, AI scheduling, widgets, or SMOD/CSMOD. That is a documentation gap worth closing at some point, but it does not block this deck: I have grounded every claim below in either the specs or the actual source code, and I note where a claim rests on code rather than spec.

**One correction to flag now:** the deck must not claim the Assistant reduces pages as a measured fact. It is built and grounded, but we have no page-volume baseline and no post-deployment measurement. It goes in as a designed mechanism, not a proven outcome. Same discipline as the AI accuracy number.

---

## 1. Strategy for this room

She is not management. She will not be moved by cost savings or by technology. She is moved by **the work landing on her desk today that would stop landing there.** Three consequences:

1. **Every problem is told from inside her day, or from inside her workers' day.** Not "the system lacks a source of truth." Instead: "It is 9pm on a Saturday. Lauder just went empty."
2. **She is the one who currently absorbs the failure.** When a desk goes empty, she fills it herself or she pays Allied. The deck should keep returning to that.
3. **Fairness and enforceability matter to her personally,** because today the float protocol runs on trust and she is the one who has to lean on people. Software that enforces the rule removes an interpersonal cost, not just an administrative one.

### Structure you asked for

You asked for: state every problem first, then walk them one by one with cause and solution. I am building exactly that, with one addition. After the problem inventory I insert a single **root-cause slide**, because all seven problems collapse into one sentence, and naming it early makes each later solution feel like the same fix applied again rather than seven unrelated features. That is what makes a long deck feel short.

```
ACT 0  Open                    3 slides
ACT 1  All seven problems      3 slides   <- the anchor board
ACT 2  Problem by problem     26 slides   <- pain, cause, fix
ACT 3  Proof, demo, ask        6 slides
                              --------
                              38 slides
```

The problem board from Act 1 returns as a **progress rail** on every Act 2 divider: seven small marks, the current one lit in blue, solved ones filled. She always knows where she is and how much is left. This is the single most effective device for holding a 45-minute non-technical room.

---

## 2. Color and visual system

**Correction from your review of the first preview:** the brown panel in the earlier draft was me mis-reading photo/projector distortion in your reference images as an intentional design choice. You confirmed the actual slides were not brown, and the palette below has no brown, orange, amber, or rust anywhere. What is genuinely worth borrowing from those photos is not their color, it is their **layout discipline**: a short mono eyebrow, a clear headline, then one of two structures. Either text on the left and a visual on the right, or a header-and-description block with a supporting visual directly beneath it. Clean, quiet, legible. That is what I am carrying forward.

### Palette

| Token      | Hex       | Role                                                                                                                             |
| ---------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Paper      | `#FFFFFF` | Slide background. Plain white, chosen deliberately for maximum legibility in a projected room, not defaulted to                  |
| Ink        | `#1A1D21` | Headlines and body text. Near-black, not pure black, so it is not a stark #000 against pure white                                |
| Brand blue | `#0061FC` | **The solution color.** Key words, the lit rail mark, every "after" state, primary emphasis                                      |
| Deep blue  | `#00379E` | Headline emphasis, hairline accents, chip numerals                                                                               |
| Pale blue  | `#EAF1FF` | Quiet fills behind chips and highlighted rows. The only fill color in the deck besides white                                     |
| Slate      | `#5B6572` | Secondary text, captions, mono eyebrow labels                                                                                    |
| Rule       | `#E3E6EA` | Hairlines, chip borders, table dividers                                                                                          |
| Warn gray  | `#8A8478` | "Today" / problem-state text. A muted warm gray, not a color, so problem states read as flat and unresolved rather than alarming |

Two colors carry the entire before/after argument: **gray is the past, blue is the future.** Nothing else is colored. A "today" chain is set in Warn gray on a plain white ground; a "with the app" chain is set in Ink with Brand blue accents. No red, no orange, no brown anywhere in the deck. This keeps every slide readable at a glance across a real room, which was the actual point of the reference photos regardless of how the camera rendered their colors.

### Typography

- **IBM Plex Sans** for headlines and body, matching the product's own typeface.
- **IBM Plex Mono** for eyebrow labels, all times and block ranges (`12:00 - 6:00pm`), table column headers, and anything quoted from a real system (an email, a chat transcript).
- Eyebrow labels are uppercase, `0.14em` letterspacing, 13px, Slate. This is the one convention I kept from the reference photos: a short mono label above every headline that tells the room what kind of slide they are looking at before they read it.
- Sizes: eyebrow 13, caption 15, body 21, headline 46, hero stat 96. Nothing in between, which forces real hierarchy.

**One build constraint to flag:** an HTML artifact cannot load fonts from an external host, so Plex has to be embedded in the file as base64 or the deck falls back to system fonts. I will embed a subset of Plex Sans (regular, semibold) and Plex Mono (regular) and keep the file self-contained. If the file size becomes a problem I will fall back to a system stack, which on your Mac renders as SF Pro and SF Mono and is close in spirit, and I will tell you if I make that call rather than letting it happen silently.

### Layout system

Two structures, used consistently so the room stops reading the structure and just absorbs the content:

1. **Split.** A short text block on the left (eyebrow, headline, one or two lines, sometimes a small list), a supporting visual on the right: a screenshot, a diagram, a chain of steps. Used for anything that is fundamentally "here is the situation, here is what it looks like."
2. **Stacked.** Eyebrow and headline at the top, one line of description, then one supporting visual directly beneath spanning most of the width. Used when the visual itself is the main content: a chip grid, a data table, a full-width diagram.

Both structures are top-and-left weighted. The lower right stays the quietest part of the slide. Rounded corners (8px on chips, 12px on any panel), no shadows, no gradients beyond the plain white ground. Depth comes from spacing and the blue accent, never from a drop shadow or a dark fill.

### The three templates I will build

| Template                                        | Structure | Where it is used here                                                                                                                            |
| ----------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Chip grid, stacked**                       | Stacked   | The seven-problem board (slide 4), today's toolkit (6), what is built (35)                                                                       |
| **B. Split, text left / chain right**           | Split     | The drop chain (7), off-hours duplication (9), the escalation chain (10), the float failure walkthroughs (21 to 23)                              |
| **C. Data table or verbatim artifact, stacked** | Stacked   | The AI accuracy metrics (34), and rendering the actual float email and the actual GroupMe thread verbatim in a bordered panel (slides 14 and 20) |

**On slides 11, 12, 13, 20, and 23:** the strongest single idea I am keeping from your reference is showing the real artifact rather than a diagram of it. Not an illustration of "an email gets sent," the actual email or chat text, set in Plex Mono inside a plain bordered panel on white, with the one fact that matters underlined in Brand blue. She will recognize it instantly because she has lived it. You sent five real screenshots and I have transcribed the parts that go on slides below.

**Redaction, applied by default:** every artifact keeps first names only (no last names for people who are not already public in the org chart), drops every email address and phone number, and drops signature blocks and social links. Andrew's own name stays since it is your deck. I made this call rather than reproducing the screenshots verbatim, because this deck will be projected in a room and may be forwarded afterward, and stripping contact info costs nothing while it is up on a screen. **Flag it if you would rather use full names** since she may know these workers directly and it could add credibility, but the safer default is what is built below.

**Artifact 1, the Rodin chain (slide 20).** A real multi-hop coverage request for one hour, twelve minutes end to end by timestamp, three named people:

> **Andrew, 12:44 PM**
> Rodin just called requesting a floater from 1:00 PM to 2:00 PM. I initially told them to call the Quad first, but they currently have Allied coverage and are unable to check. She later called back, and I asked her to call again 20 minutes before 1:00 PM. However, she mentioned she will be unavailable from 11:30 AM onward. Since we have two workers scheduled at that time, I wanted to pass this along to see whether Jing can float to the Rodin desk for that hour.
>
> **Abraham, 12:56 PM**
> Thanks for the heads up. Jing can float to Rodin from 1:00 to 2:00 PM. Also, I did call her and she mentioned you texted her, which is okay, but for future reference please use the desk phone to call the scheduled worker directly when a floater has been requested. Calls are preferred since they get an immediate yes or no, whereas a text might be seen late or ignored, especially for time sensitive coverage like this.

The manager's own coaching note in that second message, that a text is not reliable enough and a phone call is required, is doing a lot of work for the pitch without you having to say anything critical yourself. It is her own team's process, stated in her own team's words: informal channels are known to be unreliable, which is precisely what an in-app tap-to-acknowledge with a confirmed status replaces.

**Artifact 2, the acknowledgment gap (slide 23).** Two real emails, same day, with a citable number:

> **Amaltuas, 3:20 PM**
> Would you please float to the Mayer Hall Info Center on Saturday, 7pm to 8pm?
>
> **Andrew, 9:05 PM**
> I wish to acknowledge your email, and inform you that I will be floating to Mayer Hall Info Center from 7pm to 8pm.

**5 hours 45 minutes** between the request and the acknowledgment, for a one-hour float. That gap is invisible to anyone until the reply happens to land. This is the single strongest number in the deck: it is dated, it is real, and it is a direct contrast to "acknowledged with a tap."

**Artifact 3, the broadcast list (slide 11).** The entire cross-house pickup mechanism today, one message:

> **Gabriella:** Hi everyone! The following shifts are available at Rodin this week and for the week of 7/27 to 8/2. If you're interested please send me your name, phone number, email, and the IC you work at. Please ensure you specify the dates and times of the shift you pick up and make sure you are not exceeding 40 hours.
>
> Wednesday 7/22, 5pm to 8pm
> Sunday 7/26, 5:30am to 8am **(NO COVERAGE)**, 8am to 12pm
> Monday 7/27, 4pm to 8pm
> Tuesday 7/28, 8am to 12pm **(NO COVERAGE)**, 12pm to 4pm
> Thursday 7/30, 4pm to 8pm **(NO COVERAGE)**
> Friday 7/31, 4pm to 8pm
> Saturday 8/1, 5:30am to 8am, 8am to 12pm, 12pm to 4pm, 8pm to 12am
> Sunday 8/2, [list continues]

Render this exactly as it looks in the chat, `(NO COVERAGE)` and all. To claim a single three-hour block you reply with your full name, phone number, email, and which house you work at. That is not a claim button, it is a small application.

**Artifact 4, the buried replies (slide 12).** Five different people claim five different slots as flat, unlinked replies underneath that same list, each acknowledged only by a thumbs-up emoji:

> Grace: I'll take Friday 7/31 4pm to 8pm 👍
> Jamia: I can pick up Saturday 12pm to 4pm 👍
> Grace: Sunday 8/2 8pm to 12am too 👍
> Sunny: I can do 8/1 8am to 12pm 👍
> Joy: I can do Monday 4 to 8 👍 / I can do Wednesday 7/22 5 to 8pm 👍 / And Thursday 7/30 4 to 8 👍

Nothing here marks the original list as updated. A sixth person scrolling the thread has no way to tell, without reading every reply, which of those eight slots from Artifact 3 are already gone.

**Artifact 5, the false claim DM (slide 13). Your own account, verbatim.** This is the centerpiece of the whole "people stop trying" argument, because it is not a hypothetical:

> **Adailia, from Harrison, 3:32 PM**
> Hi Andrew, this is Adailia from Harrison! I made an error on my end and listed Mon 5-9pm as an available shift, it was taken by someone else prior. My apologies for that, but please let me know if you'd like any of the remaining shifts in the main gc!

You claimed a shift, and only found out afterward, by a private apology, that it was already gone. Put this on its own slide, panel only, nothing else, and let the room sit with it for a beat before you speak.

**Also usable, held in reserve for Q&A or the appendix:** the Kylie thread, where a posted shift gets no response for two days and has to be manually reposted with "bumping this," and the Vidhi and Khloe exchange, where the request itself is ambiguous enough that the responder has to ask whether it is a swap or a full drop before anyone can act on it. Both reinforce points already made elsewhere in the deck, so I am not giving them their own slides, but they are ready if she asks for more examples.

### Copy rule

No em dashes or en dashes anywhere in slide copy, per the project rule that applies to every visible string. Periods, colons, commas, or parentheses instead.

---

## 3. Slide-by-slide plan

Notation: `[SHOT]` = real app screenshot, `[DIAGRAM]` = built vector, `[TEXT]` = type-only slide.

### ACT 0. Open (slides 1 to 3)

| #   | Slide                       | Content                                                                                                                                                                         | Visual   |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Title                       | "Shift@PennHousing." Subtitle: "One app for desk staffing." Your name, date. Ink background, blue rule.                                                                         | `[TEXT]` |
| 2   | What it is, in one sentence | "One live schedule that every house shares, that fills its own empty desks, and that reminds people so shifts are not forgotten."                                               | `[TEXT]` |
| 3   | Why I built it              | Two lines, honest and personal: you work these desks, you watched the same failures repeat, you built the thing that removes them. Establishes you as an insider, not a vendor. | `[TEXT]` |

**Note on slide 3:** this is the highest-leverage slide in Act 0. She is about to spend 45 minutes with you. Whether she hears the rest as "a student is pitching me software" or "someone who does this job fixed it" is decided here.

### ACT 1. The whole problem, up front (slides 4 to 6)

| #   | Slide           | Content                                                                                                                                                                                 | Visual      |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 4   | **The board**   | All seven problems, numbered, one line each, no elaboration. Say: "I am going to walk every one of these. Stop me on any of them."                                                      | `[DIAGRAM]` |
| 5   | The root cause  | "There is no system. There are people, inboxes, a group chat, and memory." Everything that follows is one fix applied seven times: put the truth in one place and make it reach people. | `[TEXT]`    |
| 6   | Today's toolkit | Four columns: Email, Excel, GroupMe, Phone. What each is used for, why each fails. Bottom line: "None of them talk to each other. None is live. None reminds anyone. You are the glue." | `[DIAGRAM]` |

**The seven problems, as they appear on slide 4:**

1. Dropping a shift is an email negotiation, and off-hours it doubles into phone calls.
2. Picking up a shift at another house is a group-chat lottery.
3. Shifts that are picked up get forgotten, and the desk sits empty.
4. Floating runs on email and trust, and it fails five different ways.
5. The HMOD gets paged for things experience already answers.
6. The pages that are warranted arrive missing the one fact that matters.
7. Building the schedule means reconciling everyone's preference sheets by hand.

### ACT 2. One problem at a time (slides 7 to 32)

---

#### Problem 1. Dropping a shift (slides 7 to 10)

| #   | Slide                           | Content                                                                                                                                                                                                                        | Visual                      |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| 7   | The drop chain today            | Worker emails SM and RSM. Someone decides. Someone edits the Excel sheet. Clay chain diagram.                                                                                                                                  | `[DIAGRAM]`                 |
| 8   | Where authority runs out        | Two branches. **Drop leaves the house single-staffed:** SM or RSM can handle it, fine. **Drop leaves the desk empty:** the SM can see it and can do nothing but escalate to you. You come fill it yourself, or you pay Allied. | `[DIAGRAM]`                 |
| 9   | Off-hours: the same work, twice | The duplication, told as a sequence: write the email, then call the desk anyway, and if you are not at Harnwell, call Harnwell too, and Harnwell pages the HMOD. One drop, four communications, three of them redundant.       | `[DIAGRAM]`                 |
| 10  | **What happens now**            | Drop in the app. It reopens instantly. The system knows whether the desk would be empty and only escalates when it truly would be. No email, no phone tree, no editing a spreadsheet.                                          | `[SHOT]` Manage-shift sheet |

**Grounding:** the empty-desk-only rule is real and is the coverage floor in BSpec §5.4. Worth stating plainly to her, because it is the difference between a system that spams everyone and one that stays quiet: **the app only goes looking for coverage when a desk would actually have nobody on it.** A Harnwell desk that drops from two workers to one is covered, and the app does not page anyone.

---

#### Problem 2. Picking up across houses (slides 11 to 15)

This section will land hardest with her, because it is the one where the current process actively teaches workers to stop trying. Give it room.

| #   | Slide                                               | Content                                                                                                                                                                                                                                                                                                                                                    | Visual                                    |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 11  | The group chat                                      | A real broadcast, shown verbatim (Template C): an SM posts the week's open shifts to the all-summer-workers chat, one giant message, several of them tagged `(NO COVERAGE)`. To claim one, you reply with your name, phone number, email, and which house you work at. That is the entire cross-house staffing mechanism today.                            | `[SHOT]` verbatim panel, artifact 3 below |
| 12  | Failure: claims happen in the replies, not the list | The real thread underneath that same broadcast: five different people claim five different slots as separate one-line replies, each acknowledged only by a thumbs-up. Nothing marks the original list as updated. The list you would check is already wrong the moment the first reply lands.                                                              | `[SHOT]` verbatim panel, artifact 4 below |
| 13  | **The cost is that people stop trying**             | A real, dated exchange (Template C, artifact 5 below): you tried to pick up a Monday shift at Harrison, sent your claim, and got a DM back from that house's SM saying it was already taken, an error on their end. **This is the real damage. The shifts are not unfillable. People have learned not to bother, because this is what trying looks like.** | `[SHOT]` verbatim DM                      |
| 14  | Failure: the post disappears                        | Beyond the specific incident, the general pattern: a shift goes unanswered for two days, and the only fix is for the original poster to manually reply "bumping this" to their own message and hope it resurfaces.                                                                                                                                         | `[DIAGRAM]`                               |
| 15  | **What happens now**                                | One live feed of open shifts, your house and every other house you are eligible for. Claimed means gone, instantly, for everyone, no thumbs-up required to know it stuck. Partial claims are first-class, so splitting 12 to 6 into two pieces is a normal action, not chat debris. Week filter so you see the week you care about.                        | `[SHOT]` Open Shifts feed                 |

**Slide 13 is the emotional peak of the first half.** Previously planned as a typographic hero slide restating your own account in prose. Now that we have the actual DM (see Template C artifacts below), showing the real message is stronger than any paraphrase, and it should stay almost empty around it: the panel, one line of your reaction beneath it, nothing else.

---

#### Problem 3. Forgotten shifts (slides 16 to 18)

| #   | Slide                 | Content                                                                                                                                                                                                                                                                                                  | Visual                                    |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 16  | The friction point    | You pick up a shift. Now you must remember to add it to your own calendar. It is not part of your routine, so often it does not happen.                                                                                                                                                                  | `[DIAGRAM]`                               |
| 17  | And that is a no-show | The shift exists in a chat message and in someone's intention. Nowhere else. Nobody finds out until the desk is empty. Also covers the reverse: something comes up and you forget to drop it.                                                                                                            | `[TEXT]`                                  |
| 18  | **What happens now**  | Three answers, one slide. (1) It is already on your schedule, because claiming it put it there. Nothing to add. (2) A home-screen widget, so your next shift is in front of you without opening anything. (3) Notifications about your own shifts cannot be turned off. If it affects you, you are told. | `[SHOT]` widget + My Shifts, side by side |

---

#### Problem 4. Floating (slides 19 to 25). The centerpiece

| #   | Slide                             | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Visual                                |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 19  | What floating is                  | One sentence, in case she wants it framed for a colleague later: a worker from one house is sent to cover a different house that is short. Note it matters most in fall and spring.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `[TEXT]`                              |
| 20  | **The chain today, verbatim**     | A real one-hour coverage gap at Rodin, shown as the actual email exchange (Template C, artifact 1 below): the desk calls in, you check Quad, Quad is unreachable, you pass it to the whole team by email, the RSM approves a floater by name twelve minutes later, and adds a process note that texting the worker directly is not reliable enough for time-sensitive coverage. **Three people, two phone calls, one email thread, to cover a single hour.**                                                                                                                                                                        | `[SHOT]` verbatim panel               |
| 21  | Failures 1 and 2                  | **Never saw the email**, so they never knew. **Saw it, agreed, forgot**, and went to their home desk on autopilot. The desk they were meant to cover is empty and nobody knows until it is.                                                                                                                                                                                                                                                                                                                                                                                                                                         | `[DIAGRAM]`                           |
| 22  | **The partial float**             | The worst version, and worth its own slide. You are scheduled 12:00 to 6:00 at Harnwell. You are floated 12:00 to 4:00. You are working either way, so nothing feels wrong, and you show up at Harnwell. Two desks are now wrong at once: the one you left uncovered, and the one you are standing at.                                                                                                                                                                                                                                                                                                                              | `[DIAGRAM]`                           |
| 23  | **Failure 3, with a real number** | A dated planned-float email (Template C, artifact 2 below): the request goes out at 3:20pm, and the acknowledgment does not come back until 9:05pm the same day. **Five hours and forty-five minutes to confirm a single one-hour float, and that gap is invisible to anyone until the reply finally lands.** Then Failure 4 (cannot reach the floater en route: Quad to Hill, five minutes late, Hill calls Harnwell, HMOD secures Allied, floater arrives two minutes later, double-covered and paid for nothing) and Failure 5 (a house claims it has no floater and there is no way to check, so the burden lands on Harnwell). | `[SHOT]` verbatim panel + `[DIAGRAM]` |
| 24  | **What happens now, part 1**      | The system picks the floater from real staffing, not from a phone call. It arrives as a push notification and an in-app card. You acknowledge yes or no with a tap, in the app. If you have not, it reminds you at 6 hours, 2 hours, 1 hour, 30 minutes, and 5 minutes before the deadline. Managers see acknowledgment status at a glance. Put the 5h45m stat from slide 23 right next to "acknowledged in seconds, not hours" here for the contrast.                                                                                                                                                                              | `[SHOT]` float card + ack             |
| 25  | **What happens now, part 2**      | The float is already on your schedule and your widget, including a partial one, so there is nothing to add and nothing to misremember. Tap the floater on the schedule to call them directly, which stops the panic-page while they are two minutes away. And the rules are enforced in software: a house cannot be left below one worker, and it cannot claim it has nobody when it does.                                                                                                                                                                                                                                          | `[SHOT]` House grid + contact card    |

**Grounding notes for slide 24 and 25:** the reminder cadence (6h / 2h / 1h / 30m / 5m before a deadline set at 10 minutes before float start) is BSpec §7.1 and is exact. The tap-to-call contact card is built (migration 20260722000001). Say "the system will not let a house dodge its turn" carefully: what is actually enforced is that the algorithm selects from real staffing state and a source desk can never drop below one present worker. That is stronger than trust, and it is honest.

**On fairness, say this out loud:** today, enforcing the float rota costs her a personal relationship every time she has to push back on a house that claims it has nobody. The software removes that cost. She is not the enforcer anymore.

---

#### Problem 5. Unnecessary pages (slides 26 to 28)

| #   | Slide                | Content                                                                                                                                                                                                                                                                                          | Visual                           |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| 26  | The pattern          | Workers page the HMOD, or call you, for things experience already answers. Does this group get access to this room. What do I do about a PAN card issue after I have tried the obvious things. The answer usually exists, in a binder or in an experienced head, but not findable in the moment. | `[DIAGRAM]`                      |
| 27  | Two hidden costs     | It is not only interruption. **New workers ramp slowly**, and **procedural knowledge leaves when people cycle out.** The binder exists, but long documents do not get read at the moment of need.                                                                                                | `[TEXT]`                         |
| 28  | **What happens now** | An assistant grounded strictly in official documentation that **cites the document it answered from**, scoped by role and house, that computes the correct current contact from live duty state rather than a static list. It never invents an answer.                                           | `[SHOT]` Assistant with citation |

**Honesty constraint:** frame as a designed mechanism, not a measured reduction. No "cuts pages by X%." We have no baseline. If she asks how much it will help, the correct answer is that we will measure it in the pilot, and that measurement is one of the reasons to run one.

---

#### Problem 6. Incomplete pages (slides 29 to 30)

| #   | Slide                | Content                                                                                                                                                                                                                                                                                                 | Visual                 |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 29  | Michelle's problem   | Attribute it, since it came from the Harnwell HM: pages go up missing the one fact that determines the response. Building-wide or one room. What was already tried. When the shift ends. So the HMOD calls back, and resolution slows.                                                                  | `[DIAGRAM]`            |
| 30  | **What happens now** | Paging becomes a guided flow, not a blank box. It asks for the specific facts that situation needs, categorizes and routes it correctly, and the person still reviews and edits before it sends. Better pages, and fewer of them, because the flow often surfaces the answer before the page is needed. | `[SHOT]` page composer |

---

#### Problem 7. Building the schedule (slides 31 to 34)

| #   | Slide                          | Content                                                                                                                                                                                                                                                           | Visual                      |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 31  | The SM's build week            | Collect everyone's preferences. Open several spreadsheets side by side. Reconcile by hand against coverage, target hours, and who cannot work when. Hours of work, and the result is only as good as the person's patience at 1am.                                | `[DIAGRAM]`                 |
| 32  | **What happens now**           | The app generates a full draft schedule for the house. The SM reviews it and edits anything. It is a first draft that removes the tedious pass, not an autopilot. **The manager stays in control.**                                                               | `[SHOT]` builder + AI panel |
| 33  | **The guarantee that matters** | "Cannot work" is not a preference the system weighs. It is a hard constraint. A draft that assigns someone to a block they marked as cannot work is rejected as invalid before it is ever shown. Availability is never traded away for a better-looking schedule. | `[TEXT]`                    |
| 34  | How we will measure it         | The metrics, then the placeholder result.                                                                                                                                                                                                                         | `[DIAGRAM]`                 |

**Slide 33 is grounded and I verified it in code**: `validator.ts` rejects any assignment where the worker marked the block `cannot` (line 132), and the eligibility check returns false for those blocks (line 199). This is a genuinely strong claim and you should make it confidently.

**Slide 34, the accuracy discussion.** You were right that "how close is it to the schedule we actually built" is a weak measure. A different-looking schedule can be a better one. The good news is the system already computes the metrics you described. The scorer (`packages/core/src/ai-schedule/scorer.ts`) breaks every draft into six named components, three of which are exactly your criteria:

- **Preference satisfaction.** Blocks assigned that the worker marked as preferred, weighted above merely available ones.
- **Target-hours fit.** Per-worker deviation from their target hours, penalized in both directions, and over-target is penalized harder than under.
- **Fairness.** The spread across the roster, computed as standard deviation of preferred-block counts and of hours-versus-target. **Low spread means everyone got a comparable deal.** This is precisely your summer question of whether everyone got an equal share.

So the deck proposes this measurement, with a placeholder for the result:

| Measure                                        | Human-built (summer 2026 actual) | AI draft              | Read                |
| ---------------------------------------------- | -------------------------------- | --------------------- | ------------------- |
| Workers who hit their target hours             | _placeholder_                    | _placeholder_         | Higher is better    |
| Share of assigned blocks that were "preferred" | _placeholder_                    | _placeholder_         | Higher is better    |
| "Cannot work" violations                       | _placeholder_                    | **0 by construction** | Must be zero        |
| Fairness spread (hours vs target)              | _placeholder_                    | _placeholder_         | **Lower is better** |
| Coverage gaps left unfilled                    | _placeholder_                    | _placeholder_         | Lower is better     |

Once you send me the summer records I will run the draft against the same inputs and fill this in. Two honest caveats to keep in the speaker notes: the comparison is a single house-season, so it is an indication and not a proven average; and the AI is scored by our own scorer, so on any metric the scorer optimizes it has a structural advantage. **Target-hours hit rate and cannot-work violations are the two neutral measures**, since they are countable facts independent of our weighting. Lead the slide with those two.

If the numbers come back unflattering, the slide still works. "Here is how we measure it, here is where it currently lands, here is what we would tune" is a more credible posture in front of her than a suspiciously perfect number, and it makes the pilot the obvious next step.

### ACT 3. Proof, demo, ask (slides 35 to 38, plus appendix)

| #   | Slide               | Content                                                                                                                                                                                                         | Visual   |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 35  | What is built today | Short phrases only, the full capability list. Framed as: "None of this is a mockup."                                                                                                                            | `[TEXT]` |
| 36  | Live demo           | Drop a shift, watch it appear in the open feed, claim it from another house, float lands as a notification, acknowledge it, show the widget. Five minutes.                                                      | live     |
| 37  | **The ask**         | One or two houses, a defined trial window, running alongside the current process so nothing breaks if you stop. What you need from her: her blessing, and a point of contact for real worker and schedule data. | `[TEXT]` |
| 38  | The takeaway        | One sentence, ink background, blue rule. Nothing else.                                                                                                                                                          | `[TEXT]` |

**Appendix (not presented, held in back pocket):** who maintains it after you graduate, student data and privacy, adoption risk, cost, the exceptions in Penn's float rules, and the technical scale slide (129 migrations, 62 database test suites, 29 backend functions, ~108 test files, iPhone and Android and web). Section 10 of the existing info sheet already has good answers for most of these and I will carry them over.

**On the scale numbers:** keep them out of the main deck entirely. To her they signal "this is complicated and will break when he leaves," which is the opposite of reassuring. They only help if she or a colleague challenges whether this is a serious build.

---

## 4. Screenshots I need to capture

Grouped by surface, in the order they appear.

**iOS Simulator (worker app):**

1. My Shifts, week overview with real-looking data (slide 18)
2. Manage-shift sheet, drop intent (slide 10)
3. Open Shifts feed showing own house and other houses (slide 15)
4. Open Shifts, a partial claim in progress (slide 15 inset)
5. Float assignment card with acknowledge and decline (slide 24)
6. Float acknowledged state, plus reminder notification (slide 24 inset)
7. House grid week view (slide 25)
8. Contact card with the Call button (slide 25 inset)
9. Home-screen widget, next shift (slide 18)
10. Desk Assistant answer with a visible citation (slide 28)
11. Guided page composer (slide 30)

**Web admin:** 12. Schedule builder with the AI panel (slide 32) 13. Inbound float acknowledgment status as a manager sees it (slide 24)

Two constraints. **Every screenshot needs plausible, populated data** and no empty states, so I will pre-load the demo build. And **the page composer (11) needs verification** that it is built to a demo-ready state; if it is not, slide 30 becomes a diagram and I will say the flow is designed rather than showing a screen that does not exist. I will confirm that before capture rather than promising a screenshot I cannot take.

---

## 5. Features I am deliberately holding back

The app does considerably more than the seven problems. Adding all of it would dilute the deck. My recommendation on each:

**Weave in as a single line where it naturally fits:**

- **Swaps and one-way handoffs**, agreed peer to peer with no manager approval. One line on slide 10, since it is the same "no email" point.
- **Automatic hours breakdown** (home, floated out, cross-house pickup). One line on slide 25. This kills the documentation burden of emailing the RSM and both SMs just to get hours approved, which is a real pain of hers from the earlier sheet even though you did not raise it this time. **Worth confirming with you whether this is still a live pain**, because if it is, it deserves its own slide rather than a line.
- **Allied as a genuine last resort**, capped at 4 hours per securing pass. One line on slide 10. Do not develop the budget argument; that is for her superiors.

**Hold for the appendix or a follow-up conversation:**

- Permanent drops and pickups, break-period claim calendar, house transfers between seasons, preference painting, the staggered house-by-house launch plan, cross-house read-only viewing, the onboarding tour, per-worker colors on the grid.

**Deliberately omit:** anything about cost, "ghosting," or system architecture.

---

## 6. Copy rules for the build

- **No em dashes or en dashes anywhere in slide copy.** Project rule, and it applies to every visible string.
- Never put an internal term on a slide. Float lookup, escalation chain, coverage floor, HMOD, cross-house pickup, source of truth, and block all get translated. Section 8 of the existing info sheet has the full translation table and I will apply it.
- Numbers get their own slide or their own line. Never buried in a paragraph.
- Every solution slide opens by naming the pain it kills, in her words, before it says what the app does.

---

## 7. What I need from you before I build

1. **The summer records**, when you have them, to fill slide 34. Not a blocker; I will build the slide with the placeholder table and fill it in after.
2. **Confirmation on the hours-approval documentation pain**, per section 5, since it may deserve promotion to a full section.
3. **A yes or no on the redaction call in section 2**, real first names as transcribed versus a further step back to role labels only ("a Harrison SM" instead of "Adailia"). Default is first names, no contact info, as built.

Resolved: the layout system (section 2, split and stacked, taken from your reference photos), the palette (white, ink, brand blue, warm gray for problem states, no brown or orange anywhere), and the five Template C verbatim artifacts (section 2), now transcribed from your real screenshots and slotted into slides 11, 12, 13, 20, and 23.

None of the three remaining items block me. I can build the full deck end to end now, leaving one table on slide 34 as a marked placeholder for when the summer records arrive.
