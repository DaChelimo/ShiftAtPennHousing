// Desk Assistant — PDF layout risk heuristic. The primary fixture below mirrors the
// real "Conference Groups Moving into Harnwell" table (7 columns, 8 data rows, mostly
// short Yes/NO/date/dash cells) from the uploaded Harnwell Flowcharts.pdf: this is the
// concrete document this heuristic must catch.

import { describe, expect, it } from 'vitest';

import {
  assessLayoutRisk,
  assessPageLayoutRisk,
  type TextItemPosition,
} from '../../src/desk-assistant/index.js';

function item(text: string, x: number, y: number): TextItemPosition {
  return { text, x, y, width: text.length * 6, height: 10 };
}

// Column x-anchors and row y-anchors modeled on the real table's layout (letter page,
// header + 8 program rows), extracted in ordinary row-major reading order -- i.e. the
// *best case* for a native (non-scanned) PDF export, not an adversarial ordering.
const CONFERENCE_TABLE_COLUMNS_X = [50, 200, 290, 380, 460, 520, 580];
const CONFERENCE_TABLE_ROWS = [
  [
    'Program Name',
    'Move in Date',
    'Move out Date',
    'Allow Day Visitors',
    'Allow Over Night Guests',
    'Curfew Times',
    'Linens',
  ],
  [
    '2026 Wistar Research Program 10-Weeks',
    'Sat, May 23',
    'Sat, Aug 7',
    'Yes',
    'NO',
    'none',
    'In room',
  ],
  ['2026 ITMAT (TRIP)', 'Sat, May 23', 'Sat, Aug 7', 'Yes', 'Yes', 'none', '-'],
  [
    '2026 MindCore Summer Fellowship',
    'Sun, May 31',
    'Sat, Aug 8',
    'Yes',
    'NO',
    'none',
    'Picked up from IC',
  ],
  ['2026 SUPERS@PENN Interns', 'Sun, May 31', 'Fri, Aug 7', 'Yes', 'Yes', 'none', '-'],
  ['2026 Penn Summer Global Institute', 'Tue, Jun 30', 'Sat, Aug 8', 'NO', 'NO', 'none', 'In room'],
  ['2026 ELP IAPS Summer', 'Sat, Jul 4', 'Sun, Aug 2', 'NO', 'NO', 'none', '-'],
  [
    '2026 ELP Santander',
    'Sat/Sun, Jul 11-12',
    'Sun, Aug 2',
    'Yes',
    'NO',
    '5:30am-11:59pm',
    'Picked up from IC',
  ],
  ['2026 Penn First Plus Program', 'Sat, Jul 18', '', 'Yes', 'NO', 'none', '-'],
];

function buildConferenceTablePage(): TextItemPosition[] {
  const items: TextItemPosition[] = [];
  CONFERENCE_TABLE_ROWS.forEach((row, rowIdx) => {
    const y = 700 - rowIdx * 35;
    row.forEach((cell, colIdx) => {
      if (cell.length === 0) return;
      items.push(item(cell, CONFERENCE_TABLE_COLUMNS_X[colIdx]!, y));
    });
  });
  // Footnote lines below the table -- long-ish prose, doesn't change the verdict.
  items.push(item('Above Groups ARE NOT allowed to access the Computer Lab.', 50, 330));
  items.push(item('Above Groups DO NOT have reservations for common spaces in Harnwell.', 50, 315));
  return items;
}

const PLAIN_PROSE_PAGE: TextItemPosition[] = [
  item('Please contact the Housing Manager On-Duty for any facilities emergency', 72, 700),
  item('that affects the safety or security of a resident or guest before paging', 72, 685),
  item('the Conference Services Manager On-Duty for conference-related concerns.', 72, 670),
  item('Non-business hours run Monday through Friday from five in the evening', 72, 655),
  item('until midnight, and Saturday and Sunday from eight in the morning until', 72, 640),
  item('midnight, with business hours covering the remaining weekday daytime span.', 72, 625),
];

describe('assessPageLayoutRisk', () => {
  it('flags the real conference-groups table shape (last page of the uploaded PDF)', () => {
    const result = assessPageLayoutRisk(buildConferenceTablePage(), 4);
    expect(result.risky).toBe(true);
    expect(result.reasons.some((r) => r.startsWith('short-fragment-density'))).toBe(true);
    expect(result.reasons.some((r) => r.startsWith('repeating-column-grid'))).toBe(true);
  });

  it('does not flag ordinary single-column prose', () => {
    const result = assessPageLayoutRisk(PLAIN_PROSE_PAGE, 1);
    expect(result.risky).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('flags a page whose extraction order jumps back up the page (free-floating callout boxes)', () => {
    // A flowchart's center decision column extracts fine, but a side callout box drawn
    // out of document order lands well above the previous item's y mid-sequence.
    const scrambled: TextItemPosition[] = [
      item('Does the emergency affect the physical safety of yourself or another?', 220, 700),
      item('CALL UPPD at 511, or press the panic button at your desk.', 560, 690),
      item('Then contact the CSMOD Duty Phone 445-221-3453', 560, 675),
      item('Is the problem a facilities emergency that impacts the safety', 220, 560),
      item('CALL FACILITIES at 215-898-7208', 60, 640),
      item('Then call the Harnwell Info Center at 8-6873', 60, 625),
      item('Is the problem related to the behavior of a Penn summer student', 220, 430),
      item('Page the SCA On-DUTY via the Duty Phone 267-835-1863', 560, 545),
    ];
    const result = assessPageLayoutRisk(scrambled, 1);
    expect(result.risky).toBe(true);
    expect(result.reasons.some((r) => r.startsWith('reading-order-violations'))).toBe(true);
  });

  it('does not assess a near-empty page (too little signal)', () => {
    const result = assessPageLayoutRisk([item('Section 4', 72, 700)], 3);
    expect(result.risky).toBe(false);
  });

  it('is deterministic: same input yields identical output', () => {
    const page = buildConferenceTablePage();
    expect(assessPageLayoutRisk(page, 4)).toEqual(assessPageLayoutRisk(page, 4));
  });
});

describe('assessLayoutRisk', () => {
  it('flags the document when only the last page (the table) is risky', () => {
    const result = assessLayoutRisk([
      PLAIN_PROSE_PAGE,
      PLAIN_PROSE_PAGE,
      PLAIN_PROSE_PAGE,
      buildConferenceTablePage(),
    ]);
    expect(result.risky).toBe(true);
    expect(result.pages[0]!.risky).toBe(false);
    expect(result.pages[1]!.risky).toBe(false);
    expect(result.pages[2]!.risky).toBe(false);
    expect(result.pages[3]!.risky).toBe(true);
  });

  it('does not flag an all-prose document', () => {
    const result = assessLayoutRisk([PLAIN_PROSE_PAGE, PLAIN_PROSE_PAGE]);
    expect(result.risky).toBe(false);
  });
});
