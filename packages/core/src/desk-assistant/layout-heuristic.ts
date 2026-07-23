// Desk Assistant — PDF layout risk heuristic (INTAKE_PLAN Phase 1 follow-up). Pure: no
// Supabase, no network, deterministic (same input, same output).
//
// unpdf's merged text extraction returns text in PDF content-stream order, not visual
// reading order. For plain single-column prose those two orders coincide, so the plain
// text path is safe. For a flowchart (free-floating callout boxes) or a table (a grid of
// short cells), content-stream order frequently does NOT match reading order, and the
// extracted string can look like ordinary non-empty text while silently losing the
// branching logic or row/column structure that made the source document meaningful.
// That is a worse failure than an empty text layer: it trips no "needs OCR" warning and
// still gets embedded.
//
// This module scores each page's raw text-item positions for that risk, using only
// signals derivable from position data: (1) a page dense with short fragments (table
// cells, flowchart box labels), (2) a page where a fixed x-position recurs across many
// distinct rows (a table's column grid), (3) a page where content-stream order jumps
// back up the page (free-floating boxes drawn out of reading order). Any one signal
// firing is enough to flag the page -- deliberately strict, since the fallback (routing
// the page through vision extraction instead of the plain text layer) is cheap relative
// to silently corrupting the knowledge base.

/** One text run's position, as reported by a PDF text-content API (PDF coordinate space: origin bottom-left). */
export interface TextItemPosition {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageLayoutRisk {
  /** 1-indexed page number. */
  page: number;
  risky: boolean;
  /** Which signals fired, for operator-facing warnings. Empty when not risky. */
  reasons: string[];
}

export interface LayoutRiskAssessment {
  /** True if any page is risky. */
  risky: boolean;
  pages: PageLayoutRisk[];
}

// A page with fewer non-blank items than this has too little signal to score reliably
// (a title page, a mostly-blank divider) -- treat it as not risky rather than guess.
const MIN_ITEMS_TO_ASSESS = 6;

// Signal 1: short-fragment density. Table cells ("Yes", "NO", "none", a short date) and
// flowchart box labels are short; prose sentences and word-wrapped lines are not.
const SHORT_FRAGMENT_CHARS = 20;
const SHORT_FRAGMENT_RATIO_THRESHOLD = 0.4;

// Signal 2: repeating column alignment. Bucket item x-starts to the nearest COLUMN_BUCKET_PT
// and item y-starts to the nearest ROW_BUCKET_PT; if a single x-bucket recurs across at
// least MIN_COLUMN_ROWS distinct y-buckets, that x is a table column, not a coincidence.
// MIN_REPEATING_COLUMNS such columns on one page is a table grid.
const COLUMN_BUCKET_PT = 15;
const ROW_BUCKET_PT = 6;
const MIN_COLUMN_ROWS = 3;
const MIN_REPEATING_COLUMNS = 2;

// Signal 3: reading-order violations. Compare each item's y to the previous item's y in
// extraction order; PDF y grows upward, so ordinary top-to-bottom prose has y flat or
// decreasing across most transitions. A free-floating callout box drawn out of reading
// order produces a jump back up the page well past ordinary line-height noise.
const READING_ORDER_TOLERANCE_PT = 3;
const READING_ORDER_VIOLATION_RATIO_THRESHOLD = 0.12;

export function assessPageLayoutRisk(
  items: TextItemPosition[],
  pageNumber: number,
): PageLayoutRisk {
  const nonEmpty = items.filter((i) => i.text.trim().length > 0);
  if (nonEmpty.length < MIN_ITEMS_TO_ASSESS) {
    return { page: pageNumber, risky: false, reasons: [] };
  }

  const reasons: string[] = [];

  const shortCount = nonEmpty.filter((i) => i.text.trim().length <= SHORT_FRAGMENT_CHARS).length;
  const shortFragmentRatio = shortCount / nonEmpty.length;
  if (shortFragmentRatio >= SHORT_FRAGMENT_RATIO_THRESHOLD) {
    reasons.push(`short-fragment-density ${Math.round(shortFragmentRatio * 100)}%`);
  }

  const columnBuckets = new Map<number, Set<number>>();
  for (const item of nonEmpty) {
    const xBucket = Math.round(item.x / COLUMN_BUCKET_PT);
    const yBucket = Math.round(item.y / ROW_BUCKET_PT);
    const rows = columnBuckets.get(xBucket) ?? new Set<number>();
    rows.add(yBucket);
    columnBuckets.set(xBucket, rows);
  }
  const repeatingColumns = [...columnBuckets.values()].filter(
    (rows) => rows.size >= MIN_COLUMN_ROWS,
  ).length;
  if (repeatingColumns >= MIN_REPEATING_COLUMNS) {
    reasons.push(`repeating-column-grid x${repeatingColumns}`);
  }

  let violations = 0;
  for (let i = 1; i < nonEmpty.length; i++) {
    if (nonEmpty[i]!.y > nonEmpty[i - 1]!.y + READING_ORDER_TOLERANCE_PT) violations++;
  }
  const readingOrderViolationRatio = violations / (nonEmpty.length - 1);
  if (readingOrderViolationRatio >= READING_ORDER_VIOLATION_RATIO_THRESHOLD) {
    reasons.push(`reading-order-violations ${Math.round(readingOrderViolationRatio * 100)}%`);
  }

  return { page: pageNumber, risky: reasons.length > 0, reasons };
}

/** Score every page; a document is risky if any single page is. */
export function assessLayoutRisk(pages: TextItemPosition[][]): LayoutRiskAssessment {
  const results = pages.map((items, idx) => assessPageLayoutRisk(items, idx + 1));
  return { risky: results.some((r) => r.risky), pages: results };
}
