// Desk Assistant Phase D — redaction validators + decision parsing (V1_SCOPE §7.2).

import { describe, expect, it } from 'vitest';

import {
  containsIncidentLeakage,
  stripEmDashes,
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

describe('containsIncidentLeakage — grounded-source narrowing (V1_SCOPE §7.2)', () => {
  // The Harnwell binder's most important answers ARE phone numbers and program dates.
  const SOURCES = [
    '[Source 1] (Summer IC Binder)',
    'During non-business hours, if the problem is a facilities emergency impacting resident or',
    'guest safety/security (flood, fire, power outage, etc.), call Facilities at 215-898-7208,',
    'then call the Harnwell Info Center at 8-6873 and ask for the HMOD to be paged.',
    '2026 MindCore Summer Fellowship resides in Harnwell from Sunday, May 31, 2026 to',
    'Saturday, August 8, 2026. Day visitors are allowed; overnight guests are not allowed.',
  ].join(' ');

  it('allows an answer to quote a phone number that its own sources contain', () => {
    const answer = 'Call Facilities at 215-898-7208, then page the HMOD via the Info Center.';
    expect(containsIncidentLeakage(answer)).toBe(true); // old behaviour: false positive
    expect(containsIncidentLeakage(answer, SOURCES)).toBe(false);
  });

  it('allows an answer to restate program dates that its own sources contain', () => {
    const answer = 'MindCore residents are in Harnwell from May 31, 2026 to August 8, 2026.';
    expect(containsIncidentLeakage(answer)).toBe(true); // old behaviour: false positive
    expect(containsIncidentLeakage(answer, SOURCES)).toBe(false);
  });

  it('still catches a phone number the sources do NOT contain', () => {
    expect(containsIncidentLeakage('Call the resident on 215-555-0199.', SOURCES)).toBe(true);
  });

  it('still catches a date, room, name, or email the sources do NOT contain', () => {
    expect(containsIncidentLeakage('On March 4 a resident was locked out.', SOURCES)).toBe(true);
    expect(containsIncidentLeakage('The issue was in room 214.', SOURCES)).toBe(true);
    expect(containsIncidentLeakage('A student named Priya reported it.', SOURCES)).toBe(true);
    expect(containsIncidentLeakage('Email them at someone@upenn.edu.', SOURCES)).toBe(true);
  });

  it('is unchanged when no grounding text is supplied', () => {
    expect(containsIncidentLeakage('Call 215-898-7208.')).toBe(true);
    expect(containsIncidentLeakage('No specifics here at all.')).toBe(false);
  });
});

describe('containsIncidentLeakage — month-abbreviation folding', () => {
  // Observed 2026-07-22: the model wrote "Aug 8" where the source said "August 8", and an
  // exact substring check treated the faithfully-copied date as invented, retracting a
  // correct answer mid-stream.
  const SOURCES =
    'MindCore resides in Harnwell from Sunday, May 31, 2026 to Saturday, August 8, 2026.';

  it('accepts an abbreviated month that the source spells out', () => {
    expect(containsIncidentLeakage('Residing May 31 to Aug 8, 2026.', SOURCES)).toBe(false);
    expect(containsIncidentLeakage('Residing May 31 to Aug. 8, 2026.', SOURCES)).toBe(false);
  });

  it('accepts a spelled-out month across a source line break', () => {
    expect(containsIncidentLeakage('Ends August 8.', 'ends August\n8 of that year')).toBe(false);
  });

  it('still catches a date the source does not mention at all', () => {
    expect(containsIncidentLeakage('It happened on Sep 4.', SOURCES)).toBe(true);
  });
});

describe('stripEmDashes (project convention: no em/en dashes in surfaced copy)', () => {
  it('turns a clause-break em dash into a comma', () => {
    expect(stripEmDashes('Call Facilities — then page the HMOD.')).toBe(
      'Call Facilities, then page the HMOD.',
    );
    expect(stripEmDashes('Call Facilities—then page the HMOD.')).toBe(
      'Call Facilities, then page the HMOD.',
    );
  });

  it('keeps an en-dash RANGE as a hyphen, not a comma', () => {
    expect(stripEmDashes('Business hours are Mon–Fri, 8am–5pm.')).toBe(
      'Business hours are Mon-Fri, 8am-5pm.',
    );
    expect(stripEmDashes('The window is 9:00–17:00.')).toBe('The window is 9:00-17:00.');
  });

  it('does not double up punctuation the model already wrote', () => {
    expect(stripEmDashes('Guests must leave by 10 pm — .')).toBe('Guests must leave by 10 pm.');
    expect(stripEmDashes('Yes — but only day visitors.')).toBe('Yes, but only day visitors.');
  });

  it('leaves hyphens and ordinary text alone', () => {
    expect(stripEmDashes('The check-in desk is on the ground floor.')).toBe(
      'The check-in desk is on the ground floor.',
    );
    expect(stripEmDashes('No dashes here at all.')).toBe('No dashes here at all.');
  });

  it('leaves no em or en dash in any output', () => {
    for (const s of ['a—b', 'a – b', 'x–y', '— lead', 'trail —', 'Mon–Fri — daily']) {
      expect(stripEmDashes(s)).not.toMatch(/[—–]/);
    }
  });
});
