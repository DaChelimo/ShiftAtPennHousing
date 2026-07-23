#!/usr/bin/env python3
"""
Shift@PennHousing. RSM presentation, full 38-slide deck.

Visual system v1 (see build_v1_baseline.py for the locked reference):
  White ground, warm near-black ink, ONE accent (brand blue), warm gray for
  "today"/problem states. No brown, orange, amber. IBM Plex Sans + Plex Mono.
  Two structures: STACKED and SPLIT. Rounded corners, hairlines, no shadows.

Every factual claim is grounded in BEHAVIORAL_SPECIFICATION.md, ARCHITECTURE.md,
docs/desk-assistant/, or packages/core source. Verbatim artifacts are real,
redacted to first names with no contact details.

Usage: python3 build_deck.py   ->  writes rsm-deck.html
"""
import base64
import pathlib

HERE = pathlib.Path(__file__).parent
REPO = HERE.parent.parent.parent
FONT_DIR = REPO / "apps/mobile/iosApp/iosApp/Fonts"
SCRATCH = pathlib.Path(
    "/private/tmp/claude-502/-Users-DaChelimo-Documents-TechWork-Shift-PennHousing/"
    "cc63fdd4-24b5-4516-8ee1-40fe020baf15/scratchpad"
)
OUT = HERE / "rsm-deck.html"
PRINT_OUT = HERE / "rsm-deck-print.html"


def b64(p: pathlib.Path) -> str:
    return base64.b64encode(p.read_bytes()).decode("ascii") if p.exists() else ""


FONTS = {
    "sans": b64(FONT_DIR / "IBMPlexSans-Regular.ttf"),
    "semi": b64(FONT_DIR / "IBMPlexSans-SemiBold.ttf"),
    "mono": b64(FONT_DIR / "IBMPlexMono-Regular.ttf"),
}
IMG = {
    "myshifts": b64(SCRATCH / "shot-s-myshifts.png"),
    "open": b64(SCRATCH / "shot-s-open.png"),
    "house": b64(SCRATCH / "shot-s-house.png"),
    "assistant": b64(SCRATCH / "shot-s-assistant.png"),
}

slides: list[str] = []


def add(html: str) -> None:
    slides.append(html)


def rail(active: int | None) -> str:
    """Footer progress rail. active = problem number 1..7, or None."""
    if active is None:
        return ""
    dots = "".join(
        f'<span class="dot{" on" if i == active else ""}{" done" if i < active else ""}"></span>'
        for i in range(1, 8)
    )
    return f'<div class="rail"><span class="rail-label">Problem {active} of 7</span><span class="dots">{dots}</span></div>'


def slide(body: str, cls: str = "", active: int | None = None, n: str = "") -> None:
    add(
        f'<section class="slide {cls}" data-n="{n}">{body}{rail(active)}'
        f'<span class="pagenum">{n}</span></section>'
    )


def head(eyebrow: str, h1: str, dek: str = "") -> str:
    d = f'<p class="dek">{dek}</p>' if dek else ""
    return f'<p class="eyebrow">{eyebrow}</p><h1>{h1}</h1>{d}'


def punch(text: str) -> str:
    return f'<div class="punchline"><span class="bar"></span><p>{text}</p></div>'


def phone(key: str, alt: str) -> str:
    return (
        f'<div class="phone"><img src="data:image/png;base64,{IMG[key]}" alt="{alt}"></div>'
    )


def chain(rows: list[tuple[str, str, str]]) -> str:
    """rows = (kind, label, text). kind: today | gap | fix"""
    out = []
    for kind, label, text in rows:
        out.append(
            f'<div class="chain-step is-{kind}"><span class="n">{label}</span>'
            f'<span class="label">{text}</span></div>'
        )
    return f'<div class="chain">{"".join(out)}</div>'


def artifact(meta: str, body: str, wide: bool = False) -> str:
    return (
        f'<div class="artifact{" wide" if wide else ""}"><p class="meta">{meta}</p>'
        f'<div class="body">{body}</div></div>'
    )


def features(items: list[str]) -> str:
    lis = "".join(
        f'<li><span class="tick">&#10003;</span><span>{t}</span></li>' for t in items
    )
    return f'<ul class="feature-list">{lis}</ul>'


# =====================================================================
# ACT 0. OPEN
# =====================================================================

slide(
    '<div class="title-wrap">'
    '<p class="eyebrow">Penn Residential Services</p>'
    "<h1 class=\"mega\">Shift</h1>"
    '<p class="title-sub">One app for desk staffing across all 13 houses.</p>'
    '<div class="title-meta"><span>Andrew Chelimo</span><span>Harnwell College House</span></div>'
    "</div>",
    cls="is-title",
    n="1",
)

slide(
    head(
        "What it is",
        "One live schedule that fills its own empty desks",
        "Every house shares it. It updates the moment anything changes, it reminds people so shifts are not forgotten, and it finds coverage before a desk goes empty.",
    )
    + punch("No more inbox. No more spreadsheet. No more group chat lottery."),
    n="2",
)

slide(
    head(
        "Why I built it",
        "I work these desks",
        "I have dropped shifts, picked them up, floated to other houses, and watched the same handful of failures repeat every single week.",
    )
    + punch("This is not a product looking for a problem. It is our problem, solved."),
    n="3",
)

# =====================================================================
# ACT 1. THE WHOLE PROBLEM
# =====================================================================

PROBLEMS = [
    ("01", "Drops turn into an email negotiation"),
    ("02", "Pickups are a group chat lottery"),
    ("03", "Picked up, then forgotten"),
    ("04", "Floating runs on email and trust"),
    ("05", "Paged for what experience already answers"),
    ("06", "The pages that matter arrive incomplete"),
    ("07", "Schedules are built by hand"),
]
chips = "".join(
    f'<li class="chip{" is-centerpiece" if n == "04" else ""}">'
    f'<span class="chip-num">{n}</span><span class="chip-text">{t}</span></li>'
    for n, t in PROBLEMS
)
slide(
    head(
        "The problem",
        "Seven things that go wrong today",
        "Every one of these still runs on an inbox, a group chat, or someone's memory.",
    )
    + f'<ul class="grid">{chips}</ul>'
    + punch("Seven problems. One cause. Stop me on any of them."),
    n="4",
)

slide(
    head("The cause", "There is no system")
    + '<div class="big-statement">There are people, inboxes, a group chat, and memory. '
    'Everything that follows is <em>one fix applied seven times</em>: put the truth in one '
    "place, and make it reach the person who needs it.</div>",
    n="5",
)

TOOLS = [
    ("Email", "Drops, swaps, float requests, hours paperwork", "Easy to miss. Never a live picture. Everyone is cc'd, nobody is responsible."),
    ("Excel", "Building and holding the schedule", "Stale the moment anything changes. Reminds no one of anything."),
    ("GroupMe", "Cross-house pickups, last-minute cover", "Buried in replies. First come first served. No record."),
    ("Phone", "Confirming who is actually coming", "Only works if you have the number and they answer."),
]
tool_cols = "".join(
    f'<div class="tool"><div class="tool-name">{n}</div>'
    f'<div class="tool-use">{u}</div><div class="tool-fail">{f}</div></div>'
    for n, u, f in TOOLS
)
slide(
    head(
        "Today's toolkit",
        "Four tools, none of them talking",
        "None of them is live. None of them reminds anyone. The manager is the glue holding it together.",
    )
    + f'<div class="tools">{tool_cols}</div>',
    n="6",
)

# =====================================================================
# PROBLEM 1. DROPPING A SHIFT
# =====================================================================

slide(
    '<div class="divider-wrap"><p class="eyebrow">Problem 01</p>'
    '<h1 class="mega-sm">Drops turn into an email negotiation</h1>'
    '<p class="dek">A worker cannot make a shift. What happens next depends on who reads the email first.</p></div>',
    cls="is-divider",
    active=1,
    n="7",
)

slide(
    head("Dropping a shift", "Where the authority runs out")
    + '<div class="two-branch">'
    '<div class="branch"><div class="branch-head">The desk still has someone</div>'
    '<div class="branch-body">The student manager can approve it and edit the sheet. This case is fine.</div></div>'
    '<div class="branch is-bad"><div class="branch-head">The desk would be empty</div>'
    '<div class="branch-body">The student manager can see it and can do nothing about it. It comes to you. You fill the desk yourself, or you pay for outside coverage.</div></div>'
    "</div>"
    + punch("The person closest to the problem is the one who cannot solve it."),
    active=1,
    n="8",
)

slide(
    head(
        "Dropping a shift, after hours",
        "One drop, four communications",
        "Three of them exist only because the first one might not be read in time.",
    )
    + chain(
        [
            ("today", "01", "Email the student manager and the RSM."),
            ("today", "02", "Call the desk anyway, because email is not fast enough."),
            ("today", "03", "If you are not at Harnwell, call Harnwell too."),
            ("today", "04", "Harnwell pages the manager on duty."),
        ]
    )
    + punch("Every step is a person compensating for a system that cannot tell anyone anything."),
    active=1,
    n="9",
)

slide(
    head("What happens now", "Drop it in the app. That is the whole process.")
    + features(
        [
            "The seat reopens instantly, visible to everyone who could fill it.",
            "Swaps and handoffs are agreed between the two workers, with no manager in the middle.",
            "The system checks whether the desk would actually be empty.",
            "It only goes looking for coverage when it truly would be.",
        ]
    )
    + '<div class="callout"><span class="callout-key">The quiet part</span>'
    "A Harnwell desk dropping from two workers to one is still covered, so nobody is paged. "
    "The system stays silent until a desk would have nobody on it.</div>",
    active=1,
    n="10",
)

# =====================================================================
# PROBLEM 2. PICKING UP ACROSS HOUSES
# =====================================================================

slide(
    '<div class="divider-wrap"><p class="eyebrow">Problem 02</p>'
    '<h1 class="mega-sm">Pickups are a group chat lottery</h1>'
    '<p class="dek">This is the one where the current process actively teaches people to stop trying.</p></div>',
    cls="is-divider",
    active=2,
    n="11",
)

slide(
    head("How a shift gets offered today", "The entire mechanism is one message")
    + artifact(
        "Summer IC Workers group chat &nbsp;&middot;&nbsp; 11:25 AM",
        "Hi everyone! The following shifts are available at Rodin this week and for the week of "
        "7/27 to 8/2. If you're interested please send me <em>your name, phone number, email, and "
        "the IC you work at</em>. Please ensure you specify the dates and times of the shift you "
        "pick up and make sure you are not exceeding 40 hours."
        '<div class="shiftlist">'
        "<span>Wednesday 7/22 &nbsp; 5pm to 8pm</span>"
        "<span>Sunday 7/26 &nbsp; 5:30am to 8am <b class=\"nocov\">(NO COVERAGE)</b> &nbsp; 8am to 12pm</span>"
        "<span>Monday 7/27 &nbsp; 4pm to 8pm</span>"
        "<span>Tuesday 7/28 &nbsp; 8am to 12pm <b class=\"nocov\">(NO COVERAGE)</b> &nbsp; 12pm to 4pm</span>"
        "<span>Thursday 7/30 &nbsp; 4pm to 8pm <b class=\"nocov\">(NO COVERAGE)</b></span>"
        "<span>Friday 7/31 &nbsp; 4pm to 8pm</span>"
        "<span>Saturday 8/1 &nbsp; 5:30am to 8am &nbsp; 8am to 12pm &nbsp; 12pm to 4pm &nbsp; 8pm to 12am</span>"
        "</div>",
        wide=True,
    )
    + punch("To claim one three-hour block, you file a small application."),
    active=2,
    n="12",
)

slide(
    head(
        "What happens underneath it",
        "The claims land in the replies, not in the list",
        "Five people, five different slots, each acknowledged with a thumbs up. Nothing marks the original message as out of date.",
    )
    + '<div class="replies">'
    '<div class="reply"><span class="who">Grace</span><span class="what">I\'ll take Friday 7/31 4pm to 8pm</span><span class="tu">&#128077;</span></div>'
    '<div class="reply"><span class="who">Jamia</span><span class="what">i can pick up saturday 12-4pm</span><span class="tu">&#128077;</span></div>'
    '<div class="reply"><span class="who">Grace</span><span class="what">Sunday 8/2 8pm-12am too</span><span class="tu">&#128077;</span></div>'
    '<div class="reply"><span class="who">Sunny</span><span class="what">I can do 8/1 8am-12pm</span><span class="tu">&#128077;</span></div>'
    '<div class="reply"><span class="who">Joy</span><span class="what">Ik can do Monday 4-8</span><span class="tu">&#128077;</span></div>'
    "</div>"
    + punch("A sixth person cannot tell what is left without reading every reply."),
    active=2,
    n="13",
)

slide(
    head("Picking up a shift", "I claimed a shift. It was already gone.")
    + artifact(
        "Direct message &nbsp;&middot;&nbsp; from a Harrison student manager &nbsp;&middot;&nbsp; 3:32 PM",
        "Hi Andrew, this is Adailia from Harrison! I made an error on my end and listed Mon 5-9pm "
        "as an available shift, <em>it was taken by someone else prior</em>. My apologies for that, "
        "but please let me know if you'd like any of the remaining shifts in the main gc!",
    )
    + punch("The shifts are not unfillable. People have learned not to bother."),
    active=2,
    n="14",
)

slide(
    '<div class="text-col">'
    + head("What happens now", "One feed. Claimed means gone.")
    + features(
        [
            "Your house and every other house, in one list.",
            "Claim with one tap. It disappears for everyone.",
            "Take part of a shift, not just all of it.",
            "No name, phone, or email. It knows who you are.",
        ]
    )
    + "</div>"
    + f'<div class="visual-col">{phone("open", "The Open Shifts feed, showing claimable shifts with Claim buttons and one locked shift.")}</div>',
    cls="split",
    active=2,
    n="15",
)

# =====================================================================
# PROBLEM 3. FORGOTTEN SHIFTS
# =====================================================================

slide(
    '<div class="divider-wrap"><p class="eyebrow">Problem 03</p>'
    '<h1 class="mega-sm">Picked up, then forgotten</h1>'
    '<p class="dek">The most common way a desk ends up empty is not malice. It is memory.</p></div>',
    cls="is-divider",
    active=3,
    n="16",
)

slide(
    head("Why it happens", "The shift lives nowhere")
    + chain(
        [
            ("today", "01", "You agree to a shift in a group chat or an email."),
            ("today", "02", "Now you have to remember to add it to your own calendar."),
            ("gap", "&#8595;", "It is not part of your routine, so often it does not happen."),
            ("today", "03", "The shift exists in a message and in your intention. Nowhere else."),
        ]
    )
    + punch("Nobody finds out until the desk is empty."),
    active=3,
    n="17",
)

slide(
    '<div class="text-col">'
    + head("What happens now", "It is already on your schedule")
    + features(
        [
            "Claiming it put it there. Nothing to add.",
            "A home screen widget, so it is in front of you.",
            "Notifications about your own shifts cannot be silenced.",
            "Change anything and it updates everywhere at once.",
        ]
    )
    + "</div>"
    + f'<div class="visual-col">{phone("myshifts", "My Shifts, showing the week and an inbound float request card.")}</div>',
    cls="split",
    active=3,
    n="18",
)

# =====================================================================
# PROBLEM 4. FLOATING
# =====================================================================

slide(
    '<div class="divider-wrap"><p class="eyebrow">Problem 04 &nbsp;&middot;&nbsp; the big one</p>'
    '<h1 class="mega-sm">Floating runs on email and trust</h1>'
    '<p class="dek">Sending a worker from one house to cover another. It matters most in fall and spring, and it fails in five different ways.</p></div>',
    cls="is-divider",
    active=4,
    n="19",
)

slide(
    head("Floating today", "Three people. Two calls. One hour of cover.")
    + artifact(
        "Email thread &nbsp;&middot;&nbsp; Sunday &nbsp;&middot;&nbsp; 12:44 PM to 12:56 PM",
        '<div class="msg"><span class="from">Andrew, 12:44 PM</span>'
        "Rodin just called requesting a floater from 1:00 PM to 2:00 PM. I initially told them to "
        "call the Quad first, but they currently have Allied coverage and are unable to check. She "
        "later called back, and I asked her to call again 20 minutes before 1:00 PM. However, she "
        "mentioned she will be unavailable from 11:30 AM onward. Since we have two workers scheduled "
        "at that time, I wanted to pass this along to see whether Jing can float to the Rodin desk "
        "for that hour.</div>"
        '<div class="msg"><span class="from">Abraham, 12:56 PM</span>'
        "Thanks for the heads up. Jing can float to Rodin from 1:00 to 2:00 PM. Also, I did call her "
        "and she mentioned you texted her, which is okay, but for future reference "
        "<em>please use the desk phone to call the scheduled worker directly</em>. Calls are preferred "
        "since they get an immediate yes or no, whereas a text might be seen late or ignored.</div>",
        wide=True,
    ),
    active=4,
    n="20",
)

slide(
    head("Read that last line again", "We already know the channel is unreliable")
    + '<div class="pullquote">A text might be seen late or ignored, especially for time sensitive coverage like this.</div>'
    + '<p class="attrib">The correct instinct, written down by a manager. The problem is that a phone call is the only tool available that gives a yes or no.</p>'
    + punch("The app makes the answer part of the request, so nobody has to chase it."),
    active=4,
    n="21",
)

slide(
    head("Floating", "Five ways it fails")
    + '<div class="fails">'
    '<div class="fail"><span class="fn">1</span><div><b>They never saw the email.</b> So they never knew they were meant to float at all.</div></div>'
    '<div class="fail"><span class="fn">2</span><div><b>They saw it, agreed, and forgot.</b> They go to their home desk on autopilot. The desk they were covering sits empty.</div></div>'
    '<div class="fail"><span class="fn">3</span><div><b>They never replied.</b> Nobody knows whether anyone is coming, so the reply gets assumed.</div></div>'
    '<div class="fail"><span class="fn">4</span><div><b>Nobody can reach them en route.</b> The desk waits five minutes, panics, and pages for paid coverage.</div></div>'
    '<div class="fail"><span class="fn">5</span><div><b>The rota can be dodged.</b> A house says it has no floater. There is no way to check, so the burden lands on Harnwell.</div></div>'
    "</div>",
    active=4,
    n="22",
)

slide(
    head("Failure 2, the worst version", "The partial float")
    + '<div class="partial">'
    '<div class="pf"><div class="pf-lab">Scheduled</div><div class="pf-bar"><span class="seg full">Harnwell &nbsp; 12:00 to 18:00</span></div></div>'
    '<div class="pf"><div class="pf-lab">Floated</div><div class="pf-bar"><span class="seg part">DuBois &nbsp; 12:00 to 16:00</span><span class="seg rest">Harnwell &nbsp; 16:00 to 18:00</span></div></div>'
    "</div>"
    + '<div class="big-statement">You are working either way, so nothing feels wrong. You show up at Harnwell. '
    "<em>Two desks are now wrong at once</em>: the one you left uncovered, and the one you are standing at.</div>",
    active=4,
    n="23",
)

slide(
    head("Failure 3, with a real number", "Nobody knows if the floater is coming")
    + '<div class="stat-row">'
    '<div class="stat"><div class="num">5h45m</div><div class="cap">to confirm one hour of cover</div></div>'
    '<div class="timeline">'
    '<div class="tl-row"><span class="tl-time">3:20 PM</span><span class="tl-text">The float request goes out by email.</span></div>'
    '<div class="tl-row is-gap"><span class="tl-time">&hellip;</span><span class="tl-text">No reply. No status anywhere. Nobody can tell whether the desk is covered.</span></div>'
    '<div class="tl-row"><span class="tl-time">9:05 PM</span><span class="tl-text">The worker replies to acknowledge.</span></div>'
    "</div></div>"
    + punch("Real dates, one of my own floats to Mayer Hall."),
    active=4,
    n="24",
)

slide(
    '<div class="text-col">'
    + head("What happens now", "The float finds them, and answers back")
    + features(
        [
            "Accept or decline with one tap.",
            "A visible deadline, counting down.",
            "Reminders at 6h, 2h, 1h, 30m, and 5m.",
            "You see who has answered, at a glance.",
        ]
    )
    + '<div class="mini-note">Answered in seconds, not five hours and forty five minutes.</div>'
    + "</div>"
    + f'<div class="visual-col">{phone("myshifts", "A float request card with Accept and Decline and a countdown to the deadline.")}</div>',
    cls="split",
    active=4,
    n="25",
)

slide(
    '<div class="text-col">'
    + head("What happens now", "And the desk can reach them")
    + features(
        [
            "One screen showing who is on every desk, right now.",
            "Tap anyone to see their details and call them.",
            "Cross-house cover is colour coded and labelled.",
            "That kills the panic page while a floater is two minutes away.",
        ]
    )
    + "</div>"
    + f'<div class="visual-col">{phone("house", "The house week grid, colour coded per worker, with the desk phone number.")}</div>',
    cls="split",
    active=4,
    n="26",
)

slide(
    head("Failure 5", "The rota is enforced, not trusted")
    + '<div class="two-branch">'
    '<div class="branch is-bad"><div class="branch-head">Today</div>'
    '<div class="branch-body">A house says it has no floater available. There is no way to verify it, so the burden quietly moves to whoever will say yes.</div></div>'
    '<div class="branch is-good"><div class="branch-head">With the app</div>'
    '<div class="branch-body">The system picks the floater from the real staffing picture. A desk can never be left below one worker, and Harnwell is never a destination.</div></div>'
    "</div>"
    + punch("You stop being the person who has to push back."),
    active=4,
    n="27",
)

# =====================================================================
# PROBLEM 5. UNNECESSARY PAGES
# =====================================================================

slide(
    '<div class="divider-wrap"><p class="eyebrow">Problem 05</p>'
    '<h1 class="mega-sm">Paged for what experience already answers</h1>'
    '<p class="dek">The manager on duty is the first stop for questions that should never have reached them.</p></div>',
    cls="is-divider",
    active=5,
    n="28",
)

slide(
    head("The pattern", "The answer exists. It is just not findable in the moment.")
    + '<div class="qgrid">'
    '<div class="q">Does this group get access to this room?</div>'
    '<div class="q">My PAN card is not working and I have tried the obvious things.</div>'
    '<div class="q">A contractor is asking to be let in. Do I?</div>'
    '<div class="q">The alarm is going off in one room. Is that a building thing?</div>'
    "</div>"
    + '<div class="callout"><span class="callout-key">Two hidden costs</span>'
    "New workers take a long time to get up to speed, and hard-won knowledge leaves when people "
    "graduate. The binder exists. Long documents do not get read at the moment of need.</div>",
    active=5,
    n="29",
)

slide(
    '<div class="text-col">'
    + head("What happens now", "Ask first. Page only if you still need to.")
    + features(
        [
            "Grounded strictly in the official documentation.",
            "It cites the document it answered from.",
            "It knows who is actually on duty right now.",
            "Scoped by role and house, so answers fit the asker.",
        ]
    )
    + '<div class="mini-note">Built and working. Whether it reduces pages is exactly what a pilot would measure.</div>'
    + "</div>"
    + f'<div class="visual-col">{phone("assistant", "The desk assistant, stating that answers are grounded in official documentation and the current duty schedule.")}</div>',
    cls="split",
    active=5,
    n="30",
)

# =====================================================================
# PROBLEM 6. INCOMPLETE PAGES
# =====================================================================

slide(
    '<div class="divider-wrap"><p class="eyebrow">Problem 06</p>'
    '<h1 class="mega-sm">The pages that matter arrive incomplete</h1>'
    '<p class="dek">When a page is genuinely warranted, it often lands without the one fact that decides the response.</p></div>',
    cls="is-divider",
    active=6,
    n="31",
)

slide(
    head("The missing facts", "Every call-back costs the same time twice")
    + '<div class="two-branch">'
    '<div class="branch is-bad"><div class="branch-head">What arrives</div>'
    '<div class="branch-body">"There is a water leak."</div></div>'
    '<div class="branch is-good"><div class="branch-head">What is needed to act</div>'
    '<div class="branch-body">Which building and room. One room or building wide. What was already tried. When the desk shift ends. Whether anyone is on the way.</div></div>'
    "</div>"
    + punch("So the manager on duty calls back, and resolution slows down."),
    active=6,
    n="32",
)

slide(
    head("What happens now", "Paging becomes a guided form, not a blank box")
    + features(
        [
            "It asks for the specific facts that this kind of situation needs.",
            "It categorises and routes to the right tier, not always straight to the top.",
            "The person still reviews and edits everything before it sends.",
            "Often the flow surfaces the answer before a page is needed at all.",
        ]
    )
    + '<div class="callout"><span class="callout-key">Where this came from</span>'
    "This one is not my observation. It came from the Harnwell housing manager, who named incomplete "
    "pages as the thing that slows her down most.</div>",
    active=6,
    n="33",
)

# =====================================================================
# PROBLEM 7. BUILDING THE SCHEDULE
# =====================================================================

slide(
    '<div class="divider-wrap"><p class="eyebrow">Problem 07</p>'
    '<h1 class="mega-sm">Schedules are built by hand</h1>'
    '<p class="dek">Every build cycle, a student manager reconciles everyone\'s availability across a pile of spreadsheets.</p></div>',
    cls="is-divider",
    active=7,
    n="34",
)

slide(
    head("The build week today", "Hours of manual reconciliation")
    + chain(
        [
            ("today", "01", "Collect everyone's preferences and target hours."),
            ("today", "02", "Open several spreadsheets side by side."),
            ("today", "03", "Reconcile by hand against coverage, hours, and who cannot work when."),
            ("gap", "&#8595;", "The result is only as good as one person's patience at 1am."),
        ]
    )
    + punch("And if someone transfers or drops out, much of it is done again."),
    active=7,
    n="35",
)

slide(
    head("What happens now", "It drafts the schedule. You still decide.")
    + features(
        [
            "Generates a full draft for the house from everyone's submitted preferences.",
            "The student manager reviews it and edits anything they like.",
            "It is a first draft that removes the tedious pass, not an autopilot.",
            "Coverage always wins over preference. It will not leave a fillable seat empty to make someone happier.",
        ]
    )
    + '<div class="callout"><span class="callout-key">The guarantee that matters</span>'
    'A block someone marked <b>cannot work</b> is not a preference the system weighs. It is a hard '
    "rule. A draft that assigns anyone to a blocked slot is rejected as invalid before it is ever shown.</div>",
    active=7,
    n="36",
)

slide(
    head(
        "How we would measure it",
        "Judge it on what actually matters",
        "Comparing it to the schedule we happened to build is a weak test. A different schedule can be a better one. These are the measures that mean something.",
    )
    + '<table class="metrics"><thead><tr><th>Measure</th><th>Built by hand</th><th>Drafted</th><th>Good is</th></tr></thead><tbody>'
    '<tr><td>Workers who hit their target hours</td><td class="ph">to fill</td><td class="ph">to fill</td><td>Higher</td></tr>'
    '<tr class="hi"><td>"Cannot work" violations</td><td class="ph">to fill</td><td><b>0 by design</b></td><td>Must be zero</td></tr>'
    '<tr><td>Share of shifts that were preferred</td><td class="ph">to fill</td><td class="ph">to fill</td><td>Higher</td></tr>'
    '<tr><td>Fairness spread, hours against target</td><td class="ph">to fill</td><td class="ph">to fill</td><td>Lower</td></tr>'
    '<tr><td>Coverage gaps left unfilled</td><td class="ph">to fill</td><td class="ph">to fill</td><td>Lower</td></tr>'
    "</tbody></table>"
    + '<p class="footnote">Numbers go in as soon as I have the summer records. I would rather show you the real result, including where it loses, than a number you cannot check.</p>',
    active=7,
    n="37",
)

# =====================================================================
# ACT 3. CLOSE
# =====================================================================

BUILT = [
    "One live schedule shared by all 13 houses",
    "Drops, claims, and partial claims in app",
    "Swaps and one-way handoffs, agreed peer to peer",
    "Automatic float assignment with tap to acknowledge",
    "Escalating reminders at 6h, 2h, 1h, 30m, 5m",
    "Automatic coverage search, paid cover as last resort",
    "Home screen widgets for your next shift",
    "Push notifications you cannot miss",
    "Tap any worker to see details and call them",
    "Hours split into home, floated, and cross-house",
    "A grounded assistant that cites its sources",
    "iPhone, Android, and a web view for managers",
]
built_items = "".join(f'<li><span class="tick">&#10003;</span>{b}</li>' for b in BUILT)
slide(
    head("Where this actually is", "None of this is a mockup")
    + f'<ul class="built">{built_items}</ul>',
    n="38",
)

slide(
    head(
        "What I am asking for",
        "Let me prove it in one house",
        "Harnwell is the natural place to start. It carries the most floating complexity, and I work there.",
    )
    + '<div class="ask-grid">'
    '<div class="ask"><div class="ask-n">01</div><div class="ask-t">A defined trial window</div><div class="ask-b">Run real staffing through the app for a few weeks, alongside the current process.</div></div>'
    '<div class="ask"><div class="ask-n">02</div><div class="ask-t">Your blessing</div><div class="ask-b">Nothing changes for anyone who does not want it to. If we stop, nothing breaks.</div></div>'
    '<div class="ask"><div class="ask-n">03</div><div class="ask-t">A point of contact</div><div class="ask-b">For real worker and schedule data, so the pilot runs on the truth.</div></div>'
    "</div>",
    n="39",
)

slide(
    '<div class="title-wrap">'
    '<p class="eyebrow">The takeaway</p>'
    '<h1 class="closer">Today, the desks stay covered because of your inbox and everyone\'s memory.</h1>'
    '<p class="closer-sub">This makes the schedule live, reminds people so shifts are not forgotten, lets workers reach each other, and fills empty desks automatically and fairly.</p>'
    "</div>",
    cls="is-title is-closer",
    n="40",
)

# =====================================================================
# ASSEMBLE
# =====================================================================

CSS = """
@font-face{font-family:"Plex Sans";src:url(data:font/ttf;base64,__SANS__) format("truetype");font-weight:400;font-display:block}
@font-face{font-family:"Plex Sans";src:url(data:font/ttf;base64,__SEMI__) format("truetype");font-weight:600;font-display:block}
@font-face{font-family:"Plex Mono";src:url(data:font/ttf;base64,__MONO__) format("truetype");font-weight:400;font-display:block}

:root{
  --paper:#ffffff; --ink:#1a1d21; --brand:#0061fc; --brand-deep:#00379e;
  --pale:#eaf1ff; --slate:#5b6572; --rule:#e3e6ea; --warn:#8a8478;
  --chrome:#20242a; --chrome-fg:#c9ced6;
}
*{box-sizing:border-box}
body{
  margin:0;background:var(--chrome);color:var(--chrome-fg);
  font-family:"Plex Sans",ui-sans-serif,system-ui,sans-serif;
  display:flex;flex-direction:column;align-items:center;gap:26px;padding:34px 18px 70px;
}
.deck-head{max-width:1280px;width:100%;padding:0 4px 4px;display:flex;justify-content:space-between;
  align-items:baseline;font-family:"Plex Mono",ui-monospace,monospace;font-size:12px;
  letter-spacing:.14em;text-transform:uppercase;color:#7b828c;border-bottom:1px solid #2e343c;padding-bottom:14px}

.slide{
  width:min(100%,1280px);aspect-ratio:16/9;container-type:size;background:var(--paper);
  border-radius:5px;overflow:hidden;box-shadow:0 14px 40px rgba(0,0,0,.35);
  padding:5.2cqw 5.8cqw 4cqw;display:flex;flex-direction:column;position:relative;color:var(--ink);
}
.pagenum{position:absolute;right:2.4cqw;bottom:1.9cqw;font-family:"Plex Mono",ui-monospace,monospace;
  font-size:.92cqw;color:#c2c7cf;letter-spacing:.08em}

.eyebrow{font-family:"Plex Mono",ui-monospace,monospace;font-size:1.02cqw;letter-spacing:.14em;
  text-transform:uppercase;color:var(--slate);margin:0 0 1.1cqw}
h1{font-size:3.5cqw;font-weight:600;line-height:1.1;letter-spacing:-.015em;color:var(--ink);margin:0;text-wrap:balance;max-width:80cqw}
.dek{margin:1.15cqw 0 0;font-size:1.32cqw;line-height:1.5;color:var(--slate);max-width:60cqw}

.punchline{margin-top:auto;display:flex;align-items:stretch;gap:.75cqw;padding-top:1.4cqw;border-top:1px solid var(--rule)}
.punchline .bar{width:.32cqw;background:var(--brand);border-radius:2px;flex:none}
.punchline p{margin:0;font-size:1.46cqw;font-weight:600;color:var(--ink);align-self:center}

/* title + closer */
.is-title{justify-content:center}
.title-wrap{max-width:74cqw}
h1.mega{font-size:11cqw;line-height:.9;letter-spacing:-.04em;margin:.4cqw 0 0}
.title-sub{font-size:1.9cqw;color:var(--ink);margin:2cqw 0 0;font-weight:400;max-width:52cqw;line-height:1.4}
.title-meta{display:flex;gap:2cqw;margin-top:3.4cqw;font-family:"Plex Mono",ui-monospace,monospace;
  font-size:1.02cqw;letter-spacing:.1em;text-transform:uppercase;color:var(--slate)}
.title-meta span+span{padding-left:2cqw;border-left:1px solid var(--rule)}
h1.closer{font-size:3.9cqw;max-width:72cqw}
.closer-sub{font-size:1.5cqw;line-height:1.55;color:var(--slate);margin:2.2cqw 0 0;max-width:62cqw}

/* dividers */
.is-divider{justify-content:center;background:var(--pale)}
.divider-wrap{max-width:72cqw}
h1.mega-sm{font-size:5.4cqw;line-height:1.04;letter-spacing:-.025em}
.is-divider .dek{margin-top:1.8cqw;font-size:1.5cqw;color:#41505f;max-width:56cqw}

/* progress rail */
.rail{position:absolute;left:5.8cqw;bottom:1.9cqw;display:flex;align-items:center;gap:1cqw}
.rail-label{font-family:"Plex Mono",ui-monospace,monospace;font-size:.92cqw;letter-spacing:.1em;
  text-transform:uppercase;color:var(--slate)}
.dots{display:flex;gap:.42cqw;align-items:center}
.dot{width:.5cqw;height:.5cqw;border-radius:50%;background:#d8dce2}
.dot.done{background:#a9b2bd}
.dot.on{background:var(--brand);width:1.5cqw;border-radius:.25cqw}

/* chip grid */
.grid{list-style:none;margin:2.9cqw 0 0;padding:0;display:grid;grid-template-columns:repeat(4,1fr);gap:1.05cqw}
.chip{border:1px solid var(--rule);border-radius:.65cqw;padding:1.35cqw 1.45cqw 1.5cqw;
  display:flex;flex-direction:column;gap:.7cqw;min-height:7cqw}
.chip-num{font-family:"Plex Mono",ui-monospace,monospace;font-size:.9cqw;letter-spacing:.1em;color:var(--brand-deep)}
.chip-text{font-size:1.28cqw;line-height:1.33}
.chip.is-centerpiece{background:var(--pale);border-color:transparent}
.chip.is-centerpiece .chip-num{color:var(--brand)}

/* big statement */
.big-statement{margin-top:2.6cqw;font-size:2.05cqw;line-height:1.45;max-width:70cqw;color:var(--ink)}
.big-statement em{font-style:normal;font-weight:600;color:var(--brand-deep);background:var(--pale);
  box-shadow:0 0 0 .22cqw var(--pale)}

/* toolkit */
.tools{display:grid;grid-template-columns:repeat(4,1fr);gap:1.4cqw;margin-top:3cqw}
.tool{border-top:2px solid var(--ink);padding-top:1.1cqw}
.tool-name{font-size:1.7cqw;font-weight:600;margin-bottom:.9cqw}
.tool-use{font-size:1.14cqw;line-height:1.4;color:var(--ink);margin-bottom:.8cqw}
.tool-fail{font-size:1.14cqw;line-height:1.45;color:var(--warn)}

/* chains */
.chain{display:flex;flex-direction:column;gap:.85cqw;margin-top:2.6cqw;max-width:72cqw}
.chain-step{display:flex;align-items:center;gap:1.15cqw;padding:1.05cqw 1.3cqw;border-radius:.55cqw;border:1px solid var(--rule)}
.chain-step .n{font-family:"Plex Mono",ui-monospace,monospace;font-size:.95cqw;color:var(--warn);flex:none;width:1.7cqw}
.chain-step .label{font-size:1.24cqw;line-height:1.35;color:var(--warn)}
.chain-step.is-today .label{color:#4a5260}
.chain-step.is-gap{border:none;padding-left:1.3cqw}
.chain-step.is-gap .label{font-style:italic;color:var(--slate)}
.chain-step.is-fix{border-color:transparent;background:var(--pale)}
.chain-step.is-fix .n{color:var(--brand)}
.chain-step.is-fix .label{color:var(--ink);font-weight:600}

/* two branch */
.two-branch{display:grid;grid-template-columns:1fr 1fr;gap:1.6cqw;margin-top:2.8cqw}
.branch{border:1px solid var(--rule);border-radius:.7cqw;padding:1.7cqw 1.8cqw}
.branch-head{font-family:"Plex Mono",ui-monospace,monospace;font-size:.98cqw;letter-spacing:.1em;
  text-transform:uppercase;color:var(--slate);margin-bottom:1cqw}
.branch-body{font-size:1.42cqw;line-height:1.45}
.branch.is-bad{background:#fbfaf9}
.branch.is-bad .branch-body{color:var(--warn)}
.branch.is-good{background:var(--pale);border-color:transparent}
.branch.is-good .branch-head{color:var(--brand)}

/* callout */
.callout{margin-top:auto;background:var(--pale);border-radius:.7cqw;padding:1.5cqw 1.7cqw;
  font-size:1.26cqw;line-height:1.5;color:#22303f;max-width:78cqw}
.callout-key{display:block;font-family:"Plex Mono",ui-monospace,monospace;font-size:.9cqw;
  letter-spacing:.12em;text-transform:uppercase;color:var(--brand);margin-bottom:.7cqw}
.callout b{color:var(--brand-deep)}

/* artifact */
.artifact{margin-top:2.2cqw;border:1px solid var(--rule);border-radius:.75cqw;padding:1.8cqw 2cqw;
  background:#fcfdff;max-width:72cqw}
.artifact.wide{max-width:none}
.artifact .meta{font-family:"Plex Mono",ui-monospace,monospace;font-size:.94cqw;letter-spacing:.06em;
  color:var(--slate);margin:0 0 1cqw}
.artifact .body{font-size:1.3cqw;line-height:1.55}
.artifact em{font-style:normal;background:var(--pale);box-shadow:0 0 0 .2cqw var(--pale);
  color:var(--brand-deep);font-weight:600}
.shiftlist{display:flex;flex-direction:column;gap:.3cqw;margin-top:1.1cqw;
  font-family:"Plex Mono",ui-monospace,monospace;font-size:1.02cqw;color:#3d4650}
.nocov{color:var(--warn);font-weight:400}
.msg{margin-bottom:1.1cqw}
.msg:last-child{margin-bottom:0}
.msg .from{display:block;font-family:"Plex Mono",ui-monospace,monospace;font-size:.9cqw;
  letter-spacing:.06em;color:var(--brand);margin-bottom:.4cqw}

/* replies */
.replies{display:flex;flex-direction:column;gap:.7cqw;margin-top:2.4cqw;max-width:66cqw}
.reply{display:flex;align-items:baseline;gap:1.1cqw;border:1px solid var(--rule);border-radius:.55cqw;padding:.95cqw 1.2cqw}
.reply .who{font-family:"Plex Mono",ui-monospace,monospace;font-size:.98cqw;color:var(--slate);width:6cqw;flex:none}
.reply .what{font-size:1.24cqw;flex:1}
.reply .tu{font-size:1.1cqw;opacity:.55}

/* pullquote */
.pullquote{margin-top:2.8cqw;font-size:2.6cqw;line-height:1.35;font-weight:600;max-width:72cqw;
  color:var(--ink);border-left:.34cqw solid var(--brand);padding-left:2cqw}
.attrib{margin-top:1.6cqw;font-size:1.24cqw;color:var(--slate);max-width:62cqw;line-height:1.5}

/* fails */
.fails{display:flex;flex-direction:column;gap:.9cqw;margin-top:2.4cqw}
.fail{display:flex;gap:1.3cqw;align-items:flex-start;font-size:1.26cqw;line-height:1.42}
.fail .fn{font-family:"Plex Mono",ui-monospace,monospace;font-size:1.02cqw;color:var(--brand);
  border:1px solid var(--rule);border-radius:50%;width:2.1cqw;height:2.1cqw;display:flex;
  align-items:center;justify-content:center;flex:none;margin-top:.1cqw}
.fail b{font-weight:600}
.fail div{color:var(--warn)}
.fail b{color:var(--ink)}

/* partial float */
.partial{margin-top:2.6cqw;display:flex;flex-direction:column;gap:1cqw;max-width:76cqw}
.pf{display:flex;align-items:center;gap:1.4cqw}
.pf-lab{font-family:"Plex Mono",ui-monospace,monospace;font-size:.98cqw;letter-spacing:.08em;
  text-transform:uppercase;color:var(--slate);width:8cqw;flex:none;text-align:right}
.pf-bar{display:flex;flex:1;gap:.3cqw}
.seg{padding:1.1cqw 1.3cqw;border-radius:.5cqw;font-size:1.18cqw;font-weight:600;white-space:nowrap}
.seg.full{flex:1;background:#f2f4f7;color:#4a5260}
.seg.part{flex:2;background:var(--brand);color:#fff}
.seg.rest{flex:1;background:#f2f4f7;color:#4a5260}

/* stat */
.stat-row{display:flex;align-items:flex-start;gap:3.4cqw;margin-top:2.6cqw}
.stat{flex:none}
.stat .num{font-size:7.4cqw;font-weight:600;line-height:.92;letter-spacing:-.03em;color:var(--brand);font-variant-numeric:tabular-nums}
.stat .cap{font-family:"Plex Mono",ui-monospace,monospace;font-size:.96cqw;letter-spacing:.12em;
  text-transform:uppercase;color:var(--slate);margin-top:.9cqw;max-width:16cqw;line-height:1.5}
.timeline{flex:1;border-left:1px solid var(--rule);padding-left:3cqw;display:flex;flex-direction:column;gap:1.15cqw;padding-top:.6cqw}
.tl-row{display:flex;gap:1.2cqw;align-items:baseline}
.tl-time{font-family:"Plex Mono",ui-monospace,monospace;font-size:1.1cqw;color:var(--warn);flex:none;width:7cqw}
.tl-text{font-size:1.24cqw;line-height:1.4}
.tl-row.is-gap .tl-time,.tl-row.is-gap .tl-text{color:var(--slate);font-style:italic}

/* split */
.slide.split{flex-direction:row;align-items:center;gap:4.4cqw}
.split .text-col{flex:0 0 46%;display:flex;flex-direction:column}
.split .text-col .dek{max-width:none}
.split .visual-col{flex:1;display:flex;align-items:center;justify-content:center;height:100%}
.phone{height:82cqh;border-radius:2.2cqw;overflow:hidden;border:1px solid var(--rule);background:#000}
.phone img{height:100%;width:auto;display:block}

/* feature list */
.feature-list{list-style:none;margin:2.1cqw 0 0;padding:0;display:flex;flex-direction:column;gap:1cqw}
.feature-list li{display:flex;gap:.9cqw;align-items:baseline;font-size:1.26cqw;line-height:1.42}
.feature-list .tick{color:var(--brand);font-weight:600;flex:none}
.mini-note{margin-top:1.8cqw;font-size:1.1cqw;color:var(--slate);font-style:italic;line-height:1.45}

/* built list */
.built{list-style:none;margin:2.6cqw 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;
  gap:.85cqw 3cqw;max-width:82cqw}
.built li{display:flex;gap:.85cqw;align-items:baseline;font-size:1.22cqw;line-height:1.35}
.built .tick{color:var(--brand);font-weight:600;flex:none}

/* metrics table */
.metrics{width:100%;border-collapse:collapse;margin-top:2.2cqw;font-size:1.24cqw}
.metrics th{text-align:left;font-family:"Plex Mono",ui-monospace,monospace;font-size:.9cqw;
  letter-spacing:.1em;text-transform:uppercase;color:var(--slate);font-weight:400;
  padding:0 1cqw .8cqw 0;border-bottom:1px solid var(--rule)}
.metrics td{padding:1cqw 1cqw 1cqw 0;border-bottom:1px solid var(--rule);color:var(--ink)}
.metrics tr.hi td{background:var(--pale)}
.metrics tr.hi td:first-child{border-top-left-radius:.4cqw;border-bottom-left-radius:.4cqw;padding-left:1cqw}
.metrics tr.hi td:last-child{border-top-right-radius:.4cqw;border-bottom-right-radius:.4cqw}
.metrics .ph{color:#b6bcc4;font-family:"Plex Mono",ui-monospace,monospace;font-size:.98cqw}
.footnote{margin-top:1.6cqw;font-size:1.08cqw;color:var(--slate);line-height:1.5;max-width:64cqw}

/* question grid */
.qgrid{display:grid;grid-template-columns:1fr 1fr;gap:1cqw;margin-top:2.6cqw;max-width:74cqw}
.q{border:1px solid var(--rule);border-radius:.6cqw;padding:1.3cqw 1.5cqw;font-size:1.24cqw;
  line-height:1.4;color:var(--warn)}

/* ask */
.ask-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1.6cqw;margin-top:3cqw}
.ask{border-top:2px solid var(--brand);padding-top:1.2cqw}
.ask-n{font-family:"Plex Mono",ui-monospace,monospace;font-size:.95cqw;letter-spacing:.1em;color:var(--brand);margin-bottom:.8cqw}
.ask-t{font-size:1.6cqw;font-weight:600;margin-bottom:.8cqw;line-height:1.25}
.ask-b{font-size:1.16cqw;line-height:1.45;color:var(--slate)}

@media print{
  body{background:#fff;padding:0;gap:0}
  .deck-head{display:none}
  .slide{box-shadow:none;border-radius:0;page-break-after:always;width:100%}
}
"""
CSS = CSS.replace("__SANS__", FONTS["sans"]).replace("__SEMI__", FONTS["semi"]).replace(
    "__MONO__", FONTS["mono"]
)

html = (
    "<title>Shift@PennHousing. Presentation</title>\n"
    f"<style>{CSS}</style>\n"
    '<div class="deck-head"><span>Shift@PennHousing</span>'
    f"<span>{len(slides)} slides</span></div>\n" + "\n".join(slides) + "\n"
)

OUT.write_text(html, encoding="utf-8")
print(f"wrote {OUT} ({OUT.stat().st_size/1024:.0f} KB), {len(slides)} slides")

# =====================================================================
# PRINT / PDF EXPORT VARIANT
#
# Same `slides` list as the on-screen deck (single source of truth, cannot
# drift). Only the wrapper changes: no dark chrome, no deck-head bar, each
# slide is exactly one PDF page at 16:9 (13.333in x 7.5in, the standard
# PowerPoint widescreen size) with zero margin, so "Print > Save as PDF"
# yields one slide per page and nothing else.
#
# To use: open rsm-deck-print.html in Chrome, Cmd+P, destination "Save as
# PDF", paper size "Custom" matching 13.333 x 7.5in (or just leave Chrome's
# default match-page-size, since @page already declares it), margins "None",
# and turn ON "Background graphics" (Chrome hides tinted panels otherwise).
# =====================================================================
PRINT_CSS_OVERRIDE = """
@page{ size:13.333in 7.5in; margin:0; }
html,body{
  background:#ffffff; margin:0; padding:0; gap:0;
  display:block; -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
.deck-head{display:none}
.slide{
  width:13.333in; height:7.5in; max-width:none;
  box-shadow:none; border-radius:0; margin:0 auto;
  break-after:page; page-break-after:always;
}
.slide:last-child{break-after:auto; page-break-after:auto}
@media screen{
  .slide{border-bottom:1px solid #e5e5e5}
}
"""

print_html = (
    "<title>Shift@PennHousing. Presentation, print</title>\n"
    f"<style>{CSS}{PRINT_CSS_OVERRIDE}</style>\n" + "\n".join(slides) + "\n"
)

PRINT_OUT.write_text(print_html, encoding="utf-8")
print(f"wrote {PRINT_OUT} ({PRINT_OUT.stat().st_size/1024:.0f} KB), {len(slides)} slides")
