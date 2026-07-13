// Desk Assistant — query classification + as-of date resolution (INTAKE_PLAN section 4a).

import { describe, expect, it } from 'vitest';

import {
  classifyQuery,
  looksLikeFactAssertion,
  resolveAsOfDate,
} from '../../src/desk-assistant/index.js';

describe('classifyQuery', () => {
  it('routes a who-is-on-duty question to the duty tool', () => {
    const c = classifyQuery('Who is the HMOD right now?');
    expect(c.intent).toBe('duty_contact');
    expect(c.tier).toBe('hmod');
  });

  it('routes "who do I contact next Tuesday" as a dated contact question', () => {
    const c = classifyQuery('Who do I contact next Tuesday?');
    expect(c.intent).toBe('duty_contact');
    expect(c.hasTemporalReference).toBe(true);
  });

  it('detects the RSM tier and point-of-contact phrasing', () => {
    expect(classifyQuery('who is the point of contact today').intent).toBe('duty_contact');
    expect(classifyQuery('should I reach the RSM for this?').tier).toBe('rsm');
  });

  it('detects the BA, SMOD, and CSMOD tiers distinctly', () => {
    expect(classifyQuery('who is the Building Administrator this week?').tier).toBe('ba');
    expect(classifyQuery('should I call the SMOD about this access issue?').tier).toBe('smod');
    expect(classifyQuery('who do I reach for a conference guest, the CSMOD?').tier).toBe('csmod');
  });

  it('does NOT misroute a procedural who-question to the duty tool', () => {
    // "who can sign out a cart" is a policy question, not a contact question.
    const c = classifyQuery('Who can sign out a cart at Harnwell?');
    expect(c.intent).toBe('durable_knowledge');
    expect(c.tier).toBeNull();
  });

  it('classifies a plain procedure question as durable knowledge', () => {
    expect(classifyQuery('How long can a resident keep a cart?').intent).toBe('durable_knowledge');
  });
});

describe('resolveAsOfDate', () => {
  const today = '2026-07-11'; // a Saturday

  it('returns null when no date is referenced (caller uses today)', () => {
    expect(resolveAsOfDate('who is the HMOD?', today)).toBeNull();
  });

  it('resolves tomorrow and today', () => {
    expect(resolveAsOfDate('who is on duty tomorrow?', today)).toBe('2026-07-12');
    expect(resolveAsOfDate('who is on tonight?', today)).toBe('2026-07-11');
  });

  it('resolves the coming weekday', () => {
    // From Sat 7/11, "next Tuesday" is 7/14.
    expect(resolveAsOfDate('who is the contact next Tuesday?', today)).toBe('2026-07-14');
  });

  it('a weekday asked on that same weekday means next week', () => {
    // From Sat 7/11, "on Saturday" resolves to the following Saturday 7/18.
    expect(resolveAsOfDate('who covers on Saturday?', today)).toBe('2026-07-18');
  });

  it('resolves numeric and month-name dates', () => {
    expect(resolveAsOfDate('who is on 7/14?', today)).toBe('2026-07-14');
    expect(resolveAsOfDate('who is the RSM on July 14?', today)).toBe('2026-07-14');
  });
});

describe('looksLikeFactAssertion', () => {
  it('flags a worker asserting a contact fact', () => {
    expect(looksLikeFactAssertion('The HM next Tuesday is Mary')).toBe(true);
  });

  it('does not flag a genuine question', () => {
    expect(looksLikeFactAssertion('Who is the HM next Tuesday?')).toBe(false);
  });
});
