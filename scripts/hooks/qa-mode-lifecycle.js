#!/usr/bin/env node
// SessionStart + SessionEnd hook: own the lifecycle of the `.qa-mode` marker so that
// cleanup is enforced by the harness rather than remembered by an agent.
//
// WHY THIS EXISTS
//
// QA mode points every tool at the local Supabase stack. If the marker survives past
// the QA session, the next ordinary dev run silently talks to local data, and QA data
// and app data cross over. The user's requirement was that the marker be created at
// the start of a QA session and removed at the end, strictly.
//
// An agent cannot guarantee the "remove at the end" half. A session can be
// interrupted, crash, or hit a context limit before any cleanup step it was told to
// run. So the guarantee lives in two harness-run events instead:
//
//   SessionEnd   -> clear the marker. Covers the ordinary exit.
//   SessionStart -> delete any marker found from a PREVIOUS session, and say so in
//                   context. This is the real backstop: `kill -9` skips SessionEnd,
//                   but the next session still begins clean.
//
// Together those make a leaked marker impossible to carry across a session boundary,
// which is why no time-based expiry is needed (the user explicitly did not want one).
//
// SessionStart stdout is injected as context the model can see, so the warning is
// addressed to the next session rather than to a log nobody reads. SessionEnd has no
// decision control and its stderr is shown to the user only, which is the right
// channel for a silent cleanup note.

const fs = require('fs');
const path = require('path');

const MARKER = path.join(process.cwd(), '.qa-mode');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function markerInfo() {
  try {
    const body = fs.readFileSync(MARKER, 'utf8');
    const m = body.match(/^enabled_at=(.*)$/m);
    return m ? m[1].trim() : 'unknown time';
  } catch {
    return null;
  }
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin() || '{}');
  } catch {
    process.exit(0); // never break a session on our own parse failure
  }

  const event = payload.hook_event_name || '';

  if (!fs.existsSync(MARKER)) process.exit(0);

  const when = markerInfo();

  if (event === 'SessionEnd') {
    try {
      fs.unlinkSync(MARKER);
      process.stderr.write(
        `QA mode cleared. The .qa-mode marker (set ${when}) was removed at session end, ` +
          `so your next run targets the remote staging project as normal.\n`,
      );
    } catch {
      /* best effort: SessionStart will catch it next time */
    }
    process.exit(0);
  }

  if (event === 'SessionStart') {
    // A marker present at SessionStart is by definition stale: it belongs to a session
    // that already ended, whether or not SessionEnd got to run.
    let removed = true;
    try {
      fs.unlinkSync(MARKER);
    } catch {
      removed = false;
    }

    const msg = removed
      ? `A stale QA-mode marker from a previous session (set ${when}) was found and REMOVED. ` +
        `This session targets the REMOTE staging project, which is the normal default. ` +
        `If you are starting a QA pass, run "scripts/qa/qa-mode.sh on" to re-enable local mode.`
      : `A stale QA-mode marker (set ${when}) is present and could NOT be removed. Tools may ` +
        `still be pointed at the LOCAL stack. Delete .qa-mode manually before doing normal work.`;

    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: msg,
        },
      }),
    );
    process.exit(0);
  }

  process.exit(0);
}

main();
