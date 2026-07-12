// Desk Assistant Phase B — chunking, retrieval ranking, grounding, citations,
// guardrails (V1_SCOPE §4.1, §7.1, §7.3, §8).

import { describe, expect, it } from 'vitest';

import {
  buildCitations,
  buildDeferralMessage,
  chunkDocument,
  detectLifeSafety,
  estimateTokens,
  formatCitationLine,
  lifeSafetyPreamble,
  looksLikeIncidentProbe,
  mentionsAccessDecision,
  selectContext,
  type ItemScope,
  type RequesterContext,
  type RetrievalCandidate,
} from '../../src/desk-assistant/index.js';

const SHARED: ItemScope = { houseScope: null, sensitivity: 'general', allowedRoles: [] };

function sw(house = 'harnwell'): RequesterContext {
  return {
    userId: 'u-1',
    homeHouseId: house,
    roles: ['sw'],
    isActive: true,
    isAdmin: false,
    isRsm: false,
    houseAdminOf: [],
  };
}

function candidate(over: Partial<RetrievalCandidate> = {}): RetrievalCandidate {
  return {
    chunkId: 'c-1',
    documentId: 'd-1',
    content: 'text',
    sourceRef: 'summer binder',
    scope: SHARED,
    similarity: 0.9,
    ...over,
  };
}

describe('selectContext temporal filtering', () => {
  const durable = candidate({ chunkId: 'dur', content: 'do not page HMOD in business hours' });
  const dated = candidate({
    chunkId: 'celine',
    content: 'Celine is backup BA',
    similarity: 0.95,
    effective: {
      temporality: 'expires',
      effectiveFrom: '2026-07-14',
      effectiveUntil: '2026-07-14',
    },
  });

  it('keeps a dated chunk in effect and the durable chunk on that date', () => {
    const { context } = selectContext(sw(), [durable, dated], { asOf: '2026-07-14' });
    expect(context.map((c) => c.chunkId).sort()).toEqual(['celine', 'dur']);
  });

  it('drops the dated chunk once expired, keeps the durable rule', () => {
    const { context } = selectContext(sw(), [durable, dated], { asOf: '2026-07-28' });
    expect(context.map((c) => c.chunkId)).toEqual(['dur']);
  });

  it('without asOf, no temporal filtering is applied', () => {
    const { context } = selectContext(sw(), [durable, dated]);
    expect(context).toHaveLength(2);
  });

  it('prefers the newer source as a tiebreak on equal similarity', () => {
    const old = candidate({
      chunkId: 'old',
      similarity: 0.8,
      sourceUpdatedAt: '2026-01-01T00:00:00Z',
    });
    const fresh = candidate({
      chunkId: 'new',
      similarity: 0.8,
      sourceUpdatedAt: '2026-07-10T00:00:00Z',
    });
    const { context } = selectContext(sw(), [old, fresh]);
    expect(context[0]!.chunkId).toBe('new');
  });
});

describe('chunkDocument', () => {
  it('packs short paragraphs into one chunk', () => {
    const chunks = chunkDocument('Para one.\n\nPara two.', { maxChars: 2000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain('Para one.');
    expect(chunks[0]!.content).toContain('Para two.');
    expect(chunks[0]!.index).toBe(0);
  });

  it('splits when the budget is exceeded and indexes sequentially', () => {
    const big = Array.from({ length: 5 }, (_, i) => `Paragraph number ${i} with some words.`).join(
      '\n\n',
    );
    const chunks = chunkDocument(big, { maxChars: 60, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it('hard-splits a single oversized paragraph', () => {
    const monster = 'word '.repeat(200).trim();
    const chunks = chunkDocument(monster, { maxChars: 100, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(100);
  });

  it('carries overlap into the next chunk', () => {
    const text = 'Alpha bravo charlie.\n\nDelta echo foxtrot.';
    const chunks = chunkDocument(text, { maxChars: 25, overlapChars: 12 });
    expect(chunks.length).toBeGreaterThan(1);
    // Second chunk begins with tail context from the first.
    expect(chunks[1]!.content.length).toBeGreaterThan('Delta echo foxtrot.'.length);
  });

  it('estimateTokens approximates 4 chars/token', () => {
    expect(estimateTokens('12345678')).toBe(2);
  });

  it('returns nothing for empty input', () => {
    expect(chunkDocument('   ')).toEqual([]);
  });
});

describe('selectContext ranking + grounding', () => {
  it('ranks by similarity, assigns rank order', () => {
    const result = selectContext(sw(), [
      candidate({ chunkId: 'a', documentId: 'da', similarity: 0.3 }),
      candidate({ chunkId: 'b', documentId: 'db', similarity: 0.8 }),
    ]);
    expect(result.context.map((c) => c.chunkId)).toEqual(['b', 'a']);
    expect(result.context.map((c) => c.rank)).toEqual([0, 1]);
  });

  it('drops out-of-scope candidates before ranking', () => {
    const result = selectContext(sw('quad'), [
      candidate({ chunkId: 'shared', documentId: 'd1', similarity: 0.6 }),
      candidate({
        chunkId: 'harn',
        documentId: 'd2',
        similarity: 0.99,
        scope: { houseScope: 'harnwell', sensitivity: 'general', allowedRoles: [] },
      }),
    ]);
    expect(result.context.map((c) => c.chunkId)).toEqual(['shared']);
  });

  it('is grounded when a chunk meets the threshold', () => {
    const result = selectContext(sw(), [candidate({ similarity: 0.7 })], {
      groundingThreshold: 0.5,
    });
    expect(result.grounded).toBe(true);
  });

  it('is NOT grounded when every chunk is below threshold (defer path)', () => {
    const result = selectContext(sw(), [candidate({ similarity: 0.2 })], {
      groundingThreshold: 0.5,
    });
    expect(result.grounded).toBe(false);
    expect(result.context.length).toBeGreaterThan(0); // still returned, just not grounding
  });

  it('caps chunks per document', () => {
    const cands = Array.from({ length: 5 }, (_, i) =>
      candidate({ chunkId: `c${i}`, documentId: 'same', similarity: 0.9 - i * 0.01 }),
    );
    const result = selectContext(sw(), cands, { perDocumentLimit: 2, topK: 10 });
    expect(result.context).toHaveLength(2);
  });

  it('honors topK', () => {
    const cands = Array.from({ length: 10 }, (_, i) =>
      candidate({ chunkId: `c${i}`, documentId: `d${i}`, similarity: 0.9 }),
    );
    const result = selectContext(sw(), cands, { topK: 3 });
    expect(result.context).toHaveLength(3);
  });

  it('empty candidates → not grounded, empty context', () => {
    const result = selectContext(sw(), []);
    expect(result.grounded).toBe(false);
    expect(result.context).toEqual([]);
  });
});

describe('citations', () => {
  it('groups chunks by document, preserving order', () => {
    const { context } = selectContext(sw(), [
      candidate({ chunkId: 'a1', documentId: 'A', sourceRef: 'HM guide', similarity: 0.9 }),
      candidate({ chunkId: 'a2', documentId: 'A', sourceRef: 'HM guide', similarity: 0.85 }),
      candidate({ chunkId: 'b1', documentId: 'B', sourceRef: 'summer binder', similarity: 0.8 }),
    ]);
    const cites = buildCitations(context);
    expect(cites).toHaveLength(2);
    expect(cites[0]).toMatchObject({ documentId: 'A', chunkIds: ['a1', 'a2'] });
    expect(cites[1]!.documentId).toBe('B');
  });

  it('formats a citation line without dashes', () => {
    const line = formatCitationLine([
      { documentId: 'A', sourceRef: 'summer binder, keys', chunkIds: ['x'] },
      { documentId: 'B', sourceRef: 'HM guide', chunkIds: ['y'] },
    ]);
    expect(line).toBe('per summer binder, keys; per HM guide');
    expect(line).not.toMatch(/[—–]/);
  });

  it('empty citations → empty line', () => {
    expect(formatCitationLine([])).toBe('');
  });
});

describe('safety guardrails', () => {
  it('detects fire / medical / emergency-door', () => {
    expect(detectLifeSafety('there is smoke on floor 3')).toBe('fire');
    expect(detectLifeSafety('a resident is unconscious')).toBe('medical');
    expect(detectLifeSafety('someone forced open the emergency exit')).toBe('emergency_door');
  });

  it('returns null for a routine question', () => {
    expect(detectLifeSafety('how do I log a package')).toBeNull();
  });

  it('life-safety preamble pushes to the emergency line', () => {
    expect(lifeSafetyPreamble('fire')).toMatch(/emergency line/i);
    expect(lifeSafetyPreamble('medical')).toMatch(/emergency line/i);
  });

  it('flags access-decision questions', () => {
    expect(mentionsAccessDecision('can I let a contractor into the perimeter door')).toBe(true);
    expect(mentionsAccessDecision('should I unlock room 214')).toBe(true);
    expect(mentionsAccessDecision('what time does the mailroom close')).toBe(false);
  });

  it('flags incident-probe questions', () => {
    expect(looksLikeIncidentProbe('what happened the other day at Harnwell')).toBe(true);
    expect(looksLikeIncidentProbe('how do I reset the printer')).toBe(false);
  });
});

describe('deferral message', () => {
  it('includes a routing hint when provided, no dashes', () => {
    const msg = buildDeferralMessage('Contact the CSMOD on duty.');
    expect(msg).toContain('Contact the CSMOD on duty.');
    expect(msg).not.toMatch(/[—–]/);
  });

  it('falls back to a generic offer without a hint', () => {
    expect(buildDeferralMessage()).toMatch(/reach the right contact/i);
  });
});
