// Desk Assistant — source normalization (INTAKE_PLAN Phase 1).

import { describe, expect, it } from 'vitest';

import {
  normalize,
  normalizeMarkdown,
  normalizePdfText,
  postClean,
} from '../../src/desk-assistant/index.js';

describe('postClean', () => {
  it('normalizes CRLF and strips a BOM', () => {
    expect(postClean('﻿one\r\ntwo\r\n')).toBe('one\ntwo');
  });

  it('rejoins a word hyphen-split across a line break', () => {
    expect(postClean('Please provide infor-\nmation to HMOD.')).toBe(
      'Please provide information to HMOD.',
    );
  });

  it('leaves an intentional line-start hyphen (enumeration) alone', () => {
    // Uppercase after the break is not a wrapped syllable.
    expect(postClean('call SMOD-\nHMOD split')).toBe('call SMOD-\nHMOD split');
  });

  it('normalizes bullet glyphs to markdown dashes, preserving indent', () => {
    expect(postClean('• first\n\t◦ nested')).toBe('- first\n\t- nested');
  });

  it('sweeps em and en dashes to hyphens (no dashes in stored copy)', () => {
    expect(postClean('Harnwell — Rodin range 10–12')).toBe('Harnwell - Rodin range 10-12');
  });

  it('collapses interior whitespace but preserves leading indentation', () => {
    expect(postClean('a    b\n    indented')).toBe('a b\n    indented');
  });

  it('collapses 3+ blank lines to a single paragraph break', () => {
    expect(postClean('para one\n\n\n\npara two')).toBe('para one\n\npara two');
  });

  it('removes bare page-number lines when there are no page breaks', () => {
    expect(postClean('content\nPage 2\nmore')).toBe('content\nmore');
  });

  it('strips running headers/footers that repeat across pages', () => {
    const page = (n: number) => `Harnwell Summer Binder\nbody ${n}\n${n}`;
    const raw = [page(1), page(2), page(3)].join('\f');
    const out = postClean(raw, 3);
    expect(out).not.toContain('Harnwell Summer Binder');
    expect(out).toContain('body 1');
    expect(out).toContain('body 2');
    expect(out).toContain('body 3');
  });

  it('does not strip repeated lines when there are fewer than 3 pages', () => {
    const raw = 'Shared Heading\nbody 1\f Shared Heading\nbody 2';
    expect(postClean(raw, 2)).toContain('Shared Heading');
  });
});

describe('normalize dispatch', () => {
  it('passes markdown through cleaned and tagged', () => {
    const doc = normalizeMarkdown('- do not page HMOD in business hours\n');
    expect(doc.format).toBe('markdown');
    expect(doc.text).toBe('- do not page HMOD in business hours');
    expect(doc.warnings).toEqual([]);
  });

  it('flags an empty PDF text layer as needing OCR rather than throwing', () => {
    const doc = normalizePdfText('   \n  ');
    expect(doc.format).toBe('pdf');
    expect(doc.warnings.some((w) => w.startsWith('pdf-empty-text-layer'))).toBe(true);
  });

  it('warns on an empty document after normalization', () => {
    expect(normalize({ format: 'text', raw: '' }).warnings).toContain(
      'empty document after normalization',
    );
  });

  it('is deterministic: same input yields identical output', () => {
    const input = { format: 'pdf' as const, raw: 'a  b—c\n\n\n d', pageCount: 1 };
    expect(normalize(input)).toEqual(normalize(input));
  });
});
