// Shift@PennHousing. RSM presentation, native PPTX.
//
// Mirrors rsm-deck.html / rsm-deck-print.html exactly: same 40 slides, same
// order, same copy, same v1 palette. Built with pptxgenjs so every slide is
// natively editable (real text boxes, not a flattened image), which is what
// Canva's PDF import was failing to preserve.
//
// Palette: white ground, near-black ink, ONE accent (brand blue), warm gray
// for "today"/problem states, pale blue for section dividers and callouts.
// Fonts: Calibri (safe-list sans, closest quiet pairing to Plex Sans) for
// body/headlines, Courier New (safe-list mono) for eyebrows/times/verbatim
// text, matching the mono treatment in the HTML deck.
//
// Usage: node build_pptx.js   ->  writes rsm-deck.pptx

const pptxgen = require('pptxgenjs');
const path = require('path');

const ASSETS = path.join(__dirname, 'assets');
const IMG = {
  myshifts: path.join(ASSETS, 'shot-s-myshifts.png'),
  open: path.join(ASSETS, 'shot-s-open.png'),
  house: path.join(ASSETS, 'shot-s-house.png'),
  assistant: path.join(ASSETS, 'shot-s-assistant.png'),
};

// ---------------------------------------------------------------------
// Palette (hex, no #, matching build_deck.py's CSS custom properties)
// ---------------------------------------------------------------------
const C = {
  paper: 'FFFFFF',
  ink: '1A1D21',
  brand: '0061FC',
  brandDeep: '00379E',
  pale: 'EAF1FF',
  slate: '5B6572',
  rule: 'E3E6EA',
  warn: '8A8478',
};

const SANS = 'Calibri';
const MONO = 'Courier New';

// Slide is 13.333 x 7.5in (widescreen), matching the HTML deck's @page size.
const PW = 13.333;
const PH = 7.5;
const MX = 0.72; // left/right margin, ~ the HTML deck's 5.8cqw
const MT = 0.66; // top margin, ~ the HTML deck's 5.2cqw

let pres = new pptxgen();
pres.defineLayout({ name: 'SHIFT_16x9', width: PW, height: PH });
pres.layout = 'SHIFT_16x9';

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function newSlide(bg) {
  const s = pres.addSlide();
  s.background = { color: bg || C.paper };
  return s;
}

// Eyebrow + headline + optional dek. Returns the y-cursor just below the block.
function head(s, eyebrow, h1, dek, opts) {
  opts = opts || {};
  const x = opts.x !== undefined ? opts.x : MX;
  const w = opts.w !== undefined ? opts.w : PW - x - MX;
  let y = opts.y !== undefined ? opts.y : MT;

  s.addText(eyebrow.toUpperCase(), {
    x,
    y,
    w,
    h: 0.3,
    fontFace: MONO,
    fontSize: 11,
    color: C.slate,
    charSpacing: 2,
    margin: 0,
  });
  y += 0.34;

  const titleSize = opts.titleSize || 30;
  const titleH = opts.titleH || (h1.length > 40 ? 1.05 : 0.6);
  s.addText(h1, {
    x,
    y,
    w,
    h: titleH,
    fontFace: SANS,
    fontSize: titleSize,
    bold: true,
    color: C.ink,
    margin: 0,
    valign: 'top',
  });
  y += titleH + 0.08;

  if (dek) {
    s.addText(dek, {
      x,
      y,
      w: opts.dekW || w * 0.72,
      h: 0.6,
      fontFace: SANS,
      fontSize: 13.5,
      color: C.slate,
      margin: 0,
      valign: 'top',
      lineSpacingMultiple: 1.25,
    });
    y += 0.62;
  }
  return y;
}

// Bottom punchline: thin blue rule + bold sentence, pinned near the bottom.
function punch(s, text, yFromBottom) {
  const y = PH - (yFromBottom || 1.05);
  s.addShape('rect', {
    x: MX,
    y,
    w: 0.04,
    h: 0.4,
    fill: { color: C.brand },
    line: { type: 'none' },
  });
  s.addText(text, {
    x: MX + 0.16,
    y: y - 0.05,
    w: PW - 2 * MX - 0.16,
    h: 0.5,
    fontFace: SANS,
    fontSize: 15,
    bold: true,
    color: C.ink,
    margin: 0,
    valign: 'middle',
  });
  s.addShape('line', {
    x: MX,
    y: y - 0.14,
    w: PW - 2 * MX,
    h: 0,
    line: { color: C.rule, width: 0.75 },
  });
}

// Progress rail, bottom-left. active = 1..7
function rail(s, active) {
  const y = PH - 0.5;
  s.addText(`PROBLEM ${active} OF 7`, {
    x: MX,
    y,
    w: 1.9,
    h: 0.3,
    fontFace: MONO,
    fontSize: 9,
    color: C.slate,
    charSpacing: 1.4,
    margin: 0,
    valign: 'middle',
  });
  let dx = MX + 1.75;
  for (let i = 1; i <= 7; i++) {
    const on = i === active;
    const done = i < active;
    s.addShape('rect', {
      x: dx,
      y: y + 0.11,
      w: on ? 0.16 : 0.06,
      h: 0.06,
      rectRadius: 0.03,
      fill: { color: on ? C.brand : done ? 'A9B2BD' : 'D8DCE2' },
      line: { type: 'none' },
    });
    dx += on ? 0.22 : 0.13;
  }
}

function pagenum(s, n) {
  s.addText(String(n), {
    x: PW - 0.9,
    y: PH - 0.42,
    w: 0.7,
    h: 0.3,
    fontFace: MONO,
    fontSize: 9,
    color: 'C2C7CF',
    align: 'right',
    margin: 0,
  });
}

function features(s, items, x, y, w) {
  items.forEach((t, i) => {
    const iy = y + i * 0.42;
    s.addText('✓', {
      x,
      y: iy,
      w: 0.3,
      h: 0.36,
      fontFace: SANS,
      fontSize: 14,
      bold: true,
      color: C.brand,
      margin: 0,
      valign: 'top',
    });
    s.addText(t, {
      x: x + 0.32,
      y: iy,
      w: w - 0.32,
      h: 0.4,
      fontFace: SANS,
      fontSize: 13.5,
      color: C.ink,
      margin: 0,
      valign: 'top',
      lineSpacingMultiple: 1.15,
    });
  });
  return y + items.length * 0.42;
}

function callout(s, key, text, y, opts) {
  opts = opts || {};
  const x = opts.x !== undefined ? opts.x : MX;
  const w = opts.w !== undefined ? opts.w : PW - 2 * MX;
  const h = opts.h || 1.15;
  s.addShape('roundRect', {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    fill: { color: C.pale },
    line: { type: 'none' },
  });
  s.addText(key.toUpperCase(), {
    x: x + 0.22,
    y: y + 0.14,
    w: w - 0.44,
    h: 0.24,
    fontFace: MONO,
    fontSize: 9.5,
    color: C.brand,
    charSpacing: 1.4,
    margin: 0,
  });
  s.addText(text, {
    x: x + 0.22,
    y: y + 0.42,
    w: w - 0.44,
    h: h - 0.55,
    fontFace: SANS,
    fontSize: 12.5,
    color: '22303F',
    margin: 0,
    valign: 'top',
    lineSpacingMultiple: 1.22,
  });
  return y + h;
}

// Verbatim artifact panel. `runs` = pptxgenjs text-run array for rich text
// (used to render the highlighted/emphasized fragment inline).
function artifact(s, meta, runs, y, opts) {
  opts = opts || {};
  const x = opts.x !== undefined ? opts.x : MX;
  const w = opts.w !== undefined ? opts.w : PW - 2 * MX;
  const h = opts.h || 2.3;
  s.addShape('roundRect', {
    x,
    y,
    w,
    h,
    rectRadius: 0.07,
    fill: { color: 'FCFDFF' },
    line: { color: C.rule, width: 1 },
  });
  s.addText(meta, {
    x: x + 0.28,
    y: y + 0.18,
    w: w - 0.56,
    h: 0.26,
    fontFace: MONO,
    fontSize: 10,
    color: C.slate,
    margin: 0,
  });
  s.addText(runs, {
    x: x + 0.28,
    y: y + 0.5,
    w: w - 0.56,
    h: h - 0.7,
    fontFace: SANS,
    fontSize: 13,
    color: C.ink,
    margin: 0,
    valign: 'top',
    lineSpacingMultiple: 1.3,
  });
  return y + h;
}

function em(text) {
  return { text, options: { bold: true, color: C.brandDeep, highlight: C.pale } };
}
function plain(text) {
  return { text, options: {} };
}

function phoneImage(s, key, x, y, h) {
  const sharp = require('sharp');
  // pptxgenjs needs explicit w/h; read intrinsic size to keep aspect ratio.
  return sharp(IMG[key])
    .metadata()
    .then((meta) => {
      const ar = meta.width / meta.height;
      const w = h * ar;
      s.addImage({
        path: IMG[key],
        x,
        y,
        w,
        h,
        rounding: false,
      });
      return { x, y, w, h };
    });
}

function divider(s, eyebrowText, h1, dek, n, active) {
  s.background = { color: C.pale };
  s.addText(eyebrowText.toUpperCase(), {
    x: MX,
    y: 2.55,
    w: PW - 2 * MX,
    h: 0.3,
    fontFace: MONO,
    fontSize: 11,
    color: C.slate,
    charSpacing: 2,
    margin: 0,
  });
  s.addText(h1, {
    x: MX,
    y: 2.9,
    w: PW - 2 * MX - 2,
    h: 1.3,
    fontFace: SANS,
    fontSize: 34,
    bold: true,
    color: C.ink,
    margin: 0,
    valign: 'top',
  });
  s.addText(dek, {
    x: MX,
    y: 4.15,
    w: 8.6,
    h: 0.6,
    fontFace: SANS,
    fontSize: 14.5,
    color: '41505F',
    margin: 0,
    valign: 'top',
    lineSpacingMultiple: 1.3,
  });
  rail(s, active);
  pagenum(s, n);
}

// Chain of steps (today / gap / fix), stacked rows.
function chain(s, rows, y, opts) {
  opts = opts || {};
  const x = opts.x !== undefined ? opts.x : MX;
  const w = opts.w !== undefined ? opts.w : PW - 2 * MX;
  const rowH = 0.5;
  rows.forEach(([kind, label, text], i) => {
    const ry = y + i * (rowH + 0.1);
    if (kind === 'fix') {
      s.addShape('roundRect', {
        x,
        y: ry,
        w,
        h: rowH,
        rectRadius: 0.06,
        fill: { color: C.pale },
        line: { type: 'none' },
      });
    } else if (kind !== 'gap') {
      s.addShape('roundRect', {
        x,
        y: ry,
        w,
        h: rowH,
        rectRadius: 0.06,
        fill: { type: 'none' },
        line: { color: C.rule, width: 1 },
      });
    }
    const numColor = kind === 'fix' ? C.brand : C.warn;
    const textColor = kind === 'fix' ? C.ink : kind === 'gap' ? C.slate : '4A5260';
    s.addText(label, {
      x: x + 0.2,
      y: ry,
      w: 0.4,
      h: rowH,
      fontFace: MONO,
      fontSize: 11,
      color: numColor,
      valign: 'middle',
      margin: 0,
    });
    s.addText(text, {
      x: x + 0.65,
      y: ry,
      w: w - 0.85,
      h: rowH,
      fontFace: SANS,
      fontSize: 12.5,
      italic: kind === 'gap',
      bold: kind === 'fix',
      color: textColor,
      valign: 'middle',
      margin: 0,
    });
  });
  return y + rows.length * (rowH + 0.1);
}

function twoBranch(s, left, right, y, opts) {
  opts = opts || {};
  const x = opts.x !== undefined ? opts.x : MX;
  const w = opts.w !== undefined ? opts.w : PW - 2 * MX;
  const h = opts.h || 2.0;
  const gap = 0.28;
  const colW = (w - gap) / 2;
  [
    [left, x, false],
    [right, x + colW + gap, true],
  ].forEach(([b, bx, isRight]) => {
    const bad = b.bad,
      good = b.good;
    s.addShape('roundRect', {
      x: bx,
      y,
      w: colW,
      h,
      rectRadius: 0.07,
      fill: { color: good ? C.pale : bad ? 'FBFAF9' : C.paper },
      line: { color: good ? C.pale : C.rule, width: good ? 0 : 1 },
    });
    s.addText(b.head.toUpperCase(), {
      x: bx + 0.24,
      y: y + 0.2,
      w: colW - 0.48,
      h: 0.28,
      fontFace: MONO,
      fontSize: 9.5,
      charSpacing: 1.2,
      color: good ? C.brand : C.slate,
      margin: 0,
    });
    s.addText(b.body, {
      x: bx + 0.24,
      y: y + 0.55,
      w: colW - 0.48,
      h: h - 0.75,
      fontFace: SANS,
      fontSize: 12.5,
      color: bad ? C.warn : C.ink,
      margin: 0,
      valign: 'top',
      lineSpacingMultiple: 1.25,
    });
  });
  return y + h;
}

// ---------------------------------------------------------------------
// ACT 0. OPEN
// ---------------------------------------------------------------------

(async () => {
  // Slide 1: Title
  {
    const s = newSlide();
    s.addText('PENN RESIDENTIAL SERVICES', {
      x: MX,
      y: 2.55,
      w: 8,
      h: 0.3,
      fontFace: MONO,
      fontSize: 11.5,
      color: C.slate,
      charSpacing: 2,
      margin: 0,
    });
    s.addText('Shift', {
      x: MX,
      y: 2.85,
      w: 8,
      h: 1.3,
      fontFace: SANS,
      fontSize: 92,
      bold: true,
      color: C.ink,
      margin: 0,
      valign: 'top',
      charSpacing: -2,
    });
    s.addText('One app for desk staffing across all 13 houses.', {
      x: MX,
      y: 4.25,
      w: 7.5,
      h: 0.5,
      fontFace: SANS,
      fontSize: 17,
      color: C.ink,
      margin: 0,
    });
    s.addText(
      [
        { text: 'ANDREW CHELIMO', options: {} },
        { text: '     |     ', options: { color: C.rule } },
        { text: 'HARNWELL COLLEGE HOUSE', options: {} },
      ],
      {
        x: MX,
        y: 4.95,
        w: 8,
        h: 0.3,
        fontFace: MONO,
        fontSize: 10,
        color: C.slate,
        charSpacing: 1.2,
        margin: 0,
      },
    );
    pagenum(s, 1);
  }

  // Slide 2
  {
    const s = newSlide();
    head(
      s,
      'What it is',
      'One live schedule that fills its own empty desks',
      'Every house shares it. It updates the moment anything changes, it reminds people so shifts are not forgotten, and it finds coverage before a desk goes empty.',
    );
    punch(s, 'No more inbox. No more spreadsheet. No more group chat lottery.');
    pagenum(s, 2);
  }

  // Slide 3
  {
    const s = newSlide();
    head(
      s,
      'Why I built it',
      'I work these desks',
      'I have dropped shifts, picked them up, floated to other houses, and watched the same handful of failures repeat every single week.',
    );
    punch(s, 'This is not a product looking for a problem. It is our problem, solved.');
    pagenum(s, 3);
  }

  // ---------------------------------------------------------------------
  // ACT 1. THE WHOLE PROBLEM
  // ---------------------------------------------------------------------

  // Slide 4: Problem grid
  {
    const s = newSlide();
    head(
      s,
      'The problem',
      'Seven things that go wrong today',
      "Every one of these still runs on an inbox, a group chat, or someone's memory.",
    );
    const PROBLEMS = [
      ['01', 'Drops turn into an email negotiation'],
      ['02', 'Pickups are a group chat lottery'],
      ['03', 'Picked up, then forgotten'],
      ['04', 'Floating runs on email and trust'],
      ['05', 'Paged for what experience already answers'],
      ['06', 'The pages that matter arrive incomplete'],
      ['07', 'Schedules are built by hand'],
    ];
    const cols = 4,
      cw = (PW - 2 * MX - 3 * 0.18) / cols,
      ch = 1.15,
      gy = 2.55;
    PROBLEMS.forEach(([num, text], i) => {
      const col = i % cols,
        row = Math.floor(i / cols);
      const x = MX + col * (cw + 0.18);
      const y = gy + row * (ch + 0.18);
      const isCenter = num === '04';
      s.addShape('roundRect', {
        x,
        y,
        w: cw,
        h: ch,
        rectRadius: 0.06,
        fill: { color: isCenter ? C.pale : C.paper },
        line: { color: isCenter ? C.pale : C.rule, width: isCenter ? 0 : 1 },
      });
      s.addText(num, {
        x: x + 0.16,
        y: y + 0.14,
        w: cw - 0.3,
        h: 0.22,
        fontFace: MONO,
        fontSize: 10,
        color: isCenter ? C.brand : C.brandDeep,
        margin: 0,
      });
      s.addText(text, {
        x: x + 0.16,
        y: y + 0.4,
        w: cw - 0.32,
        h: ch - 0.5,
        fontFace: SANS,
        fontSize: 11.5,
        color: C.ink,
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.15,
      });
    });
    punch(s, 'Seven problems. One cause. Stop me on any of them.');
    pagenum(s, 4);
  }

  // Slide 5: big statement
  {
    const s = newSlide();
    head(s, 'The cause', 'There is no system');
    s.addText(
      [
        plain('There are people, inboxes, a group chat, and memory. Everything that follows is '),
        em('one fix applied seven times'),
        plain(': put the truth in one place, and make it reach the person who needs it.'),
      ],
      {
        x: MX,
        y: 2.7,
        w: 9.6,
        h: 1.8,
        fontFace: SANS,
        fontSize: 21,
        color: C.ink,
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.35,
      },
    );
    pagenum(s, 5);
  }

  // Slide 6: toolkit
  {
    const s = newSlide();
    head(
      s,
      "Today's toolkit",
      'Four tools, none of them talking',
      'None of them is live. None of them reminds anyone. The manager is the glue holding it together.',
    );
    const TOOLS = [
      [
        'Email',
        'Drops, swaps, float requests, hours paperwork',
        "Easy to miss. Never a live picture. Everyone is cc'd, nobody is responsible.",
      ],
      [
        'Excel',
        'Building and holding the schedule',
        'Stale the moment anything changes. Reminds no one of anything.',
      ],
      [
        'GroupMe',
        'Cross-house pickups, last-minute cover',
        'Buried in replies. First come first served. No record.',
      ],
      [
        'Phone',
        'Confirming who is actually coming',
        'Only works if you have the number and they answer.',
      ],
    ];
    const cw = (PW - 2 * MX - 3 * 0.3) / 4;
    TOOLS.forEach(([name, use, fail], i) => {
      const x = MX + i * (cw + 0.3);
      const y = 2.65;
      s.addShape('line', { x, y, w: cw, h: 0, line: { color: C.ink, width: 1.5 } });
      s.addText(name, {
        x,
        y: y + 0.12,
        w: cw,
        h: 0.35,
        fontFace: SANS,
        fontSize: 17,
        bold: true,
        color: C.ink,
        margin: 0,
      });
      s.addText(use, {
        x,
        y: y + 0.55,
        w: cw,
        h: 0.6,
        fontFace: SANS,
        fontSize: 11,
        color: C.ink,
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.2,
      });
      s.addText(fail, {
        x,
        y: y + 1.2,
        w: cw,
        h: 0.9,
        fontFace: SANS,
        fontSize: 11,
        color: C.warn,
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.25,
      });
    });
    pagenum(s, 6);
  }

  // ---------------------------------------------------------------------
  // PROBLEM 1. DROPPING A SHIFT
  // ---------------------------------------------------------------------

  {
    const s = newSlide();
    divider(
      s,
      'Problem 01',
      'Drops turn into an email negotiation',
      'A worker cannot make a shift. What happens next depends on who reads the email first.',
      7,
      1,
    );
  }

  {
    const s = newSlide();
    head(s, 'Dropping a shift', 'Where the authority runs out');
    twoBranch(
      s,
      {
        head: 'The desk still has someone',
        body: 'The student manager can approve it and edit the sheet. This case is fine.',
        bad: false,
      },
      {
        head: 'The desk would be empty',
        body: 'The student manager can see it and can do nothing about it. It comes to you. You fill the desk yourself, or you pay for outside coverage.',
        bad: true,
      },
      2.55,
      { h: 2.0 },
    );
    punch(s, 'The person closest to the problem is the one who cannot solve it.');
    rail(s, 1);
    pagenum(s, 8);
  }

  {
    const s = newSlide();
    head(
      s,
      'Dropping a shift, after hours',
      'One drop, four communications',
      'Three of them exist only because the first one might not be read in time.',
    );
    chain(
      s,
      [
        ['today', '01', 'Email the student manager and the RSM.'],
        ['today', '02', 'Call the desk anyway, because email is not fast enough.'],
        ['today', '03', 'If you are not at Harnwell, call Harnwell too.'],
        ['today', '04', 'Harnwell pages the manager on duty.'],
      ],
      2.75,
    );
    punch(s, 'Every step is a person compensating for a system that cannot tell anyone anything.');
    rail(s, 1);
    pagenum(s, 9);
  }

  {
    const s = newSlide();
    head(s, 'What happens now', 'Drop it in the app. That is the whole process.');
    const y2 = features(
      s,
      [
        'The seat reopens instantly, visible to everyone who could fill it.',
        'Swaps and handoffs are agreed between the two workers, with no manager in the middle.',
        'The system checks whether the desk would actually be empty.',
        'It only goes looking for coverage when it truly would be.',
      ],
      MX,
      2.6,
      9.6,
    );
    callout(
      s,
      'The quiet part',
      'A Harnwell desk dropping from two workers to one is still covered, so nobody is paged. The system stays silent until a desk would have nobody on it.',
      5.75,
      { h: 1.05 },
    );
    rail(s, 1);
    pagenum(s, 10);
  }

  // ---------------------------------------------------------------------
  // PROBLEM 2. PICKING UP ACROSS HOUSES
  // ---------------------------------------------------------------------

  {
    const s = newSlide();
    divider(
      s,
      'Problem 02',
      'Pickups are a group chat lottery',
      'This is the one where the current process actively teaches people to stop trying.',
      11,
      2,
    );
  }

  {
    const s = newSlide();
    head(s, 'How a shift gets offered today', 'The entire mechanism is one message');
    artifact(
      s,
      'Summer IC Workers group chat  ·  11:25 AM',
      [
        plain(
          "Hi everyone! The following shifts are available at Rodin this week and for the week of 7/27 to 8/2. If you're interested please send me ",
        ),
        em('your name, phone number, email, and the IC you work at'),
        plain(
          '. Please ensure you specify the dates and times of the shift you pick up and make sure you are not exceeding 40 hours.\n\n',
        ),
        plain('Wednesday 7/22   5pm to 8pm\n'),
        plain('Sunday 7/26   5:30am to 8am  (NO COVERAGE)   8am to 12pm\n'),
        plain('Monday 7/27   4pm to 8pm\n'),
        plain('Tuesday 7/28   8am to 12pm  (NO COVERAGE)   12pm to 4pm\n'),
        plain('Thursday 7/30   4pm to 8pm  (NO COVERAGE)\n'),
        plain('Friday 7/31   4pm to 8pm\n'),
        plain('Saturday 8/1   5:30am to 8am   8am to 12pm   12pm to 4pm   8pm to 12am'),
      ],
      2.55,
      { h: 3.85 },
    );
    punch(s, 'To claim one three-hour block, you file a small application.');
    rail(s, 2);
    pagenum(s, 12);
  }

  {
    const s = newSlide();
    head(
      s,
      'What happens underneath it',
      'The claims land in the replies, not in the list',
      'Five people, five different slots, each acknowledged with a thumbs up. Nothing marks the original message as out of date.',
    );
    const replies = [
      ['Grace', "I'll take Friday 7/31 4pm to 8pm"],
      ['Jamia', 'i can pick up saturday 12-4pm'],
      ['Grace', 'Sunday 8/2 8pm-12am too'],
      ['Sunny', 'I can do 8/1 8am-12pm'],
      ['Joy', 'Ik can do Monday 4-8'],
    ];
    let ry = 2.95;
    replies.forEach(([who, what]) => {
      s.addShape('roundRect', {
        x: MX,
        y: ry,
        w: 8.7,
        h: 0.42,
        rectRadius: 0.05,
        fill: { type: 'none' },
        line: { color: C.rule, width: 1 },
      });
      s.addText(who, {
        x: MX + 0.18,
        y: ry,
        w: 1.0,
        h: 0.42,
        fontFace: MONO,
        fontSize: 10.5,
        color: C.slate,
        valign: 'middle',
        margin: 0,
      });
      s.addText(what, {
        x: MX + 1.2,
        y: ry,
        w: 6.8,
        h: 0.42,
        fontFace: SANS,
        fontSize: 12.5,
        color: C.ink,
        valign: 'middle',
        margin: 0,
      });
      s.addText('👍', {
        x: MX + 8.0,
        y: ry,
        w: 0.5,
        h: 0.42,
        fontSize: 12,
        valign: 'middle',
        margin: 0,
      });
      ry += 0.5;
    });
    punch(s, 'A sixth person cannot tell what is left without reading every reply.');
    rail(s, 2);
    pagenum(s, 13);
  }

  {
    const s = newSlide();
    head(s, 'Picking up a shift', 'I claimed a shift. It was already gone.');
    artifact(
      s,
      'Direct message  ·  from a Harrison student manager  ·  3:32 PM',
      [
        plain(
          'Hi Andrew, this is Adailia from Harrison! I made an error on my end and listed Mon 5-9pm as an available shift, ',
        ),
        em('it was taken by someone else prior'),
        plain(
          ". My apologies for that, but please let me know if you'd like any of the remaining shifts in the main gc!",
        ),
      ],
      2.55,
      { h: 1.7, w: 9.6 },
    );
    punch(s, 'The shifts are not unfillable. People have learned not to bother.');
    rail(s, 2);
    pagenum(s, 14);
  }

  {
    const s = newSlide();
    head(s, 'What happens now', 'One feed. Claimed means gone.', null, { w: 5.4 });
    const y2 = features(
      s,
      [
        'Your house and every other house, in one list.',
        'Claim with one tap. It disappears for everyone.',
        'Take part of a shift, not just all of it.',
        'No name, phone, or email. It knows who you are.',
      ],
      MX,
      2.75,
      5.1,
    );
    await phoneImage(s, 'open', 8.55, 0.55, 6.4);
    rail(s, 2);
    pagenum(s, 15);
  }

  // ---------------------------------------------------------------------
  // PROBLEM 3. FORGOTTEN SHIFTS
  // ---------------------------------------------------------------------

  {
    const s = newSlide();
    divider(
      s,
      'Problem 03',
      'Picked up, then forgotten',
      'The most common way a desk ends up empty is not malice. It is memory.',
      16,
      3,
    );
  }

  {
    const s = newSlide();
    head(s, 'Why it happens', 'The shift lives nowhere');
    chain(
      s,
      [
        ['today', '01', 'You agree to a shift in a group chat or an email.'],
        ['today', '02', 'Now you have to remember to add it to your own calendar.'],
        ['gap', '↓', 'It is not part of your routine, so often it does not happen.'],
        ['today', '03', 'The shift exists in a message and in your intention. Nowhere else.'],
      ],
      2.75,
    );
    punch(s, 'Nobody finds out until the desk is empty.');
    rail(s, 3);
    pagenum(s, 17);
  }

  {
    const s = newSlide();
    head(s, 'What happens now', 'It is already on your schedule', null, { w: 5.4 });
    features(
      s,
      [
        'Claiming it put it there. Nothing to add.',
        'A home screen widget, so it is in front of you.',
        'Notifications about your own shifts cannot be silenced.',
        'Change anything and it updates everywhere at once.',
      ],
      MX,
      2.75,
      5.1,
    );
    await phoneImage(s, 'myshifts', 8.55, 0.55, 6.4);
    rail(s, 3);
    pagenum(s, 18);
  }

  // ---------------------------------------------------------------------
  // PROBLEM 4. FLOATING
  // ---------------------------------------------------------------------

  {
    const s = newSlide();
    divider(
      s,
      'Problem 04  ·  the big one',
      'Floating runs on email and trust',
      'Sending a worker from one house to cover another. It matters most in fall and spring, and it fails in five different ways.',
      19,
      4,
    );
  }

  {
    const s = newSlide();
    head(s, 'Floating today', 'Three people. Two calls. One hour of cover.');
    artifact(
      s,
      'Email thread  ·  Sunday  ·  12:44 PM to 12:56 PM',
      [
        { text: 'Andrew, 12:44 PM\n', options: { color: C.brand, fontFace: MONO, fontSize: 10.5 } },
        plain(
          'Rodin just called requesting a floater from 1:00 PM to 2:00 PM. I initially told them to call the Quad first, but they currently have Allied coverage and are unable to check. She later called back, and I asked her to call again 20 minutes before 1:00 PM. However, she mentioned she will be unavailable from 11:30 AM onward. Since we have two workers scheduled at that time, I wanted to pass this along to see whether Jing can float to the Rodin desk for that hour.\n\n',
        ),
        {
          text: 'Abraham, 12:56 PM\n',
          options: { color: C.brand, fontFace: MONO, fontSize: 10.5 },
        },
        plain(
          'Thanks for the heads up. Jing can float to Rodin from 1:00 to 2:00 PM. Also, I did call her and she mentioned you texted her, which is okay, but for future reference ',
        ),
        em('please use the desk phone to call the scheduled worker directly'),
        plain(
          '. Calls are preferred since they get an immediate yes or no, whereas a text might be seen late or ignored.',
        ),
      ],
      2.55,
      { h: 4.1, w: 9.6 },
    );
    rail(s, 4);
    pagenum(s, 20);
  }

  {
    const s = newSlide();
    head(s, 'Read that last line again', 'We already know the channel is unreliable');
    s.addShape('rect', {
      x: MX,
      y: 2.75,
      w: 0.05,
      h: 1.5,
      fill: { color: C.brand },
      line: { type: 'none' },
    });
    s.addText(
      'A text might be seen late or ignored, especially for time sensitive coverage like this.',
      {
        x: MX + 0.25,
        y: 2.75,
        w: 9.2,
        h: 1.5,
        fontFace: SANS,
        fontSize: 27,
        bold: true,
        color: C.ink,
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.25,
      },
    );
    s.addText(
      'The correct instinct, written down by a manager. The problem is that a phone call is the only tool available that gives a yes or no.',
      {
        x: MX,
        y: 4.4,
        w: 8.2,
        h: 0.7,
        fontFace: SANS,
        fontSize: 13,
        color: C.slate,
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.3,
      },
    );
    punch(s, 'The app makes the answer part of the request, so nobody has to chase it.');
    rail(s, 4);
    pagenum(s, 21);
  }

  {
    const s = newSlide();
    head(s, 'Floating', 'Five ways it fails');
    const FAILS = [
      ['They never saw the email.', 'So they never knew they were meant to float at all.'],
      [
        'They saw it, agreed, and forgot.',
        'They go to their home desk on autopilot. The desk they were covering sits empty.',
      ],
      ['They never replied.', 'Nobody knows whether anyone is coming, so the reply gets assumed.'],
      [
        'Nobody can reach them en route.',
        'The desk waits five minutes, panics, and pages for paid coverage.',
      ],
      [
        'The rota can be dodged.',
        'A house says it has no floater. There is no way to check, so the burden lands on Harnwell.',
      ],
    ];
    let fy = 2.55;
    FAILS.forEach(([bold, rest], i) => {
      s.addShape('ellipse', {
        x: MX,
        y: fy,
        w: 0.34,
        h: 0.34,
        fill: { type: 'none' },
        line: { color: C.rule, width: 1 },
      });
      s.addText(String(i + 1), {
        x: MX,
        y: fy,
        w: 0.34,
        h: 0.34,
        fontFace: MONO,
        fontSize: 11,
        color: C.brand,
        align: 'center',
        valign: 'middle',
        margin: 0,
      });
      s.addText(
        [
          { text: bold + ' ', options: { bold: true, color: C.ink } },
          { text: rest, options: { color: C.warn } },
        ],
        {
          x: MX + 0.5,
          y: fy - 0.02,
          w: 9.3,
          h: 0.55,
          fontFace: SANS,
          fontSize: 13,
          margin: 0,
          valign: 'top',
          lineSpacingMultiple: 1.2,
        },
      );
      fy += 0.66;
    });
    rail(s, 4);
    pagenum(s, 22);
  }

  {
    const s = newSlide();
    head(s, 'Failure 2, the worst version', 'The partial float');
    // Scheduled bar
    s.addText('SCHEDULED', {
      x: MX,
      y: 2.65,
      w: 1.3,
      h: 0.4,
      fontFace: MONO,
      fontSize: 9.5,
      color: C.slate,
      align: 'right',
      valign: 'middle',
      margin: 0,
    });
    s.addShape('roundRect', {
      x: MX + 1.5,
      y: 2.65,
      w: 7.6,
      h: 0.4,
      rectRadius: 0.04,
      fill: { color: 'F2F4F7' },
      line: { type: 'none' },
    });
    s.addText('Harnwell   12:00 to 18:00', {
      x: MX + 1.66,
      y: 2.65,
      w: 7.3,
      h: 0.4,
      fontFace: SANS,
      fontSize: 12,
      bold: true,
      color: '4A5260',
      valign: 'middle',
      margin: 0,
    });
    // Floated bar
    s.addText('FLOATED', {
      x: MX,
      y: 3.2,
      w: 1.3,
      h: 0.4,
      fontFace: MONO,
      fontSize: 9.5,
      color: C.slate,
      align: 'right',
      valign: 'middle',
      margin: 0,
    });
    s.addShape('roundRect', {
      x: MX + 1.5,
      y: 3.2,
      w: 5.07,
      h: 0.4,
      rectRadius: 0.04,
      fill: { color: C.brand },
      line: { type: 'none' },
    });
    s.addText('DuBois   12:00 to 16:00', {
      x: MX + 1.66,
      y: 3.2,
      w: 4.8,
      h: 0.4,
      fontFace: SANS,
      fontSize: 12,
      bold: true,
      color: 'FFFFFF',
      valign: 'middle',
      margin: 0,
    });
    s.addShape('roundRect', {
      x: MX + 1.5 + 5.17,
      y: 3.2,
      w: 2.43,
      h: 0.4,
      rectRadius: 0.04,
      fill: { color: 'F2F4F7' },
      line: { type: 'none' },
    });
    s.addText('Harnwell 16:00 to 18:00', {
      x: MX + 1.66 + 5.17,
      y: 3.2,
      w: 2.2,
      h: 0.4,
      fontFace: SANS,
      fontSize: 11,
      bold: true,
      color: '4A5260',
      valign: 'middle',
      margin: 0,
    });

    s.addText(
      [
        plain('You are working either way, so nothing feels wrong. You show up at Harnwell. '),
        em('Two desks are now wrong at once'),
        plain(': the one you left uncovered, and the one you are standing at.'),
      ],
      {
        x: MX,
        y: 4.05,
        w: 9.6,
        h: 1.3,
        fontFace: SANS,
        fontSize: 17,
        color: C.ink,
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.35,
      },
    );
    rail(s, 4);
    pagenum(s, 23);
  }

  {
    const s = newSlide();
    head(s, 'Failure 3, with a real number', 'Nobody knows if the floater is coming');
    s.addText('5h45m', {
      x: MX,
      y: 2.75,
      w: 3.2,
      h: 1.1,
      fontFace: SANS,
      fontSize: 52,
      bold: true,
      color: C.brand,
      margin: 0,
      valign: 'top',
    });
    s.addText('TO CONFIRM ONE HOUR OF COVER', {
      x: MX,
      y: 3.75,
      w: 2.4,
      h: 0.6,
      fontFace: MONO,
      fontSize: 9,
      color: C.slate,
      charSpacing: 1,
      margin: 0,
      valign: 'top',
      lineSpacingMultiple: 1.4,
    });
    const tl = [
      ['3:20 PM', 'The float request goes out by email.', false],
      ['…', 'No reply. No status anywhere. Nobody can tell whether the desk is covered.', true],
      ['9:05 PM', 'The worker replies to acknowledge.', false],
    ];
    let ty = 2.8;
    s.addShape('line', { x: 3.7, y: 2.75, w: 0, h: 1.9, line: { color: C.rule, width: 1 } });
    tl.forEach(([time, text, gap]) => {
      s.addText(time, {
        x: 3.95,
        y: ty,
        w: 1.1,
        h: 0.5,
        fontFace: MONO,
        fontSize: 12,
        color: C.warn,
        italic: gap,
        valign: 'top',
        margin: 0,
      });
      s.addText(text, {
        x: 5.15,
        y: ty,
        w: 4.9,
        h: 0.55,
        fontFace: SANS,
        fontSize: 12.5,
        italic: gap,
        color: gap ? C.slate : C.ink,
        valign: 'top',
        margin: 0,
        lineSpacingMultiple: 1.2,
      });
      ty += 0.65;
    });
    punch(s, 'Real dates, one of my own floats to Mayer Hall.');
    rail(s, 4);
    pagenum(s, 24);
  }

  {
    const s = newSlide();
    head(s, 'What happens now', 'The float finds them, and answers back', null, { w: 5.4 });
    features(
      s,
      [
        'Accept or decline with one tap.',
        'A visible deadline, counting down.',
        'Reminders at 6h, 2h, 1h, 30m, and 5m.',
        'You see who has answered, at a glance.',
      ],
      MX,
      2.75,
      5.1,
    );
    s.addText('Answered in seconds, not five hours and forty five minutes.', {
      x: MX,
      y: 4.55,
      w: 5.1,
      h: 0.6,
      fontFace: SANS,
      fontSize: 11.5,
      italic: true,
      color: C.slate,
      margin: 0,
      valign: 'top',
      lineSpacingMultiple: 1.25,
    });
    await phoneImage(s, 'myshifts', 8.55, 0.55, 6.4);
    rail(s, 4);
    pagenum(s, 25);
  }

  {
    const s = newSlide();
    head(s, 'What happens now', 'And the desk can reach them', null, { w: 5.4 });
    features(
      s,
      [
        'One screen showing who is on every desk, right now.',
        'Tap anyone to see their details and call them.',
        'Cross-house cover is colour coded and labelled.',
        'That kills the panic page while a floater is two minutes away.',
      ],
      MX,
      2.75,
      5.1,
    );
    await phoneImage(s, 'house', 8.55, 0.55, 6.4);
    rail(s, 4);
    pagenum(s, 26);
  }

  {
    const s = newSlide();
    head(s, 'Failure 5', 'The rota is enforced, not trusted');
    twoBranch(
      s,
      {
        head: 'Today',
        body: 'A house says it has no floater available. There is no way to verify it, so the burden quietly moves to whoever will say yes.',
        bad: true,
      },
      {
        head: 'With the app',
        body: 'The system picks the floater from the real staffing picture. A desk can never be left below one worker, and Harnwell is never a destination.',
        bad: false,
        good: true,
      },
      2.55,
      { h: 2.0 },
    );
    punch(s, 'You stop being the person who has to push back.');
    rail(s, 4);
    pagenum(s, 27);
  }

  // ---------------------------------------------------------------------
  // PROBLEM 5. UNNECESSARY PAGES
  // ---------------------------------------------------------------------

  {
    const s = newSlide();
    divider(
      s,
      'Problem 05',
      'Paged for what experience already answers',
      'The manager on duty is the first stop for questions that should never have reached them.',
      28,
      5,
    );
  }

  {
    const s = newSlide();
    head(s, 'The pattern', 'The answer exists. It is just not findable in the moment.');
    const Q = [
      'Does this group get access to this room?',
      'My PAN card is not working and I have tried the obvious things.',
      'A contractor is asking to be let in. Do I?',
      'The alarm is going off in one room. Is that a building thing?',
    ];
    const qw = (9.6 - 0.2) / 2;
    Q.forEach((q, i) => {
      const col = i % 2,
        row = Math.floor(i / 2);
      const x = MX + col * (qw + 0.2),
        y = 2.55 + row * 0.85;
      s.addShape('roundRect', {
        x,
        y,
        w: qw,
        h: 0.7,
        rectRadius: 0.06,
        fill: { type: 'none' },
        line: { color: C.rule, width: 1 },
      });
      s.addText(q, {
        x: x + 0.2,
        y,
        w: qw - 0.4,
        h: 0.7,
        fontFace: SANS,
        fontSize: 12,
        color: C.warn,
        valign: 'middle',
        margin: 0,
        lineSpacingMultiple: 1.15,
      });
    });
    callout(
      s,
      'Two hidden costs',
      'New workers take a long time to get up to speed, and hard-won knowledge leaves when people graduate. The binder exists. Long documents do not get read at the moment of need.',
      5.85,
      { h: 1.0 },
    );
    rail(s, 5);
    pagenum(s, 29);
  }

  {
    const s = newSlide();
    head(s, 'What happens now', 'Ask first. Page only if you still need to.', null, { w: 5.4 });
    features(
      s,
      [
        'Grounded strictly in the official documentation.',
        'It cites the document it answered from.',
        'It knows who is actually on duty right now.',
        'Scoped by role and house, so answers fit the asker.',
      ],
      MX,
      2.75,
      5.1,
    );
    s.addText(
      'Built and working. Whether it reduces pages is exactly what a pilot would measure.',
      {
        x: MX,
        y: 4.55,
        w: 5.1,
        h: 0.6,
        fontFace: SANS,
        fontSize: 11.5,
        italic: true,
        color: C.slate,
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.25,
      },
    );
    await phoneImage(s, 'assistant', 8.55, 0.55, 6.4);
    rail(s, 5);
    pagenum(s, 30);
  }

  // ---------------------------------------------------------------------
  // PROBLEM 6. INCOMPLETE PAGES
  // ---------------------------------------------------------------------

  {
    const s = newSlide();
    divider(
      s,
      'Problem 06',
      'The pages that matter arrive incomplete',
      'When a page is genuinely warranted, it often lands without the one fact that decides the response.',
      31,
      6,
    );
  }

  {
    const s = newSlide();
    head(s, 'The missing facts', 'Every call-back costs the same time twice');
    twoBranch(
      s,
      { head: 'What arrives', body: '"There is a water leak."', bad: true },
      {
        head: 'What is needed to act',
        body: 'Which building and room. One room or building wide. What was already tried. When the desk shift ends. Whether anyone is on the way.',
        bad: false,
        good: true,
      },
      2.55,
      { h: 2.0 },
    );
    punch(s, 'So the manager on duty calls back, and resolution slows down.');
    rail(s, 6);
    pagenum(s, 32);
  }

  {
    const s = newSlide();
    head(s, 'What happens now', 'Paging becomes a guided form, not a blank box');
    features(
      s,
      [
        'It asks for the specific facts that this kind of situation needs.',
        'It categorises and routes to the right tier, not always straight to the top.',
        'The person still reviews and edits everything before it sends.',
        'Often the flow surfaces the answer before a page is needed at all.',
      ],
      MX,
      2.6,
      9.6,
    );
    callout(
      s,
      'Where this came from',
      'This one is not my observation. It came from the Harnwell housing manager, who named incomplete pages as the thing that slows her down most.',
      5.75,
      { h: 1.05 },
    );
    rail(s, 6);
    pagenum(s, 33);
  }

  // ---------------------------------------------------------------------
  // PROBLEM 7. BUILDING THE SCHEDULE
  // ---------------------------------------------------------------------

  {
    const s = newSlide();
    divider(
      s,
      'Problem 07',
      'Schedules are built by hand',
      "Every build cycle, a student manager reconciles everyone's availability across a pile of spreadsheets.",
      34,
      7,
    );
  }

  {
    const s = newSlide();
    head(s, 'The build week today', 'Hours of manual reconciliation');
    chain(
      s,
      [
        ['today', '01', "Collect everyone's preferences and target hours."],
        ['today', '02', 'Open several spreadsheets side by side.'],
        ['today', '03', 'Reconcile by hand against coverage, hours, and who cannot work when.'],
        ['gap', '↓', "The result is only as good as one person's patience at 1am."],
      ],
      2.75,
    );
    punch(s, 'And if someone transfers or drops out, much of it is done again.');
    rail(s, 7);
    pagenum(s, 35);
  }

  {
    const s = newSlide();
    head(s, 'What happens now', 'It drafts the schedule. You still decide.');
    features(
      s,
      [
        "Generates a full draft for the house from everyone's submitted preferences.",
        'The student manager reviews it and edits anything they like.',
        'It is a first draft that removes the tedious pass, not an autopilot.',
        'Coverage always wins over preference. It will not leave a fillable seat empty to make someone happier.',
      ],
      MX,
      2.6,
      9.6,
    );
    callout(
      s,
      'The guarantee that matters',
      'A block someone marked "cannot work" is not a preference the system weighs. It is a hard rule. A draft that assigns anyone to a blocked slot is rejected as invalid before it is ever shown.',
      5.75,
      { h: 1.05 },
    );
    rail(s, 7);
    pagenum(s, 36);
  }

  {
    const s = newSlide();
    head(
      s,
      'How we would measure it',
      'Judge it on what actually matters',
      'Comparing it to the schedule we happened to build is a weak test. A different schedule can be a better one.',
    );
    const rows = [
      ['Workers who hit their target hours', 'to fill', 'to fill', 'Higher', false],
      ['"Cannot work" violations', 'to fill', '0 by design', 'Must be zero', true],
      ['Share of shifts that were preferred', 'to fill', 'to fill', 'Higher', false],
      ['Fairness spread, hours against target', 'to fill', 'to fill', 'Lower', false],
      ['Coverage gaps left unfilled', 'to fill', 'to fill', 'Lower', false],
    ];
    const tblRows = [
      [
        { text: 'MEASURE', options: { fontFace: MONO, fontSize: 9, color: C.slate, bold: false } },
        {
          text: 'BUILT BY HAND',
          options: { fontFace: MONO, fontSize: 9, color: C.slate, bold: false },
        },
        { text: 'DRAFTED', options: { fontFace: MONO, fontSize: 9, color: C.slate, bold: false } },
        { text: 'GOOD IS', options: { fontFace: MONO, fontSize: 9, color: C.slate, bold: false } },
      ],
    ];
    rows.forEach(([m, b, d, g, hi]) => {
      const fill = hi ? { color: C.pale } : undefined;
      const phColor = 'B6BCC4';
      tblRows.push([
        { text: m, options: { fontFace: SANS, fontSize: 12, color: C.ink, fill } },
        { text: b, options: { fontFace: MONO, fontSize: 11, color: phColor, fill } },
        {
          text: d,
          options: { fontFace: MONO, fontSize: 11, color: hi ? C.ink : phColor, bold: hi, fill },
        },
        { text: g, options: { fontFace: SANS, fontSize: 12, color: C.ink, fill } },
      ]);
    });
    s.addTable(tblRows, {
      x: MX,
      y: 2.8,
      w: 9.6,
      h: 2.7,
      colW: [3.6, 2, 2, 2],
      border: { type: 'solid', color: C.rule, pt: 0.75 },
      autoPage: false,
      valign: 'middle',
      margin: [4, 6, 4, 6],
    });
    s.addText(
      'Numbers go in as soon as I have the summer records. I would rather show you the real result, including where it loses, than a number you cannot check.',
      {
        x: MX,
        y: 5.7,
        w: 8.5,
        h: 0.6,
        fontFace: SANS,
        fontSize: 10.5,
        color: C.slate,
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.3,
      },
    );
    rail(s, 7);
    pagenum(s, 37);
  }

  // ---------------------------------------------------------------------
  // ACT 3. CLOSE
  // ---------------------------------------------------------------------

  {
    const s = newSlide();
    head(s, 'Where this actually is', 'None of this is a mockup');
    const BUILT = [
      'One live schedule shared by all 13 houses',
      'Drops, claims, and partial claims in app',
      'Swaps and one-way handoffs, agreed peer to peer',
      'Automatic float assignment with tap to acknowledge',
      'Escalating reminders at 6h, 2h, 1h, 30m, 5m',
      'Automatic coverage search, paid cover as last resort',
      'Home screen widgets for your next shift',
      'Push notifications you cannot miss',
      'Tap any worker to see details and call them',
      'Hours split into home, floated, and cross-house',
      'A grounded assistant that cites its sources',
      'iPhone, Android, and a web view for managers',
    ];
    const colW = 4.8;
    BUILT.forEach((t, i) => {
      const col = i % 2,
        row = Math.floor(i / 2);
      const x = MX + col * colW,
        y = 2.65 + row * 0.42;
      s.addText('✓', {
        x,
        y,
        w: 0.28,
        h: 0.36,
        fontFace: SANS,
        fontSize: 12,
        bold: true,
        color: C.brand,
        margin: 0,
        valign: 'top',
      });
      s.addText(t, {
        x: x + 0.3,
        y,
        w: colW - 0.4,
        h: 0.4,
        fontFace: SANS,
        fontSize: 11.5,
        color: C.ink,
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.15,
      });
    });
    pagenum(s, 38);
  }

  {
    const s = newSlide();
    head(
      s,
      'What I am asking for',
      'Let me prove it in one house',
      'Harnwell is the natural place to start. It carries the most floating complexity, and I work there.',
    );
    const ASKS = [
      [
        '01',
        'A defined trial window',
        'Run real staffing through the app for a few weeks, alongside the current process.',
      ],
      [
        '02',
        'Your blessing',
        'Nothing changes for anyone who does not want it to. If we stop, nothing breaks.',
      ],
      [
        '03',
        'A point of contact',
        'For real worker and schedule data, so the pilot runs on the truth.',
      ],
    ];
    const cw = (9.6 - 2 * 0.3) / 3;
    ASKS.forEach(([num, title, body], i) => {
      const x = MX + i * (cw + 0.3),
        y = 2.9;
      s.addShape('line', { x, y, w: cw, h: 0, line: { color: C.brand, width: 2 } });
      s.addText(num, {
        x,
        y: y + 0.1,
        w: cw,
        h: 0.25,
        fontFace: MONO,
        fontSize: 10,
        color: C.brand,
        charSpacing: 1,
        margin: 0,
      });
      s.addText(title, {
        x,
        y: y + 0.38,
        w: cw,
        h: 0.7,
        fontFace: SANS,
        fontSize: 16,
        bold: true,
        color: C.ink,
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.15,
      });
      s.addText(body, {
        x,
        y: y + 1.1,
        w: cw,
        h: 1.3,
        fontFace: SANS,
        fontSize: 11,
        color: C.slate,
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.25,
      });
    });
    pagenum(s, 39);
  }

  {
    const s = newSlide();
    s.addText('THE TAKEAWAY', {
      x: MX,
      y: 2.5,
      w: 8,
      h: 0.3,
      fontFace: MONO,
      fontSize: 11,
      color: C.slate,
      charSpacing: 2,
      margin: 0,
    });
    s.addText("Today, the desks stay covered because of your inbox and everyone's memory.", {
      x: MX,
      y: 2.85,
      w: 9.6,
      h: 1.5,
      fontFace: SANS,
      fontSize: 26,
      bold: true,
      color: C.ink,
      margin: 0,
      valign: 'top',
      lineSpacingMultiple: 1.25,
    });
    s.addText(
      'This makes the schedule live, reminds people so shifts are not forgotten, lets workers reach each other, and fills empty desks automatically and fairly.',
      {
        x: MX,
        y: 4.45,
        w: 8.3,
        h: 0.9,
        fontFace: SANS,
        fontSize: 14,
        color: C.slate,
        margin: 0,
        valign: 'top',
        lineSpacingMultiple: 1.35,
      },
    );
    pagenum(s, 40);
  }

  await pres.writeFile({ fileName: 'rsm-deck.pptx' });
  console.log('wrote rsm-deck.pptx, 40 slides');
})();
