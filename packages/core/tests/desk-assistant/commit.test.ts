// Desk Assistant — shared KB write-row builders (INTAKE_PLAN Phase 3 / section 5).

import { describe, expect, it } from 'vitest';

import {
  buildKbChunkRows,
  buildKbDocumentRow,
  type KbDocMeta,
} from '../../src/desk-assistant/index.js';

const meta: KbDocMeta = {
  title: 'Harnwell keys',
  sourceType: 'summer_binder',
  sourceRef: 'Harnwell summer binder, keys',
  houseScope: ['harnwell'],
  sensitivity: 'internal',
  allowedRoles: ['sw', 'sm'],
};

describe('buildKbDocumentRow', () => {
  it('defaults to a durable window with null bounds', () => {
    const row = buildKbDocumentRow(meta);
    expect(row).toMatchObject({
      source_type: 'summer_binder',
      house_scope: ['harnwell'],
      temporality: 'durable',
      effective_from: null,
      effective_until: null,
    });
  });

  it('carries an explicit document window', () => {
    const row = buildKbDocumentRow({
      ...meta,
      window: { temporality: 'expires', effectiveFrom: '2026-07-10', effectiveUntil: '2026-07-17' },
    });
    expect(row.temporality).toBe('expires');
    expect(row.effective_until).toBe('2026-07-17');
  });
});

describe('buildKbChunkRows', () => {
  it('denormalizes doc scope onto each chunk and indexes by position', () => {
    const rows = buildKbChunkRows(meta, [
      { content: 'a', tokenCount: 1 },
      { content: 'b', tokenCount: 2 },
    ]);
    expect(rows.map((r) => r.chunk_index)).toEqual([0, 1]);
    expect(rows[0]!.house_scope).toEqual(['harnwell']);
    expect(rows[0]!.sensitivity).toBe('internal');
    expect(rows.every((r) => r.temporality === 'durable')).toBe(true);
  });

  it('lets a chunk carry a narrower window than the document (the dated-item case)', () => {
    const rows = buildKbChunkRows(meta, [
      { content: 'durable rule', tokenCount: 3 },
      {
        content: 'Celine is backup BA',
        tokenCount: 4,
        window: {
          temporality: 'expires',
          effectiveFrom: '2026-07-14',
          effectiveUntil: '2026-07-14',
        },
      },
    ]);
    expect(rows[0]!.temporality).toBe('durable');
    expect(rows[1]!.temporality).toBe('expires');
    expect(rows[1]!.effective_until).toBe('2026-07-14');
  });
});
