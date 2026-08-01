// Desk Assistant Phase B2 — pin the Deno ask-time mirror to core.
//
// supabase/functions/_shared/desk-assistant.ts is a hand copy of the pure logic
// da-ask needs at runtime (Deno cannot import the workspace). This test imports
// BOTH and asserts they agree, so the two can never silently drift. The mirror is
// pure (no Deno globals), so it imports cleanly here.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as mirror from '../../../../supabase/functions/_shared/desk-assistant.ts';
import * as core from '../../src/desk-assistant/index.js';

describe('mirror constants match core', () => {
  it('grounded system prompt is identical', () => {
    expect(mirror.GROUNDED_SYSTEM_PROMPT).toBe(core.GROUNDED_SYSTEM_PROMPT);
  });

  it('access model directive is identical', () => {
    expect(mirror.ACCESS_MODEL_DIRECTIVE).toBe(core.ACCESS_MODEL_DIRECTIVE);
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

  it('em/en dash stripping is identical', () => {
    for (const s of ['a—b', 'Mon–Fri', 'Yes — but only day visitors.', '9:00–17:00', 'plain']) {
      expect(mirror.stripEmDashes(s)).toBe(core.stripEmDashes(s));
    }
  });

  it('life-safety preambles match', () => {
    for (const cat of ['fire', 'medical', 'emergency_door'] as const) {
      expect(mirror.lifeSafetyPreamble(cat)).toBe(core.lifeSafetyPreamble(cat));
    }
  });

  it('retrieval constants match', () => {
    expect(mirror.DEFAULT_TOP_K).toBe(core.DEFAULT_TOP_K);
    expect(mirror.DEFAULT_GROUNDING_THRESHOLD).toBe(core.DEFAULT_GROUNDING_THRESHOLD);
    expect(mirror.DEFAULT_GROUNDING_FLOOR).toBe(core.DEFAULT_GROUNDING_FLOOR);
    expect(mirror.DEFAULT_GROUNDING_MARGIN).toBe(core.DEFAULT_GROUNDING_MARGIN);
    expect(mirror.DEFAULT_PER_DOCUMENT_LIMIT).toBe(core.DEFAULT_PER_DOCUMENT_LIMIT);
    expect(mirror.OVERLAY_TOLERANCE).toBe(core.OVERLAY_TOLERANCE);
  });

  it('grounding decision agrees on the measured 2026-07-22 similarity pools', () => {
    // Real voyage-3 pools captured against the Harnwell summer binder. The first three are
    // valid MindCore guest questions (must ground); the last two are off topic (must defer).
    const pools: Array<[string, number[]]> = [
      ['q1 long guest question', [0.5346, 0.4025, 0.3897, 0.3672, 0.3663]],
      ['q2 "guests at 11?"', [0.3688, 0.2579, 0.2561, 0.2561, 0.2465]],
      ['q3 "can they have guests?"', [0.4203, 0.2739, 0.2727, 0.2689, 0.267]],
      ['off topic wifi password', [0.408, 0.3529, 0.3459, 0.3402, 0.3381]],
      ['off topic parking permit', [0.3158, 0.2851, 0.2821, 0.2805, 0.2799]],
    ];
    for (const [label, pool] of pools) {
      expect(mirror.isGroundedByDistribution(pool), label).toBe(
        core.isGroundedByDistribution(pool),
      );
    }
  });
});

// da-ask is Deno and has no unit test of its own, which is how a model instruction shipped
// as the visible first paragraph of every access answer (2026-07-30). This pins the one
// structural property that kept it invisible: WORKER-FACING preambles and MODEL-ONLY
// directives are separate lists, and only the former is streamed and persisted.
describe('da-ask keeps model directives out of the worker-facing preamble', () => {
  const source = readFileSync(
    new URL('../../../../supabase/functions/da-ask/index.ts', import.meta.url),
    'utf8',
  );
  // The declaration + every push, ending at the `contextBlock` build that follows it.
  const framingBlock = source.slice(
    source.indexOf('const preambles: string[] = []'),
    source.indexOf('const contextBlock'),
  );

  it('the visible preamble list is life-safety only', () => {
    expect(framingBlock).not.toBe('');
    const pushes = [...framingBlock.matchAll(/preambles\.push\(([\s\S]*?)\);/g)].map((m) =>
      m[1]!.trim(),
    );
    expect(pushes).toEqual(['lifeSafetyPreamble(lifeSafety)']);
  });

  it('the access directive is only ever put on the system prompt', () => {
    expect(framingBlock).toMatch(/systemDirectives\.push\(ACCESS_MODEL_DIRECTIVE\)/);
    // It reaches the model through `system:`, and through nothing else.
    expect(source).toMatch(/system: systemPrompt/);
    expect(source).not.toMatch(/preambles.*ACCESS_MODEL_DIRECTIVE/);
  });

  it('no hardcoded instruction text is streamed to the worker', () => {
    // The literal that shipped, plus the shape of it. Directives live in core, not inline here.
    expect(source).not.toMatch(/This is an access question/i);
    expect(source).not.toMatch(/State the policy from the sources/i);
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
    'who is the Building Administrator this week?',
    'should I call the SMOD about this access issue?',
    'who handles conference guests, the CSMOD?',
    "What's my next shift?",
    'Am I working this weekend?',
    'How many hours do I have this week?',
    'How do I reset the printer?',
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
