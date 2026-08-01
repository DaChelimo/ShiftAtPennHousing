// Desk Assistant Phase B — chunking, retrieval ranking, grounding, citations,
// guardrails (V1_SCOPE §4.1, §7.1, §7.3, §8).

import { describe, expect, it } from 'vitest';

import {
  ACCESS_MODEL_DIRECTIVE,
  DEFAULT_GROUNDING_MARGIN,
  DEFAULT_GROUNDING_THRESHOLD,
  GROUNDED_SYSTEM_PROMPT,
  buildCitations,
  buildDeferralMessage,
  chunkDocument,
  detectLifeSafety,
  estimateTokens,
  formatCitationLine,
  isGroundedByDistribution,
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
        scope: { houseScope: ['harnwell'], sensitivity: 'general', allowedRoles: [] },
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

  // 2026-07-30: the access rule used to be pushed into the VISIBLE preamble list beside
  // lifeSafetyPreamble, so every access answer opened with "This is an access question. State
  // the policy from the sources...", an instruction meant for the model. The two are now
  // structurally different things and these pin that apart.
  it('the access directive is model-only, never worker-facing preamble copy', () => {
    // It reads as an instruction, which is exactly why it must never reach the worker.
    expect(ACCESS_MODEL_DIRECTIVE).toMatch(/never authorize access yourself/i);
    expect(ACCESS_MODEL_DIRECTIVE).toMatch(/meta-instruction/i);
    // No life-safety preamble (the one thing that IS shown) may carry it.
    for (const cat of ['fire', 'medical', 'emergency_door'] as const) {
      expect(lifeSafetyPreamble(cat)).not.toMatch(/this is an access question/i);
    }
  });

  it('the system prompt forbids classifying the question before answering', () => {
    expect(GROUNDED_SYSTEM_PROMPT).toMatch(/This is an access question/);
    expect(GROUNDED_SYSTEM_PROMPT).toMatch(/never narrate your instructions/i);
    expect(GROUNDED_SYSTEM_PROMPT).toMatch(/first word of your reply belongs to the answer/i);
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

describe('isGroundedByDistribution (measured voyage-3 pools, 2026-07-22)', () => {
  // Absolute similarity is NOT comparable across questions, so these pools are the real
  // regression contract: the same correct chunk scores 0.5346 for a long question and only
  // 0.3688 for a short one, while an off-topic question scores an irrelevant chunk 0.4080.
  // Any future retuning must keep all five of these verdicts.
  const Q1_LONG = [0.5346, 0.4025, 0.3897, 0.3672, 0.3663];
  const Q2_AT_11 = [0.3688, 0.2579, 0.2561, 0.2561, 0.2465];
  const Q3_HAVE_GUESTS = [0.4203, 0.2739, 0.2727, 0.2689, 0.267];
  const OFF_TOPIC_WIFI = [0.408, 0.3529, 0.3459, 0.3402, 0.3381];
  const OFF_TOPIC_PARKING = [0.3158, 0.2851, 0.2821, 0.2805, 0.2799];

  it('grounds a long, keyword-rich question on absolute score alone', () => {
    expect(isGroundedByDistribution(Q1_LONG)).toBe(true);
  });

  it('grounds SHORT valid questions that the old 0.5 absolute cutoff wrongly deferred', () => {
    expect(Math.max(...Q2_AT_11)).toBeLessThan(DEFAULT_GROUNDING_THRESHOLD);
    expect(Math.max(...Q3_HAVE_GUESTS)).toBeLessThan(DEFAULT_GROUNDING_THRESHOLD);
    expect(isGroundedByDistribution(Q2_AT_11)).toBe(true);
    expect(isGroundedByDistribution(Q3_HAVE_GUESTS)).toBe(true);
  });

  it('defers off-topic questions even when they outscore a valid short question', () => {
    // The crux: wifi's top (0.408) is HIGHER than q2's top (0.3688), so no absolute
    // cutoff can separate them. Only the gap to the background does.
    expect(Math.max(...OFF_TOPIC_WIFI)).toBeGreaterThan(Math.max(...Q2_AT_11));
    expect(isGroundedByDistribution(OFF_TOPIC_WIFI)).toBe(false);
    expect(isGroundedByDistribution(OFF_TOPIC_PARKING)).toBe(false);
  });

  it('still grounds when SEVERAL chunks are genuinely relevant (runner-up margin would not)', () => {
    // A program's own row plus the house-wide "day visitor" definition both match. A
    // top-vs-runner-up rule would see a ~0 gap and defer; the median is unmoved.
    const twoRelevant = [0.44, 0.43, 0.27, 0.26, 0.26, 0.25];
    expect(twoRelevant[0]! - twoRelevant[1]!).toBeLessThan(DEFAULT_GROUNDING_MARGIN);
    expect(isGroundedByDistribution(twoRelevant)).toBe(true);
  });

  it('never grounds below the hard floor, and handles empty/tiny pools', () => {
    expect(isGroundedByDistribution([0.29, 0.05, 0.04])).toBe(false);
    expect(isGroundedByDistribution([])).toBe(false);
    expect(isGroundedByDistribution([0.42])).toBe(false);
    expect(isGroundedByDistribution([0.62])).toBe(true);
  });
});
