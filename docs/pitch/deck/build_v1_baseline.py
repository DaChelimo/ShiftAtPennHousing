#!/usr/bin/env python3
"""
Shift@PennHousing RSM deck. VISUAL SYSTEM v1 (BASELINE).

This is the REVERT POINT. If the Claude Design refinement pass is rejected,
regenerate from this file and the deck returns to exactly this look.

v1 system, in one paragraph:
  Plain white ground, near-black warm ink, ONE accent (brand blue #0061FC),
  warm gray for "today"/problem states. No brown, orange, amber, or red.
  IBM Plex Sans for headline/body, IBM Plex Mono for eyebrow labels, times,
  and anything quoted verbatim from a real system. Two layout structures only:
  STACKED (eyebrow, headline, dek, one full-width visual) and SPLIT (text left,
  visual right). Rounded corners, hairline borders, no shadows, no gradients.

Usage: python3 build_v1_baseline.py
Outputs v1-baseline.html next to this script.
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
OUT = HERE / "v1-baseline.html"


def b64(path: pathlib.Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


sans_regular = b64(FONT_DIR / "IBMPlexSans-Regular.ttf")
sans_semibold = b64(FONT_DIR / "IBMPlexSans-SemiBold.ttf")
mono_regular = b64(FONT_DIR / "IBMPlexMono-Regular.ttf")

shot_path = SCRATCH / "float-shot.png"
float_shot = b64(shot_path) if shot_path.exists() else ""

PROBLEMS = [
    ("01", "Drops turn into an email negotiation"),
    ("02", "Pickups are a group chat lottery"),
    ("03", "Picked up, then forgotten"),
    ("04", "Floating runs on email and trust"),
    ("05", "Paged for what experience already answers"),
    ("06", "The pages that matter arrive incomplete"),
    ("07", "Schedules are built by hand"),
]

chips = "\n".join(
    f"""          <li class="chip{' is-centerpiece' if n == '04' else ''}">
            <span class="chip-num">{n}</span>
            <span class="chip-text">{t}</span>
          </li>"""
    for n, t in PROBLEMS
)

html = f"""<title>Shift@PennHousing. RSM deck, visual system v1 baseline</title>
<style>
  @font-face {{ font-family:"Plex Sans"; src:url(data:font/ttf;base64,{sans_regular}) format("truetype"); font-weight:400; font-display:block; }}
  @font-face {{ font-family:"Plex Sans"; src:url(data:font/ttf;base64,{sans_semibold}) format("truetype"); font-weight:600; font-display:block; }}
  @font-face {{ font-family:"Plex Mono"; src:url(data:font/ttf;base64,{mono_regular}) format("truetype"); font-weight:400; font-display:block; }}

  :root {{
    --paper:#ffffff; --ink:#1a1d21; --brand:#0061fc; --brand-deep:#00379e;
    --pale-blue:#eaf1ff; --slate:#5b6572; --rule:#e3e6ea; --warn:#8a8478;
    --chrome-bg:#eceae4; --chrome-fg:#4a443c; --chrome-muted:#7d766c; --chrome-rule:#d8d4cb;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{ --chrome-bg:#1b1815; --chrome-fg:#ded8cf; --chrome-muted:#8d857a; --chrome-rule:#332e28; }}
  }}
  :root[data-theme="dark"] {{ --chrome-bg:#1b1815; --chrome-fg:#ded8cf; --chrome-muted:#8d857a; --chrome-rule:#332e28; }}
  :root[data-theme="light"] {{ --chrome-bg:#eceae4; --chrome-fg:#4a443c; --chrome-muted:#7d766c; --chrome-rule:#d8d4cb; }}

  * {{ box-sizing:border-box; }}
  body {{
    margin:0; background:var(--chrome-bg); color:var(--chrome-fg);
    font-family:"Plex Sans",ui-sans-serif,system-ui,sans-serif;
    display:flex; flex-direction:column; align-items:center; gap:18px;
    padding:36px 20px 60px;
  }}
  .page-label {{
    font-family:"Plex Mono",ui-monospace,monospace; font-size:12px; letter-spacing:.16em;
    text-transform:uppercase; color:var(--chrome-muted); text-align:center; margin:22px 0 0;
  }}
  .slide-frame {{
    width:min(100%,1280px); aspect-ratio:16/9; container-type:size;
    border-radius:4px; overflow:hidden; box-shadow:0 16px 44px rgba(20,16,12,.2);
  }}
  .slide {{ width:100%; height:100%; background:var(--paper); padding:5.2cqw 5.8cqw; display:flex; flex-direction:column; }}

  .eyebrow {{
    font-family:"Plex Mono",ui-monospace,monospace; font-size:1.02cqw; letter-spacing:.14em;
    text-transform:uppercase; color:var(--slate); margin:0 0 1.1cqw;
  }}
  h1 {{ font-size:3.5cqw; font-weight:600; line-height:1.1; letter-spacing:-.015em; color:var(--ink); margin:0; text-wrap:balance; }}
  .dek {{ margin:1.1cqw 0 0; font-size:1.32cqw; line-height:1.5; color:var(--slate); max-width:62cqw; }}

  /* ---------- Template A: stacked chip grid ---------- */
  .grid {{ list-style:none; margin:3cqw 0 0; padding:0; display:grid; grid-template-columns:repeat(4,1fr); gap:1.1cqw; }}
  .chip {{
    border:1px solid var(--rule); border-radius:.65cqw; background:var(--paper);
    padding:1.4cqw 1.5cqw 1.6cqw; display:flex; flex-direction:column; gap:.75cqw; min-height:7.2cqw;
  }}
  .chip-num {{ font-family:"Plex Mono",ui-monospace,monospace; font-size:.92cqw; letter-spacing:.1em; color:var(--brand-deep); }}
  .chip-text {{ font-size:1.3cqw; line-height:1.34; color:var(--ink); }}
  .chip.is-centerpiece {{ background:var(--pale-blue); border-color:transparent; }}
  .chip.is-centerpiece .chip-num {{ color:var(--brand); }}
  .punchline {{ margin-top:1.3cqw; display:flex; align-items:baseline; gap:.7cqw; padding-top:1.3cqw; border-top:1px solid var(--rule); }}
  .punchline .bar {{ width:.34cqw; align-self:stretch; background:var(--brand); border-radius:2px; flex:none; }}
  .punchline p {{ margin:0; font-size:1.5cqw; font-weight:600; color:var(--ink); }}

  /* ---------- Template C: verbatim artifact panel ---------- */
  .artifact {{
    margin-top:2.4cqw; border:1px solid var(--rule); border-radius:.8cqw;
    padding:2cqw 2.2cqw; background:#fcfdff; max-width:74cqw;
  }}
  .artifact .meta {{
    font-family:"Plex Mono",ui-monospace,monospace; font-size:.98cqw; letter-spacing:.06em;
    color:var(--slate); margin:0 0 1.1cqw;
  }}
  .artifact .body {{ font-size:1.42cqw; line-height:1.62; color:var(--ink); margin:0; }}
  .artifact .body em {{ font-style:normal; background:var(--pale-blue); box-shadow:0 0 0 .25cqw var(--pale-blue); color:var(--brand-deep); font-weight:600; }}
  .reaction {{ margin-top:2cqw; font-size:1.44cqw; font-weight:600; color:var(--ink); display:flex; gap:.7cqw; align-items:baseline; }}
  .reaction .bar {{ width:.34cqw; align-self:stretch; background:var(--brand); border-radius:2px; flex:none; }}

  /* ---------- Hero stat ---------- */
  .stat-row {{ display:flex; align-items:flex-end; gap:3.4cqw; margin-top:2.6cqw; }}
  .stat {{ flex:none; }}
  .stat .num {{ font-size:7.6cqw; font-weight:600; line-height:.92; letter-spacing:-.03em; color:var(--brand); font-variant-numeric:tabular-nums; }}
  .stat .cap {{ font-family:"Plex Mono",ui-monospace,monospace; font-size:.98cqw; letter-spacing:.12em; text-transform:uppercase; color:var(--slate); margin-top:.9cqw; }}
  .timeline {{ flex:1; border-left:1px solid var(--rule); padding-left:3cqw; display:flex; flex-direction:column; gap:1.15cqw; }}
  .tl-row {{ display:flex; gap:1.2cqw; align-items:baseline; }}
  .tl-time {{ font-family:"Plex Mono",ui-monospace,monospace; font-size:1.12cqw; color:var(--warn); flex:none; width:7cqw; }}
  .tl-text {{ font-size:1.24cqw; line-height:1.4; color:var(--ink); }}
  .tl-row.is-gap .tl-time,.tl-row.is-gap .tl-text {{ color:var(--slate); font-style:italic; }}

  /* ---------- Template B: split ---------- */
  .slide.split {{ flex-direction:row; align-items:center; gap:4.5cqw; }}
  .split .text-col {{ flex:0 0 44%; display:flex; flex-direction:column; }}
  .split .text-col .dek {{ max-width:none; }}
  .split .visual-col {{ flex:1; display:flex; align-items:center; justify-content:center; height:100%; }}
  .phone {{ height:84cqh; border-radius:2.2cqw; overflow:hidden; border:1px solid var(--rule); background:#000; }}
  .phone img {{ height:100%; width:auto; display:block; }}
  .feature-list {{ list-style:none; margin:2cqw 0 0; padding:0; display:flex; flex-direction:column; gap:1.05cqw; }}
  .feature-list li {{ display:flex; gap:.9cqw; align-items:baseline; font-size:1.24cqw; line-height:1.4; color:var(--ink); }}
  .feature-list .tick {{ color:var(--brand); font-weight:600; flex:none; }}

  .caption {{ max-width:660px; font-size:13.5px; line-height:1.6; color:var(--chrome-muted); border-top:1px solid var(--chrome-rule); padding-top:16px; }}
  .caption strong {{ color:var(--chrome-fg); font-weight:600; }}
</style>

<p class="page-label">Visual system v1 &nbsp;/&nbsp; baseline &nbsp;/&nbsp; 4 representative slides</p>

<!-- ============ SLIDE 4. Template A, stacked chip grid ============ -->
<p class="page-label">Slide 4 &nbsp;/&nbsp; Template A, stacked</p>
<div class="slide-frame">
  <div class="slide">
    <p class="eyebrow">The problem</p>
    <h1>Seven things that go wrong today</h1>
    <p class="dek">Every one of these still runs on an inbox, a group chat, or someone's memory.</p>
    <ul class="grid">
{chips}
    </ul>
    <div class="punchline"><span class="bar"></span><p>Seven problems. One cause. Stop me on any of them.</p></div>
  </div>
</div>

<!-- ============ SLIDE 13. Template C, verbatim artifact ============ -->
<p class="page-label">Slide 13 &nbsp;/&nbsp; Template C, verbatim artifact</p>
<div class="slide-frame">
  <div class="slide">
    <p class="eyebrow">Picking up a shift</p>
    <h1>I claimed a shift. It was already gone.</h1>
    <div class="artifact">
      <p class="meta">Direct message &nbsp;&middot;&nbsp; from a Harrison student manager &nbsp;&middot;&nbsp; 3:32 PM</p>
      <p class="body">Hi Andrew, this is Adailia from Harrison! I made an error on my end and listed Mon 5-9pm as an available shift, <em>it was taken by someone else prior</em>. My apologies for that, but please let me know if you'd like any of the remaining shifts in the main gc!</p>
    </div>
    <div class="reaction"><span class="bar"></span><span>The shifts are not unfillable. People have learned not to bother.</span></div>
  </div>
</div>

<!-- ============ SLIDE 23. Hero stat + timeline ============ -->
<p class="page-label">Slide 23 &nbsp;/&nbsp; hero stat</p>
<div class="slide-frame">
  <div class="slide">
    <p class="eyebrow">Floating &nbsp;&middot;&nbsp; failure 3</p>
    <h1>Nobody knows if the floater is coming</h1>
    <div class="stat-row">
      <div class="stat">
        <div class="num">5h45m</div>
        <div class="cap">to confirm one hour of cover</div>
      </div>
      <div class="timeline">
        <div class="tl-row"><span class="tl-time">3:20 PM</span><span class="tl-text">The float request goes out by email.</span></div>
        <div class="tl-row is-gap"><span class="tl-time">&hellip;</span><span class="tl-text">No reply. No status anywhere. Nobody can tell whether the desk is covered.</span></div>
        <div class="tl-row"><span class="tl-time">9:05 PM</span><span class="tl-text">The worker replies to acknowledge.</span></div>
      </div>
    </div>
    <div class="punchline"><span class="bar"></span><p>Real dates, one of my own floats to Mayer Hall.</p></div>
  </div>
</div>

<!-- ============ SLIDE 24. Template B, split with real screenshot ============ -->
<p class="page-label">Slide 24 &nbsp;/&nbsp; Template B, split with real app screenshot</p>
<div class="slide-frame">
  <div class="slide split">
    <div class="text-col">
      <p class="eyebrow">What happens now</p>
      <h1>The float finds them, and answers back</h1>
      <p class="dek">No email to miss. It arrives as a notification and a card they cannot scroll past.</p>
      <ul class="feature-list">
        <li><span class="tick">&#10003;</span><span>Accept or decline with one tap.</span></li>
        <li><span class="tick">&#10003;</span><span>A visible deadline, counting down.</span></li>
        <li><span class="tick">&#10003;</span><span>Reminders at 6h, 2h, 1h, 30m, and 5m.</span></li>
        <li><span class="tick">&#10003;</span><span>You see who has answered, at a glance.</span></li>
      </ul>
    </div>
    <div class="visual-col">
      <div class="phone"><img src="data:image/png;base64,{float_shot}" alt="The float request card in the app, showing Accept and Decline buttons and a countdown to the acknowledgment deadline."></div>
    </div>
  </div>
</div>

<div class="caption">
  <strong>This is visual system v1, the revert point.</strong>
  Regenerate any time with <code>python3 docs/pitch/deck/build_v1_baseline.py</code>.
  White ground, one accent (brand blue), warm gray for problem states, IBM Plex Sans and Mono,
  two layout structures (stacked and split). The phone screenshot is a real capture from the
  iOS Simulator, unretouched.
</div>
"""

OUT.write_text(html, encoding="utf-8")
print(f"wrote {OUT} ({OUT.stat().st_size/1024:.0f} KB)")
