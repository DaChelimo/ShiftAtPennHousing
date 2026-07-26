// Desk Assistant — intake proposer parser (INTAKE_PLAN Phase 2).

import { describe, expect, it } from 'vitest';

import {
  indexableItems,
  parseProposedDoc,
  proposeSystemPrompt,
  structuredLeaveItems,
} from '../../src/desk-assistant/index.js';

const durableItem = {
  content: 'Do not page HMOD during business hours.',
  kind: 'durable_rule',
  window: { temporality: 'durable', effectiveFrom: null, effectiveUntil: null },
  routingNote: null,
};

const validDoc = {
  title: 'Harnwell RSM updates, Jul 10',
  sourceType: 'summer_binder',
  sourceRef: 'Harnwell IC email, RSM Taye',
  houseScope: 'harnwell',
  sensitivity: 'general',
  allowedRoles: ['sw', 'sm'],
  items: [
    durableItem,
    {
      content: 'Celine Walker is the backup BA contact.',
      kind: 'dated_announcement',
      window: { temporality: 'expires', effectiveFrom: '2026-07-14', effectiveUntil: '2026-07-14' },
      routingNote: null,
    },
    {
      content: 'Michelle out 7/10 to 7/17.',
      kind: 'structured_leave',
      window: { temporality: 'expires', effectiveFrom: '2026-07-10', effectiveUntil: '2026-07-17' },
      routingNote: 'Enter via the hm_leave path; do not index.',
    },
  ],
  representations: {},
};

describe('proposeSystemPrompt', () => {
  it('injects the anchor date for relative-date resolution', () => {
    expect(proposeSystemPrompt('2026-07-10', ['harnwell', 'quad'])).toContain('2026-07-10');
  });

  it('lists the exact valid house ids so the model cannot invent an abbreviation', () => {
    const prompt = proposeSystemPrompt('2026-07-10', ['harnwell', 'quad']);
    expect(prompt).toContain('harnwell|quad');
  });
});

describe('parseProposedDoc', () => {
  it('accepts a well-formed proposal and narrows its items', () => {
    const doc = parseProposedDoc(validDoc);
    expect(doc).not.toBeNull();
    expect(doc!.items).toHaveLength(3);
    expect(doc!.allowedRoles).toEqual(['sw', 'sm']);
  });

  it('splits indexable items from structured-leave items', () => {
    const doc = parseProposedDoc(validDoc)!;
    expect(indexableItems(doc).map((i) => i.kind)).toEqual(['durable_rule', 'dated_announcement']);
    expect(structuredLeaveItems(doc)).toHaveLength(1);
    expect(structuredLeaveItems(doc)[0]!.routingNote).toContain('hm_leave');
  });

  it('rejects an unknown sourceType', () => {
    expect(parseProposedDoc({ ...validDoc, sourceType: 'random' })).toBeNull();
  });

  it('drops an item with an invalid window but keeps valid ones', () => {
    const doc = parseProposedDoc({
      ...validDoc,
      items: [
        durableItem,
        {
          content: 'bad window',
          kind: 'dated_announcement',
          window: {
            temporality: 'expires',
            effectiveFrom: '2026-07-17',
            effectiveUntil: '2026-07-10',
          },
          routingNote: null,
        },
      ],
    });
    expect(doc!.items).toHaveLength(1);
  });

  it('rejects a document with zero valid items', () => {
    expect(parseProposedDoc({ ...validDoc, items: [] })).toBeNull();
    expect(
      parseProposedDoc({ ...validDoc, items: [{ content: '', kind: 'durable_rule' }] }),
    ).toBeNull();
  });

  it('filters allowedRoles to known roles and defaults sensitivity', () => {
    const doc = parseProposedDoc({
      ...validDoc,
      allowedRoles: ['sw', 'bogus'],
      sensitivity: 'weird',
    })!;
    expect(doc.allowedRoles).toEqual(['sw']);
    expect(doc.sensitivity).toBe('general');
  });

  it('wraps a single house-id guess into the array shape', () => {
    expect(parseProposedDoc(validDoc)!.houseScope).toEqual(['harnwell']);
  });

  it('keeps a null houseScope (shared corpus) but rejects a non-string one', () => {
    expect(parseProposedDoc({ ...validDoc, houseScope: null })!.houseScope).toBeNull();
    expect(parseProposedDoc({ ...validDoc, houseScope: 42 })).toBeNull();
  });

  it('carries the redaction split when present', () => {
    const doc = parseProposedDoc({
      ...validDoc,
      representations: { rawRecord: 'raw text', deIdentifiedLesson: 'a general lesson' },
    })!;
    expect(doc.representations.deIdentifiedLesson).toBe('a general lesson');
  });
});
