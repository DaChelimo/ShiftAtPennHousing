#!/usr/bin/env node
// PreToolUse(Bash) advisory gate: run /ship-check before committing a behavior change.
//
// A hook cannot run an agent. It is a shell command that gates a tool call, so this
// hook is a TRIPWIRE that names the thing that does the work: it interrupts a
// behavior-changing `git commit` and points at the /ship-check skill, which spawns the
// ship-check persona (.claude/agents/ship-check.md).
//
// Deliberately a SOFT gate (permissionDecision "ask", never "deny"). The judgement of
// whether a diff needs a QA pass is the human's, and a hook that can block a hotfix at
// 2am is a hook that gets unregistered. A false positive costs one confirmation click.
//
// SILENT (exit 0) in all of these cases, because a gate that fires on everything is a
// gate that gets ignored:
//   * Not a `git commit` at all.
//   * `qa:skip` anywhere in the command (the documented override; hotfix escape hatch).
//   * Nothing staged.
//   * Docs-only, or test-only. Mirrors the exclusion AGENTS.md already applies to the
//     spec-sync trigger.
//   * Pure comment/copy edits, and pure code MOVES (the added and removed line
//     multisets are equal, e.g. a file split or a reorder).
//   * A report in docs/qa/ is newer than every staged file AND mentions a journey the
//     staged paths touch.
//
// KNOWN LIMIT, stated rather than papered over: a genuine semantic refactor (rename a
// symbol, extract a function, change a signature) is NOT mechanically distinguishable
// from a behavior change, so it will trip this gate. That is the intended direction of
// error for an "ask" gate. `qa:skip` is the answer, not a cleverer heuristic.
//
// Dependency-free and fast: three short `git` reads, no network, no package imports
// beyond node builtins. It runs on every Bash call, so it exits on the cheapest
// possible check first.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MAX_BUFFER = 8 * 1024 * 1024;

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function git(args) {
  try {
    return execSync(`git ${args}`, {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null; // not a repo, or git unavailable: never block on our own failure
  }
}

// `git commit`, including `git -C <dir> commit` and `git commit --amend`. Deliberately
// does not match `git commit-tree` (\b after commit) or a commit mentioned inside an
// unrelated string.
const GIT_COMMIT = /\bgit\b[^\n|;&]*?\bcommit\b/;

const DOC_PATH = /\.(md|mdx|txt)$|^(docs|audits|prompts)\//i;

const TEST_PATH =
  /(^|\/)tests?\/|(^|\/)maestro\/|\.(test|spec)\.(ts|tsx|js|jsx)$|(Test|Tests|UITests)\.(kt|swift)$|(^|\/)__tests__\//i;

// Path fragment -> the user journey it belongs to. Used to name what the diff touches,
// so the gate says something specific instead of "you changed some code".
const JOURNEY_HINTS = [
  [/auth|login|session|launch[-_]?gate|onboard/i, 'auth, session, and the launch gate'],
  [
    /claim|open[-_]?shift|openshift|seat|coverage[-_]?lock/i,
    'open shifts, claim, and seat allocation',
  ],
  [/drop/i, 'drop and permanent drop'],
  [/swap/i, 'swaps'],
  [/float|escalat|allied/i, 'floats and escalation'],
  [/break/i, 'breaks'],
  [/preference/i, 'preferences'],
  [/builder|publish|ai[-_]?schedule|schedul/i, 'schedule builder and publish'],
  [/transfer|membership|hire|fire|cap|season|people/i, 'admin: people, transfers, cap, seasons'],
  [/house|grid|contact|directory/i, 'house grid, contact card, cross-house view'],
  [/notification|push|dispatch|fcm/i, 'notifications and push delivery'],
  [/tour|widget|priming/i, 'onboarding tours and priming'],
  [/assistant|knowledge|\bkb[-_]/i, 'desk assistant and knowledge base'],
  [/orchestrator|cron|tick/i, 'orchestrator and cron'],
];

const LAYER_HINTS = [
  [/^supabase\/migrations\//, 'DB schema, RPCs, RLS'],
  [/^supabase\/functions\//, 'Edge Functions'],
  [/^packages\/core\//, 'pure core logic'],
  [/^apps\/web\//, 'web'],
  [/^apps\/mobile\/shared\//, 'mobile shared logic'],
  [/^apps\/mobile\/androidApp\//, 'Android UI'],
  [/^apps\/mobile\/iosApp\//, 'iOS UI'],
];

function label(paths, table) {
  const out = new Set();
  for (const p of paths) {
    for (const [re, name] of table) {
      if (re.test(p)) out.add(name);
    }
  }
  return [...out];
}

// True when every +/- line in the staged diff is a comment, or the change is a pure
// relocation of existing lines. Both are behavior-preserving by construction.
function isCopyOrMoveOnly(diff) {
  const added = [];
  const removed = [];

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added.push(line.slice(1).trim());
    else if (line.startsWith('-')) removed.push(line.slice(1).trim());
  }

  const meaningful = (l) => l.length > 0 && !/^(\/\/|#|--|\*|\/\*|\*\/)/.test(l);

  const addedReal = added.filter(meaningful);
  const removedReal = removed.filter(meaningful);

  // Comment-only or whitespace-only change.
  if (addedReal.length === 0 && removedReal.length === 0) return true;

  // Pure move / reorder: identical multisets on both sides.
  if (addedReal.length !== removedReal.length) return false;
  const norm = (xs) => [...xs].sort().join('\n');
  return norm(addedReal) === norm(removedReal);
}

// A docs/qa report clears the commit when it is newer than every staged file and it
// actually mentions a journey the staged paths touch. Recency alone is not enough: a
// stale report about a different journey must not wave a change through.
function freshReportCovers(journeys, stagedPaths) {
  const qaDir = path.join(process.cwd(), 'docs', 'qa');
  let entries;
  try {
    entries = fs.readdirSync(qaDir).filter((f) => /^qa-.*\.md$/.test(f));
  } catch {
    return false;
  }
  if (entries.length === 0) return false;

  let newestStaged = 0;
  for (const p of stagedPaths) {
    try {
      newestStaged = Math.max(newestStaged, fs.statSync(p).mtimeMs);
    } catch {
      /* deleted file: ignore */
    }
  }

  for (const f of entries) {
    const full = path.join(qaDir, f);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.mtimeMs <= newestStaged) continue;

    let body;
    try {
      body = fs.readFileSync(full, 'utf8').toLowerCase();
    } catch {
      continue;
    }
    if (journeys.some((j) => body.includes(j.split(',')[0].toLowerCase()))) return true;
  }
  return false;
}

function ask(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: reason,
      },
    }),
  );
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    process.exit(0); // malformed input: never block on our own parse failure
  }

  const command = input?.tool_input?.command;
  if (typeof command !== 'string' || !GIT_COMMIT.test(command)) process.exit(0);

  // Documented override. Checked before any git work so a hotfix pays nothing.
  if (/qa:skip/i.test(command)) process.exit(0);

  const nameOnly = git('diff --cached --name-only');
  if (nameOnly === null) process.exit(0);

  const staged = nameOnly
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (staged.length === 0) process.exit(0);

  const behavioral = staged.filter((p) => !DOC_PATH.test(p) && !TEST_PATH.test(p));
  if (behavioral.length === 0) process.exit(0);

  const diff = git('diff --cached --unified=0 -- ' + behavioral.map((p) => `'${p}'`).join(' '));
  if (diff && isCopyOrMoveOnly(diff)) process.exit(0);

  const journeys = label(behavioral, JOURNEY_HINTS);
  const layers = label(behavioral, LAYER_HINTS);

  if (journeys.length > 0 && freshReportCovers(journeys, behavioral)) process.exit(0);

  const journeyLine =
    journeys.length > 0
      ? journeys.map((j) => `  - ${j}`).join('\n')
      : '  - (no journey matched by path; scope it yourself before running)';

  const layerLine = layers.length > 0 ? layers.join(', ') : 'unclassified paths';

  ask(
    `This commit changes behavior on ${behavioral.length} file(s) and no docs/qa report covers it.\n\n` +
      `Layers touched: ${layerLine}\n` +
      `Journeys implicated:\n${journeyLine}\n\n` +
      `Run /ship-check against those journeys before committing. It spawns the ship-check ` +
      `persona (.claude/agents/ship-check.md), which walks the journey end to end (mobile UI, ` +
      `ViewModel, web, Edge Function, RPC, RLS, notification) and files grounded fix tickets ` +
      `into docs/qa/.\n\n` +
      `This is advisory, not a block. Proceed if the change does not warrant a pass. To skip ` +
      `permanently for this commit, put "qa:skip" in the commit message.`,
  );
}

main();
