// Desk Assistant Phase B2 — pin the Deno ask-time mirror to core.
//
// supabase/functions/_shared/desk-assistant.ts is a hand copy of the pure logic
// da-ask needs at runtime (Deno cannot import the workspace). This test imports
// BOTH and asserts they agree, so the two can never silently drift. The mirror is
// pure (no Deno globals), so it imports cleanly here.

import { describe, expect, it } from 'vitest';

import * as mirror from '../../../../supabase/functions/_shared/desk-assistant.ts';
import * as core from '../../src/desk-assistant/index.js';

describe('mirror constants match core', () => {
  it('grounded system prompt is identical', () => {
    expect(mirror.GROUNDED_SYSTEM_PROMPT).toBe(core.GROUNDED_SYSTEM_PROMPT);
  });

  it('incident-probe refusal is identical', () => {
    expect(mirror.INCIDENT_PROBE_REFUSAL).toBe(core.INCIDENT_PROBE_REFUSAL);
  });

  it('deferral messages match (with and without hint)', () => {
    expect(mirror.buildDeferralMessage()).toBe(core.buildDeferralMessage());
    expect(mirror.buildDeferralMessage('Contact the CSMOD.')).toBe(
      core.buildDeferralMessage('Contact the CSMOD.'),
    );
  });

  it('life-safety preambles match', () => {
    for (const cat of ['fire', 'medical', 'emergency_door'] as const) {
      expect(mirror.lifeSafetyPreamble(cat)).toBe(core.lifeSafetyPreamble(cat));
    }
  });

  it('retrieval constants match', () => {
    expect(mirror.DEFAULT_TOP_K).toBe(core.DEFAULT_TOP_K);
    expect(mirror.DEFAULT_GROUNDING_THRESHOLD).toBe(core.DEFAULT_GROUNDING_THRESHOLD);
    expect(mirror.DEFAULT_PER_DOCUMENT_LIMIT).toBe(core.DEFAULT_PER_DOCUMENT_LIMIT);
    expect(mirror.OVERLAY_TOLERANCE).toBe(core.OVERLAY_TOLERANCE);
  });
});

describe('mirror detectors agree with core', () => {
  const battery = [
    'there is smoke on floor 3',
    'a resident is unconscious',
    'someone forced open the emergency exit',
    'how do I log a package',
    'can I let a contractor into the perimeter door',
    'should I unlock room 214',
    'what time does the mailroom close',
    'what happened the other day at Harnwell',
    'how do I reset the printer',
  ];

  it('detectLifeSafety agrees', () => {
    for (const q of battery) expect(mirror.detectLifeSafety(q)).toBe(core.detectLifeSafety(q));
  });

  it('mentionsAccessDecision agrees', () => {
    for (const q of battery)
      expect(mirror.mentionsAccessDecision(q)).toBe(core.mentionsAccessDecision(q));
  });

  it('looksLikeIncidentProbe agrees', () => {
    for (const q of battery)
      expect(mirror.looksLikeIncidentProbe(q)).toBe(core.looksLikeIncidentProbe(q));
  });

  it('containsIncidentLeakage agrees', () => {
    const leakBattery = [
      'You should email joe@x.edu',
      'Go to room 5 and check',
      'Call 215-555-1234',
      'A resident named Alex was locked out',
      'On March 3 a contractor asked',
      'Verify the resident against the roster before issuing a spare key.',
    ];
    for (const q of leakBattery) {
      expect(mirror.containsIncidentLeakage(q)).toBe(core.containsIncidentLeakage(q));
    }
  });
});

describe('narrowContext parity with selectContext (scope aside)', () => {
  // A permissive requester so core's scope filter is a no-op; then narrowing +
  // grounding must match between the two implementations.
  const requester: core.RequesterContext = {
    userId: 'u',
    homeHouseId: 'harnwell',
    roles: ['sw'],
    isActive: true,
    isAdmin: true,
    isRsm: true,
    houseAdminOf: [],
  };
  const shared: core.ItemScope = { houseScope: null, sensitivity: 'general', allowedRoles: [] };

  const rows = [
    {
      chunkId: 'a',
      documentId: 'D1',
      content: 'x',
      sourceRef: 'ref1',
      houseScope: null,
      similarity: 0.9,
    },
    {
      chunkId: 'b',
      documentId: 'D1',
      content: 'y',
      sourceRef: 'ref1',
      houseScope: null,
      similarity: 0.85,
    },
    {
      chunkId: 'c',
      documentId: 'D1',
      content: 'z',
      sourceRef: 'ref1',
      houseScope: null,
      similarity: 0.8,
    },
    {
      chunkId: 'd',
      documentId: 'D1',
      content: 'w',
      sourceRef: 'ref1',
      houseScope: null,
      similarity: 0.7,
    },
    {
      chunkId: 'e',
      documentId: 'D2',
      content: 'q',
      sourceRef: 'ref2',
      houseScope: null,
      similarity: 0.4,
    },
  ];

  it('produces the same chunk order and grounded flag', () => {
    const mirrorRes = mirror.narrowContext(rows);
    const coreRes = core.selectContext(
      requester,
      rows.map((r) => ({ ...r, scope: shared })),
    );
    expect(mirrorRes.context.map((c) => c.chunkId)).toEqual(coreRes.context.map((c) => c.chunkId));
    expect(mirrorRes.grounded).toBe(coreRes.grounded);
    // per-document cap of 3 drops the 4th D1 chunk
    expect(mirrorRes.context.map((c) => c.chunkId)).toEqual(['a', 'b', 'c', 'e']);
  });
});

describe('query classification parity with core', () => {
  const battery = [
    'Who is the HMOD right now?',
    'Who do I contact next Tuesday?',
    'should I reach the RSM for this?',
    'Who can sign out a cart at Harnwell?',
    'How long can a resident keep a cart?',
    'who is the point of contact today',
    'The HM next Tuesday is Mary',
  ];

  it('classifyQuery agrees', () => {
    for (const q of battery) {
      expect(mirror.classifyQuery(q)).toEqual(core.classifyQuery(q));
    }
  });

  it('resolveAsOfDate agrees', () => {
    for (const q of battery) {
      expect(mirror.resolveAsOfDate(q, '2026-07-11')).toBe(core.resolveAsOfDate(q, '2026-07-11'));
    }
  });

  it('looksLikeFactAssertion agrees', () => {
    for (const q of battery) {
      expect(mirror.looksLikeFactAssertion(q)).toBe(core.looksLikeFactAssertion(q));
    }
  });
});
