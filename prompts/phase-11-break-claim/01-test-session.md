# Phase 11 — Break Claim Scheduling: Test Session

## Session Metadata

|                     |                                     |
| ------------------- | ----------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`) |
| **Interface**       | Claude Code CLI                     |
| **Thinking mode**   | Extended thinking — High            |
| **TDD role**        | Test author — write tests only      |
| **Skill to invoke** | `engineering:testing-strategy`      |

---

## Prompt

You are writing tests for Phase 11: Claim-Based Scheduling for Breaks.

Branch: `phase-11-break-claim`.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §4.4 (claim-based scheduling — full section)
- BEHAVIORAL_SPECIFICATION.md §3.2 (winter break and short break profiles)
- ARCHITECTURE.md §2.9 (break_periods table — anchor for T-14d/T-3d/T-1d)
- AGENTS.md

---

### Behavioral surfaces to cover

**Time offsets are anchored to break start date (NOT each individual date):**

- T-14d, T-3d, T-1d are all measured from `break_periods.start_date`
- A 5-day Thanksgiving break: ALL dates share the same phase boundaries (open/alert/close)
- Test: the closing of the calendar picker at T-1d affects ALL break dates simultaneously

**T-14d transition:**

- Calendar is cleared for the entire break period at this moment
- Existing assignments for those dates are removed
- Break period is visually highlighted (API/data layer: a flag or field the UI reads)

**T-14d to T-1d (claim window):**

- Workers can claim shifts from the calendar picker (not the open-shifts feed)
- Claims are first-come-first-served
- Dropped break shifts during this window → return to CALENDAR CLAIM POOL (not open-shifts feed)
- A worker who drops can re-claim if no one else claimed it

**T-3d nag:**

- Workers who haven't claimed any shifts AND have not indicated they want zero hours → receive alert
- Workers who have claimed ≥1 shift → no alert
- Workers who opted out (zero hours) → no alert (TODO: how do workers opt out of break claims? Check spec §4.4 for "affirmatively indicated they want zero hours for the break")

**T-1d closing:**

- At exactly T-1d, the calendar claim pool closes for the ENTIRE break period simultaneously
- Unclaimed shifts → enter open-shifts feed (status='vacant', accessible via weekly feed)
- From this point: workers wanting a shift must use the open-shifts feed
- A worker who drops a previously-claimed shift after T-1d → shift enters open-shifts feed (not calendar)
- T-2h cutoff still applies for the open-shifts feed claims

**Hours cap enforcement during breaks:**

- 40h hard cap for Thanksgiving, fall break, spring break
- 20h soft cap for spring fling
- Distinguish break types via `break_periods.break_type` column

---

### Edge cases

- T-14d triggers at exact midnight vs during the day — verify the cron fires correctly
- T-1d closes exactly: a claim submitted AT the T-1d moment should fail (closed)
- A worker claims all shifts for one day; another worker tries to claim the same → second rejected
- A break starts on a Saturday — T-14d, T-3d, T-1d offsets are calendar days, not business days
- A worker is on multiple houses (HM role + home house) during a break — break claims for closed houses are inaccessible

---

### Test files

1. `packages/core/tests/phase-11/break-phase-timing.test.ts` — Vitest: phase boundary computation from break start date
2. `supabase/tests/phase-11-break-transitions.sql` — pgTAP: T-14d clearing, T-1d transition to open-shifts feed
3. `tests/PHASE_11/TEST_PLAN.md`

---

### Commit

```
git commit -m "phase-11 tests: break claim timing (anchored to start_date), T-14d clearing, T-1d atomic close, calendar pool vs open-shifts feed transitions"
```
