// Desk Assistant Phase D — redaction validators + decision parsing (V1_SCOPE §7.2).

import { describe, expect, it } from 'vitest';

import {
  containsIncidentLeakage,
  parseRedactionDecision,
  validateLesson,
} from '../../src/desk-assistant/index.js';

describe('validateLesson', () => {
  it('accepts a clean generalizable lesson', () => {
    expect(
      validateLesson('In summer, perimeter door access for outside contractors is not permitted.'),
    ).toEqual({ ok: true });
  });

  it('rejects an email address', () => {
    const r = validateLesson('Contact jane.doe@upenn.edu about the leak.');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toContain('email');
  });

  it('rejects a phone number', () => {
    const r = validateLesson('Call 215-555-1234 for the vendor.');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toContain('phone');
  });

  it('rejects a room number', () => {
    const r = validateLesson('The incident happened in room 214.');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toContain('room_number');
  });

  it('rejects explicit and numeric dates', () => {
    const a = validateLesson('On March 3 a contractor asked for access.');
    const b = validateLesson('It happened on 3/3/2026.');
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
  });

  it('rejects a named person', () => {
    const r = validateLesson('A resident named Alex was locked out.');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toContain('named_person');
  });

  it('rejects an empty lesson', () => {
    const r = validateLesson('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toContain('empty');
  });
});

describe('containsIncidentLeakage', () => {
  it('flags PII in a generated answer', () => {
    expect(containsIncidentLeakage('You should email joe@x.edu')).toBe(true);
    expect(containsIncidentLeakage('Go to room 5 and check')).toBe(true);
  });

  it('passes clean policy guidance', () => {
    expect(
      containsIncidentLeakage('Verify the resident against the roster before issuing a spare key.'),
    ).toBe(false);
  });
});

describe('parseRedactionDecision', () => {
  it('parses a lesson', () => {
    expect(parseRedactionDecision({ kind: 'lesson', lesson: 'do the thing' })).toEqual({
      kind: 'lesson',
      lesson: 'do the thing',
    });
  });

  it('parses a no_lesson', () => {
    expect(parseRedactionDecision({ kind: 'no_lesson', reason: 'private' })).toEqual({
      kind: 'no_lesson',
      reason: 'private',
    });
  });

  it('rejects malformed shapes', () => {
    expect(parseRedactionDecision(null)).toBeNull();
    expect(parseRedactionDecision({ kind: 'lesson' })).toBeNull();
    expect(parseRedactionDecision({ kind: 'other', lesson: 'x' })).toBeNull();
    expect(parseRedactionDecision('nope')).toBeNull();
  });
});
