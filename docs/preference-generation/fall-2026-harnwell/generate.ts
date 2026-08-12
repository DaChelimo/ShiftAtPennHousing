// Generates the Fall 2026 Harnwell preference package for review.
//
//   npx tsx docs/preference-generation/fall-2026-harnwell/generate.ts
//
// Pure and offline: no database, no clock. It models the fall template week from the
// season parameters in season.sql and runs the persona generator over the frozen roster
// below. Because block identity in the generator is POSITIONAL (spec §8), the package
// produced here is the same package that results from binding real block_ids after the
// season is applied — which is what lets this be reviewed before the season exists.
//
// Re-running always reproduces the same bytes. The checksum in the output is what the
// apply step re-verifies before writing anything.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  generatePreferencePackage,
  type PrefGenBlock,
} from '../../../packages/core/src/preference-generation/index.js';

// --- Season parameters. Must match season.sql. ------------------------------------
const SEASON_ID = 'fa112026-0000-4000-8000-000000000001';
const PERIOD_ID = SEASON_ID; // apply_compiled_season materializes period_id == season_id
const TEMPLATE_WEEK_MONDAY = '2026-08-24';
const DESK_OPEN_MIN = 8 * 60; // 08:00
const DESK_CLOSE_MIN = 24 * 60; // 00:00 == 24:00 of the same day
const HEADCOUNT = 2;
const CAP_HOURS = 20;
// Chosen, not defaulted, and the name is an opaque token — only the string matters.
//
// A 28-person roster is small enough that the ~7% opt-out, ~5% non-submitter, and
// unwanted-block outcomes all have high variance, so many seeds produce a board that
// exercises none of them. This one draws all three: 1 opt-out, 1 never-submitted, and 3h
// of blocks nobody wants (weekend mornings). Selected by scanning candidate seeds against
// this exact roster for that coverage, not for prettier numbers — every candidate passed
// all four guarantees.
const SEED = 'harnwell-fall-2026-v2';

// --- Roster: active Harnwell SW + SM, read from the Shift project 2026-08-11. -------
// Frozen here on purpose. A package is only reviewable if the roster it was generated
// against is pinned; the apply step re-reads the live roster and refuses on any drift.
const ROSTER: { userId: string; name: string; role: 'sw' | 'sm' }[] = [
  { userId: 'fbb00000-0000-4000-8000-000000000002', name: 'Jesse Kiptum', role: 'sm' },
  { userId: 'fbb00000-0000-4000-8000-000000000008', name: 'Allan Kamau', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000015', name: "Austin Ng'ang'a", role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000016', name: 'Beatrice Nafula', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000026', name: 'Brian Otieno', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000001', name: 'Britney Njiri', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000012', name: 'Collins Odhiambo', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000027', name: 'Cynthia Nyaboke', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000029', name: 'Dennis Kiprotich', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000022', name: 'Diana Chebet', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000007', name: 'Elvis Barasa', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000025', name: 'Esther Wambui', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000023', name: 'Faith Wanjiru', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000024', name: 'George Omondi', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000014', name: 'Ian Kalya', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000005', name: 'Joel Peter', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000013', name: 'John Akweya', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000021', name: 'Jotham Siror', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000006', name: 'Kevin Mutiso', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000018', name: 'Linet Achieng', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000019', name: 'Maureen Muthoni', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000028', name: 'Moses Kiprono', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000011', name: 'Patrick Mwangi', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000009', name: 'Sharon Adhiambo', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000004', name: 'Simon Kimani', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000003', name: 'Vicky Lenah', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000020', name: 'Willy Karanei', role: 'sw' },
  { userId: 'fbb00000-0000-4000-8000-000000000017', name: 'Winnie Chepkoech', role: 'sw' },
];

// --- Template week ------------------------------------------------------------------
// Slot keys, not uuids: the real block_ids do not exist until the season is applied.
// `bindSlotsToBlockIds` in apply.md maps these one-to-one.
function templateWeek(): PrefGenBlock[] {
  const blocks: PrefGenBlock[] = [];
  for (let weekday = 0; weekday <= 6; weekday++) {
    for (let m = DESK_OPEN_MIN; m < DESK_CLOSE_MIN; m += 30) {
      blocks.push({
        blockId: `${String(weekday)}:${String(m)}`,
        weekday,
        minuteOfDay: m,
        requiredHeadcount: HEADCOUNT,
      });
    }
  }
  return blocks;
}

const blocks = templateWeek();
const pkg = generatePreferencePackage(
  blocks,
  ROSTER.map((r) => r.userId),
  PERIOD_ID,
  { seed: SEED, capHours: CAP_HOURS },
);

const nameOf = new Map(ROSTER.map((r) => [r.userId, r.name]));
const roleOf = new Map(ROSTER.map((r) => [r.userId, r.role]));

const output = {
  kind: 'preference-package',
  spec: 'docs/preference-generation/PERSONA_SPEC.md',
  season: {
    seasonId: SEASON_ID,
    periodId: PERIOD_ID,
    name: 'Fall 2026',
    house: 'harnwell',
    templateWeekMonday: TEMPLATE_WEEK_MONDAY,
    deskOpenMin: DESK_OPEN_MIN,
    deskCloseMin: DESK_CLOSE_MIN,
    requiredHeadcount: HEADCOUNT,
    capHours: CAP_HOURS,
    capEnforcement: 'soft',
  },
  generator: { seed: SEED, blocks: blocks.length },
  report: pkg.report,
  workers: pkg.workers.map((w) => ({
    userId: w.userId,
    name: nameOf.get(w.userId) ?? w.userId,
    role: roleOf.get(w.userId) ?? 'sw',
    personaLabel: w.personaLabel,
    persona: w.persona,
    targetHours: w.targetHours,
    submitted: w.submitted,
    optedOut: w.optedOut,
    preferredHours: w.entries.filter((e) => e.status === 'preferred').length / 2,
    preferred: w.entries.filter((e) => e.status === 'preferred').map((e) => e.blockId),
    cannot: w.entries.filter((e) => e.status === 'cannot').map((e) => e.blockId),
  })),
};

// The checksum covers only what gets written to the database, so a change to presentation
// metadata cannot silently invalidate an approved package.
const material = JSON.stringify(
  pkg.workers.map((w) => [w.userId, w.targetHours, w.optedOut, w.submitted, w.entries]),
);
const checksum = createHash('sha256').update(material).digest('hex').slice(0, 16);

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(
  join(here, 'package.json.generated'),
  `${JSON.stringify({ ...output, checksum }, null, 2)}\n`,
);

console.log(`checksum       ${checksum}`);
console.log(
  `workers        ${String(output.report.workers)} (${String(output.report.submitters)} submitting, ${String(output.report.optedOut)} opted out, ${String(output.report.nonSubmitters)} never submitted)`,
);
console.log(
  `blocks         ${String(output.report.blocks)}  seat-hours ${String(output.report.seatHours)}  appetite ${String(output.report.appetiteHours)}h`,
);
console.log(
  `coverage       min ${String(output.report.minPreferredPerBlock)} / median ${String(output.report.medianPreferredPerBlock)} preferred per block, ${String(output.report.repairedBlocks)} repaired`,
);
for (const g of output.report.guarantees) {
  console.log(`${g.passed ? 'PASS' : 'FAIL'} ${g.id}  ${g.label} — ${g.detail}`);
}
