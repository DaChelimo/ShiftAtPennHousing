#!/usr/bin/env node
// PostToolUse(Write|Edit) advisory for AGENTS.md §5.2 size ceilings.
//
// The anti-God-class rule. Unlike the em-dash guard this NEVER blocks: splitting a
// file is a judgment call about where the seam goes, and a hook cannot make it. It
// runs after the write and feeds a note back into the conversation so the agent
// notices the file it just grew, at the moment it is still holding the context needed
// to split it.
//
// Deliberately quiet. It fires only when a file is over the ceiling AND the agent
// just made it longer, so a small fix inside an already-huge file (the common,
// legitimate case) stays silent. Reporting a known 6,000-line offender on every edit
// would train the agent to ignore the hook.

const fs = require('fs');
const path = require('path');

const CEILING = 600;

const SOURCE_EXT = /\.(kt|kts|swift|ts|tsx|js|jsx)$/i;

const EXEMPT =
  /(^|\/)(node_modules|build|dist|\.git)\/|(^|\/)tests?\/|database\.types\.ts$|(Test|Tests)\.(kt|swift)$|\.(test|spec)\.(ts|tsx|js|jsx)$/i;

// Known offenders from AGENTS.md §5.2 (verified 2026-07-23). They are already over the
// ceiling; the rule for them is "do not grow", so they get the sharper message, but
// still only when an edit actually grows them.
const QUARANTINED =
  /(ContentView\.swift|ScheduleBuilder\.tsx|WorkerShiftsRepository\.kt|KnowledgeIntake\.tsx|ShiftsScreen\.kt|SeasonEditor\.tsx)$/;

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function countLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').length;
  } catch {
    return 0;
  }
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin() || '{}');
  } catch {
    process.exit(0);
  }

  const input = payload.tool_input || {};
  const filePath = input.file_path || '';
  if (!filePath) process.exit(0);
  if (!SOURCE_EXT.test(filePath)) process.exit(0);
  if (EXEMPT.test(filePath)) process.exit(0);

  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);

  const lines = countLines(abs);
  if (lines <= CEILING) process.exit(0);

  // Did this edit actually grow the file? An Edit that is net-neutral or shrinking
  // is exactly what the rule asks for, so stay silent.
  if (payload.tool_name === 'Edit') {
    const before = String(input.old_string || '').split('\n').length;
    const after = String(input.new_string || '').split('\n').length;
    if (after <= before) process.exit(0);
  }

  const rel = path.relative(process.cwd(), abs) || filePath;
  const quarantined = QUARANTINED.test(filePath);

  const message = quarantined
    ? `${rel} is now ${lines} lines. This file is QUARANTINED in AGENTS.md §5.2: ` +
      `it is a known God class and the rule is "do not grow it." You just added to ` +
      `it. Move the new surface into its own file, and extract the section you ` +
      `touched on your way out.`
    : `${rel} is now ${lines} lines, over the ${CEILING}-line ceiling in AGENTS.md ` +
      `§5.2. Split it by feature before adding more. If a split is genuinely not ` +
      `right here, say why in one line rather than silently letting it grow. The ` +
      `architecture-review skill covers where to put the seam.`;

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: message,
      },
    }),
  );
}

main();
