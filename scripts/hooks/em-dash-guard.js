#!/usr/bin/env node
// PreToolUse(Write|Edit) guard for AGENTS.md non-negotiable #7: no em (—) or en (–)
// dashes in user-facing text.
//
// Mechanical backstop for a rule that is absolute, trivially fixable, and easy to
// violate by habit (models emit em dashes naturally in prose). A prose rule in
// AGENTS.md relies on the agent remembering it while writing a toast string; this
// hook does not.
//
// This is a HARD gate (permissionDecision "deny", unlike the psql guard's soft
// "ask") because the rule admits no exceptions and the fix is mechanical: re-punctuate
// with a period, comma, colon, or parentheses. A denial costs one retry, and the
// reason text tells the agent exactly what to do.
//
// SCOPE — deliberately narrow, to keep false positives near zero:
//   * Only source files (.kt .swift .ts .tsx .js .jsx .sql). Markdown, docs, and
//     specs are exempt: they are not user-facing surfaces.
//   * Only dashes INSIDE a string literal. A dash in a code comment or in a trailing
//     `// ...` is exempt by construction, because the scanner tracks quote state and
//     a comment dash is never inside an open quote.
//   * Test files are exempt. A test asserting on copy is mirroring a string that this
//     same hook already gated at its source; flagging both just doubles the noise.
//   * Logging calls are exempt (console.*, println, Log.*, RAISE NOTICE/WARNING).
//     AGENTS.md exempts log lines explicitly.
//   * Escape hatch: put `agents-allow-dash` anywhere on the line.
//
// Only NEW content is scanned. An Edit is judged on new_string, so pre-existing
// violations elsewhere in the file never block an unrelated edit.

const fs = require('fs');

const DASH = /[—–]/; // em dash, en dash

const SOURCE_EXT = /\.(kt|kts|swift|ts|tsx|js|jsx|sql)$/i;

const EXEMPT_PATH = /(^|\/)(node_modules|build|dist|\.git)\/|(^|\/)tests?\//i;

const EXEMPT_TEST_FILE = /(Test|Tests)\.(kt|swift)$|\.(test|spec)\.(ts|tsx|js|jsx)$/i;

const EXEMPT_LINE =
  /console\.(log|warn|error|debug|info|trace)|println|Log\.[dviwe]\b|System\.out|RAISE\s+(NOTICE|WARNING|DEBUG|LOG|INFO)|agents-allow-dash/i;

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// Returns true when a dash character sits inside an open string literal on this line.
// Tracks ' " and ` and honours backslash escapes. SQL doubles a quote to escape it
// ('it''s'), which this treats as close-then-reopen; the net quote state is the same.
function dashInsideStringLiteral(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote && ch === '\\') {
      i++; // skip escaped char
      continue;
    }
    if (!quote && (ch === '"' || ch === "'" || ch === '`')) {
      quote = ch;
      continue;
    }
    if (quote && ch === quote) {
      quote = null;
      continue;
    }
    if (quote && DASH.test(ch)) return true;
  }
  return false;
}

function offendingLines(text) {
  const hits = [];
  for (const raw of String(text).split('\n')) {
    if (!DASH.test(raw)) continue;
    if (EXEMPT_LINE.test(raw)) continue;
    if (!dashInsideStringLiteral(raw)) continue;
    hits.push(raw.trim());
  }
  return hits;
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin() || '{}');
  } catch {
    process.exit(0); // unparseable input: never block
  }

  const tool = payload.tool_name || '';
  const input = payload.tool_input || {};
  const filePath = input.file_path || '';

  if (!filePath) process.exit(0);
  if (!SOURCE_EXT.test(filePath)) process.exit(0);
  if (EXEMPT_PATH.test(filePath)) process.exit(0);
  if (EXEMPT_TEST_FILE.test(filePath)) process.exit(0);

  // Scan only the content being introduced.
  let candidate = '';
  if (tool === 'Write') candidate = input.content || '';
  else if (tool === 'Edit') candidate = input.new_string || '';
  else process.exit(0);

  const hits = offendingLines(candidate);
  if (hits.length === 0) process.exit(0);

  const sample = hits
    .slice(0, 5)
    .map((l) => `  ${l}`)
    .join('\n');
  const more = hits.length > 5 ? `\n  ...and ${hits.length - 5} more` : '';

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Blocked: em/en dash inside a string literal in ${filePath}.\n\n` +
          `AGENTS.md non-negotiable #7: no em (U+2014) or en (U+2013) dashes in ` +
          `user-facing text. This covers UI copy, labels, toasts, errors, empty ` +
          `states, notification bodies, and seeded/migration display strings, on ` +
          `both platforms.\n\n` +
          `Offending line(s):\n${sample}${more}\n\n` +
          `Fix: re-punctuate with a period, comma, colon, or parentheses, then retry. ` +
          `If this string is genuinely never surfaced to a user (a log line or an ` +
          `internal identifier), add the marker "agents-allow-dash" in a comment on ` +
          `that line.`,
      },
    }),
  );
}

main();
