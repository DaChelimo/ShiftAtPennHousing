#!/usr/bin/env node
// PreToolUse(Write|Edit) guard: an UPDATE that changes WHO holds a seat, or WHAT STATE a
// seat is in, must say in its own WHERE clause who/what it expected to find there.
//
// WHY THIS IS A HOOK AND NOT A PARAGRAPH
//
// This exact shape has now been fixed three times:
//   * 20260724000003 -- claim_open_shift allocated a specific seat instead of any seat on
//     the block, so two workers claiming the same coalesced card collided.
//   * 20260724000005 -- permanent_pickup_slot had no per-block limit and put one worker on
//     two seats of one block. Found by hand-reproduction, because nothing objected.
//   * 20260726000009 -- the concurrency audit found FOUR more unlocked seat writes, three of
//     which wrote with no predicate at all:
//         UPDATE shift_block_assignments SET status='vacant', user_id=NULL
//         WHERE assignment_id = ANY (p_assignment_ids);       -- drop_shift
//         UPDATE shift_block_assignments SET user_id = <counterparty>
//         WHERE assignment_id = ANY (v_swap.initiator_assignment_ids);  -- accept_swap
//
// Nobody was careless. The cause is structural, and it is the same one as
// anon-grant-guard.js: the statement is written from the shape of the one above it, and
// `WHERE assignment_id = ANY(...)` reads as narrow and safe. It is not. It says nothing
// about the row's CURRENT owner or state, so under READ COMMITTED it happily overwrites a
// seat that changed hands after the function's own availability check ran.
//
// These failures are silent by construction: an ownership swap leaves the occupied COUNT
// unchanged, so enforce_block_occupied_headcount cannot see it, and the partial unique
// index added by 20260726000010 only catches DUPLICATION. The losing session gets HTTP 200.
// A prose rule cannot survive a copied statement, because the copy is the part nobody
// re-reads. See supabase/AGENTS.md "Seat writes and lock order" and ARCHITECTURE.md 10.2.
//
// WHAT IT FLAGS (deliberately narrow, to stay worth reading)
//   An UPDATE on shift_block_assignments that assigns `user_id` or `status` -- i.e. changes
//   occupancy -- where BOTH safety mechanisms are absent:
//     * the statement's own WHERE clause names neither user_id nor status, AND
//     * the enclosing function body contains no FOR UPDATE at all.
//   Either one alone is a defensible design, so either one alone silences this. Writes that
//   only touch bookkeeping columns (vacancy_origin alone, dropped_at, parent_float_id) are
//   not occupancy changes and are never flagged.
//
// CALIBRATION. The first draft flagged only the missing predicate and fired on 32 of 148
// existing migrations (22%), including the audit's own corrected float migration -- because
// "lock the rows FOR UPDATE, re-validate, then write them by id" is a correct and common
// pattern here, and a predicate on the write is defence in depth rather than the only valid
// design. A guard that cries wolf on a fifth of the corpus gets skimmed past, which is worse
// than no guard. Requiring BOTH mechanisms to be missing is what makes it precise enough to
// be worth stopping for; re-measure with scripts/hooks/seat-write-guard.test.sh if the rule
// is ever loosened.
//
// NOT A CORRECTNESS PROOF. A FOR UPDATE somewhere in the function is not proof it covers
// THESE rows, or that it was taken before the availability check. It catches the shape that
// actually recurred: a seat write with no protection of either kind anywhere near it.

'use strict';

function readStdin() {
  const fs = require('fs');
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// Blank comments out IN PLACE, preserving every newline and every character offset, so line
// numbers and offsets stay identical between the raw text and the stripped text. That is what
// lets the reported line number be right and the `seat-write-allow` escape hatch be findable
// in the raw source (the first draft stripped comments destructively, which silently broke
// both).
function stripSqlComments(sql) {
  const blanked = sql.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return blanked
    .split('\n')
    .map((line) => {
      const at = line.indexOf('--');
      return at === -1 ? line : line.slice(0, at) + ' '.repeat(line.length - at);
    })
    .join('\n');
}

// Split into UPDATE statements on shift_block_assignments, returning {set, where} text.
// Statement end is the next `;` at paren depth 0, which is good enough for plpgsql bodies
// because a seat UPDATE never contains a bare semicolon inside parentheses.
function seatUpdates(sql) {
  const out = [];
  const re = /\bUPDATE\s+(?:ONLY\s+)?(?:public\.)?shift_block_assignments\b/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    let depth = 0;
    let end = sql.length;
    for (let i = m.index; i < sql.length; i += 1) {
      const ch = sql[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === ';' && depth <= 0) {
        end = i;
        break;
      }
    }
    const stmt = sql.slice(m.index, end);
    const setAt = stmt.search(/\bSET\b/i);
    if (setAt === -1) continue;
    // WHERE at paren depth 0 only, so a subquery's WHERE is not mistaken for the
    // statement's own.
    let whereAt = -1;
    let depth2 = 0;
    for (let i = setAt; i < stmt.length - 5; i += 1) {
      const ch = stmt[i];
      if (ch === '(') depth2 += 1;
      else if (ch === ')') depth2 -= 1;
      else if (
        depth2 === 0 &&
        /\bWHERE\b/i.test(stmt.slice(i, i + 5)) &&
        !/\w/.test(stmt[i - 1] || ' ')
      ) {
        whereAt = i;
        break;
      }
    }
    out.push({
      statement: stmt,
      set: whereAt === -1 ? stmt.slice(setAt) : stmt.slice(setAt, whereAt),
      where: whereAt === -1 ? '' : stmt.slice(whereAt),
      offset: m.index,
    });
  }
  return out;
}

function changesOccupancy(setClause) {
  // `SET user_id = ...` or `SET status = ...`, as an assignment target rather than a
  // mention on the right-hand side.
  return /(^|,|\bSET\b)\s*(?:\w+\.)?(user_id|status)\s*=/i.test(setClause);
}

function predicatesOnOccupancy(whereClause) {
  return /\b(user_id|status)\b/i.test(whereClause);
}

function lineOf(sql, offset) {
  return sql.slice(0, offset).split('\n').length;
}

// The dollar-quoted body enclosing `offset`, or null when the statement is top-level.
// plpgsql bodies here are delimited by $$ or $function$ / $do$ style tags.
function enclosingBody(sql, offset) {
  const tag = /\$([A-Za-z_]\w*)?\$/g;
  const marks = [];
  let m;
  while ((m = tag.exec(sql)) !== null) marks.push({ text: m[0], index: m.index });

  const open = [];
  for (const mark of marks) {
    if (open.length > 0 && open[open.length - 1].text === mark.text) {
      const start = open.pop();
      if (start.index < offset && offset < mark.index) {
        return sql.slice(start.index, mark.index);
      }
    } else {
      open.push(mark);
    }
  }
  return null;
}

function bodyTakesRowLock(sql, offset) {
  const body = enclosingBody(sql, offset);
  return body !== null && /\bFOR\s+UPDATE\b/i.test(body);
}

function main() {
  const raw = readStdin();
  if (!raw.trim()) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const input = payload.tool_input || {};
  const path = input.file_path || '';
  if (!/supabase\/migrations\/.*\.sql$/.test(path)) process.exit(0);

  const content = input.content !== undefined ? input.content : input.new_string;
  if (typeof content !== 'string' || !content.trim()) process.exit(0);

  const sql = stripSqlComments(content);
  // Offsets and line numbers are identical between `content` and `sql` by construction, so
  // the escape-hatch marker can be looked for in the RAW source (where the comment survives).
  const rawLines = content.split('\n');
  const allowedAt = (offset) => {
    const line = lineOf(sql, offset);
    return rawLines
      .slice(Math.max(0, line - 4), line + 2)
      .some((l) => l.includes('seat-write-allow'));
  };

  const offenders = seatUpdates(sql).filter(
    (u) =>
      changesOccupancy(u.set) &&
      !predicatesOnOccupancy(u.where) &&
      !bodyTakesRowLock(sql, u.offset) &&
      !allowedAt(u.offset),
  );

  if (offenders.length === 0) process.exit(0);

  const detail = offenders
    .map((u) => {
      const first = u.statement.trim().split('\n').slice(0, 3).join('\n  ');
      return `  line ~${lineOf(sql, u.offset)}:\n  ${first}`;
    })
    .join('\n\n');

  process.stderr.write(
    `Seat write changes occupancy without saying what it expected to find.\n\n` +
      `${detail}\n\n` +
      `This UPDATE assigns user_id and/or status on shift_block_assignments, but its WHERE\n` +
      `clause names neither. Under READ COMMITTED that silently overwrites a seat which\n` +
      `changed hands after this function's availability check ran, and the losing caller\n` +
      `still receives HTTP 200. It has been fixed three times (20260724000003,\n` +
      `20260724000005, 20260726000009) and is invisible to every existing constraint,\n` +
      `because an ownership swap leaves the occupied count unchanged.\n\n` +
      `Fix: lock the rows FOR UPDATE before the availability check, then repeat that check\n` +
      `as this statement's own predicate (AND user_id = <expected> AND status IN (...)),\n` +
      `and assert GET DIAGNOSTICS ROW_COUNT so a lost race raises instead of no-oping.\n` +
      `See supabase/AGENTS.md "Seat writes and lock order".\n\n` +
      `If this write genuinely has no expected prior owner or state (an admin bulk config\n` +
      `reconcile, for example, which is serialised at a higher level), put a comment\n` +
      `containing "seat-write-allow" on or just above the statement, saying WHY, and re-run.\n`,
  );
  process.exit(2);
}

main();
