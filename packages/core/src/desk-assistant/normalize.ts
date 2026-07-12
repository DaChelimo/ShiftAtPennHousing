// Desk Assistant — source normalization (INTAKE_PLAN Phase 1). Pure: no Supabase,
// no network, deterministic (same input, same output).
//
// Turns an uploaded source (markdown, plain text, or extracted PDF text) into ONE
// NormalizedDoc shape that the proposer + chunker consume, regardless of input format.
//
// PDF *parsing* (bytes -> a raw text layer) cannot live here: the parser is a
// Node/Deno library and packages/core is dependency-free by contract. So core declares
// PdfTextExtractor as an injected seam -- the EF/script layer supplies the raw text
// layer, and core owns the cleanup (postClean) and the NormalizedDoc contract.

export type NormalizedFormat = 'markdown' | 'text' | 'pdf';

export interface NormalizedDoc {
  /** Cleaned text, ready to chunk. */
  text: string;
  format: NormalizedFormat;
  /** Non-fatal issues an operator should see at review time. */
  warnings: string[];
}

/** Raw text layer handed back by a PDF parser in the EF/script layer. */
export interface RawExtraction {
  text: string;
  /** Page count if the parser reports it (drives header/footer detection). */
  pageCount?: number;
}

/** The injected seam: bytes in, raw text layer out. Implemented outside core. */
export type PdfTextExtractor = (bytes: Uint8Array) => Promise<RawExtraction>;

// Form feed is the conventional page separator emitted by PDF text extractors.
const PAGE_BREAK = '\f';

// A line that is only a page number: "3", "Page 3", "3 of 12", "- 3 -".
const PAGE_NUMBER_LINE = /^\s*[-–—]?\s*(page\s+)?\d+(\s+of\s+\d+)?\s*[-–—]?\s*$/i;

/**
 * Clean a raw text body into indexable form. Order matters:
 *   1. normalize line endings + strip BOM
 *   2. drop repeated page headers/footers and bare page-number lines
 *   3. rejoin the syllable of a word split across a line break ("infor-\nmation")
 *   4. normalize bullet glyphs to "- "
 *   5. sweep em/en dashes to hyphens (project copy rule: none in stored text)
 *   6. collapse redundant whitespace, preserving leading indent + paragraph breaks
 */
export function postClean(raw: string, pageCount?: number): string {
  let text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  text = stripRepeatedHeadersFooters(text, pageCount);
  text = text.replace(new RegExp(PAGE_BREAK, 'g'), '\n\n');
  text = dehyphenate(text);
  text = normalizeBullets(text);
  text = sweepDashes(text);
  text = collapseWhitespace(text);
  return text.trim();
}

// Detect lines that recur on most pages (running headers/footers) and remove them,
// plus any bare page-number line on any page. Only runs when the text actually has
// page breaks AND at least 3 pages -- with fewer, "repeated" is not distinguishable
// from legitimately repeated content.
function stripRepeatedHeadersFooters(text: string, pageCount?: number): string {
  if (!text.includes(PAGE_BREAK)) {
    return removePageNumberLines(text);
  }
  const pages = text.split(PAGE_BREAK);
  if (pages.length < 3) return removePageNumberLines(text);

  const counts = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const line of page.split('\n')) {
      const key = line.trim();
      if (key.length === 0 || key.length > 120) continue;
      if (seen.has(key)) continue; // count each line once per page
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.ceil((pageCount ?? pages.length) / 2);
  const boilerplate = new Set(
    [...counts.entries()].filter(([, n]) => n >= threshold).map(([k]) => k),
  );

  const kept = pages.map((page) =>
    page
      .split('\n')
      .filter((line) => {
        const key = line.trim();
        if (key.length === 0) return true;
        return !boilerplate.has(key) && !PAGE_NUMBER_LINE.test(line);
      })
      .join('\n'),
  );
  return kept.join(PAGE_BREAK);
}

function removePageNumberLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !PAGE_NUMBER_LINE.test(line))
    .join('\n');
}

// Rejoin a word hyphen-split across a line break: "infor-\nmation" -> "information".
// Only when a letter precedes the hyphen and a lowercase letter opens the next line,
// so intentional hyphenated line-starts and enumerations are left alone.
function dehyphenate(text: string): string {
  return text.replace(/([A-Za-z])[-­]\n\s*([a-z])/g, '$1$2');
}

// Leading bullet glyphs -> markdown "- ", preserving indentation depth.
function normalizeBullets(text: string): string {
  return text.replace(/^([ \t]*)[•▪◦·‣∙*]\s+/gm, '$1- ');
}

// Project copy rule: no em/en dashes in stored copy. Sweep them (and horizontal bar)
// to a plain hyphen. Runs after bullet normalization so a leading "– item" that was a
// bullet is already "- item".
function sweepDashes(text: string): string {
  return text.replace(/[—–―]/g, '-');
}

// Trailing spaces gone; 3+ blank lines -> one blank line; interior runs of spaces
// collapsed. Leading indentation is preserved (nested bullets), so only whitespace
// following a non-space character is collapsed.
function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+$/gm, '')
    .replace(/(\S)[ \t]{2,}/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n');
}

function build(text: string, format: NormalizedFormat, extra: string[] = []): NormalizedDoc {
  const warnings = [...extra];
  if (text.length === 0) warnings.push('empty document after normalization');
  return { text, format, warnings };
}

export function normalizeMarkdown(raw: string): NormalizedDoc {
  return build(postClean(raw), 'markdown');
}

export function normalizeText(raw: string): NormalizedDoc {
  return build(postClean(raw), 'text');
}

/**
 * Normalize a PDF's already-extracted text layer. `rawText` comes from an injected
 * PdfTextExtractor; core only cleans it. An empty text layer is the scanned-PDF /
 * photo case: flagged (not thrown) so the operator sees "needs OCR" at review.
 */
export function normalizePdfText(rawText: string, pageCount?: number): NormalizedDoc {
  const cleaned = postClean(rawText, pageCount);
  const warnings: string[] = [];
  if (rawText.trim().length === 0) {
    warnings.push('pdf-empty-text-layer: no selectable text, may be a scan needing OCR');
  }
  return build(cleaned, 'pdf', warnings);
}

/** Dispatch by declared format. `pageCount` only affects PDF header/footer stripping. */
export function normalize(input: {
  format: NormalizedFormat;
  raw: string;
  pageCount?: number;
}): NormalizedDoc {
  switch (input.format) {
    case 'markdown':
      return normalizeMarkdown(input.raw);
    case 'text':
      return normalizeText(input.raw);
    case 'pdf':
      return normalizePdfText(input.raw, input.pageCount);
    default:
      return build(postClean(input.raw), 'text', ['unknown format, treated as text']);
  }
}
