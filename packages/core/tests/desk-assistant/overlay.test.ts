// Desk Assistant Phase C — per-house overlay precedence (V1_SCOPE §6.2).

import { describe, expect, it } from 'vitest';

import {
  applyOverlayPrecedence,
  isHomeOverlay,
  OVERLAY_TOLERANCE,
  overlayBoost,
  selectContext,
  type ItemScope,
  type RequesterContext,
  type RetrievalCandidate,
} from '../../src/desk-assistant/index.js';

describe('overlay helpers', () => {
  it('isHomeOverlay only for a matching non-null house', () => {
    expect(isHomeOverlay('quad', 'quad')).toBe(true);
    expect(isHomeOverlay('quad', 'harnwell')).toBe(false);
    expect(isHomeOverlay(null, 'quad')).toBe(false);
    expect(isHomeOverlay('quad', null)).toBe(false);
  });

  it('overlayBoost is the tolerance for a home overlay, else 0', () => {
    expect(overlayBoost('quad', 'quad')).toBe(OVERLAY_TOLERANCE);
    expect(overlayBoost('quad', 'harnwell')).toBe(0);
    expect(overlayBoost(null, 'quad')).toBe(0);
  });
});

describe('applyOverlayPrecedence', () => {
  const item = (chunkId: string, similarity: number, houseScope: string | null) => ({
    chunkId,
    similarity,
    houseScope,
  });

  it('a home overlay wins over a shared chunk within tolerance', () => {
    const ranked = applyOverlayPrecedence(
      [item('shared', 0.8, null), item('overlay', 0.76, 'quad')],
      'quad',
    );
    expect(ranked[0]!.chunkId).toBe('overlay'); // 0.76 + 0.05 = 0.81 > 0.80
  });

  it('a clearly better shared chunk still wins beyond tolerance', () => {
    const ranked = applyOverlayPrecedence(
      [item('shared', 0.8, null), item('overlay', 0.74, 'quad')],
      'quad',
    );
    expect(ranked[0]!.chunkId).toBe('shared'); // 0.74 + 0.05 = 0.79 < 0.80
  });

  it('a non-home overlay gets no boost', () => {
    const ranked = applyOverlayPrecedence(
      [item('shared', 0.8, null), item('harnwell', 0.76, 'harnwell')],
      'quad',
    );
    expect(ranked[0]!.chunkId).toBe('shared');
  });

  it('no home house → pure similarity order', () => {
    const ranked = applyOverlayPrecedence(
      [item('overlay', 0.76, 'quad'), item('shared', 0.8, null)],
      null,
    );
    expect(ranked.map((r) => r.chunkId)).toEqual(['shared', 'overlay']);
  });
});

describe('selectContext with requesterHouseId', () => {
  const shared: ItemScope = { houseScope: null, sensitivity: 'general', allowedRoles: [] };
  const quadScope: ItemScope = { houseScope: 'quad', sensitivity: 'general', allowedRoles: [] };

  function quadSw(): RequesterContext {
    return {
      userId: 'u',
      homeHouseId: 'quad',
      roles: ['sw'],
      isActive: true,
      isAdmin: false,
      isRsm: false,
      houseAdminOf: [],
    };
  }

  const cand = (
    chunkId: string,
    documentId: string,
    similarity: number,
    scope: ItemScope,
  ): RetrievalCandidate => ({
    chunkId,
    documentId,
    content: 'x',
    sourceRef: 'ref',
    scope,
    similarity,
  });

  it('promotes the home overlay within tolerance', () => {
    const res = selectContext(
      quadSw(),
      [cand('shared', 'D1', 0.8, shared), cand('overlay', 'D2', 0.77, quadScope)],
      { requesterHouseId: 'quad' },
    );
    expect(res.context[0]!.chunkId).toBe('overlay');
  });

  it('without requesterHouseId, ranking is pure similarity', () => {
    const res = selectContext(quadSw(), [
      cand('shared', 'D1', 0.8, shared),
      cand('overlay', 'D2', 0.77, quadScope),
    ]);
    expect(res.context[0]!.chunkId).toBe('shared');
  });

  it('overlay boost does not manufacture grounding (raw similarity governs)', () => {
    // Overlay raw 0.48 (< 0.5 threshold); boost would push effective to 0.53 but
    // grounding must stay false.
    const res = selectContext(quadSw(), [cand('overlay', 'D2', 0.48, quadScope)], {
      requesterHouseId: 'quad',
      groundingThreshold: 0.5,
    });
    expect(res.grounded).toBe(false);
  });
});
