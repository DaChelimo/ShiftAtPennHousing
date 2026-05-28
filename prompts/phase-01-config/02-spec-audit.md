# Phase 01 — Config Layer: Spec Audit

## Session Metadata

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Model**           | Claude Opus 4.7 (`claude-opus-4-7`)         |
| **Interface**       | Claude Code CLI                             |
| **Thinking mode**   | Standard                                    |
| **Skill to invoke** | `/code-review`                              |
| **When to run**     | After implementation passes all pgTAP tests |

---

## Prompt

Run a spec-adherence audit on the diff introduced in branch `phase-01-config`.

Sources of truth to check against:

- ARCHITECTURE.md §2.1 through §2.10 (every column, type, and constraint)
- ARCHITECTURE.md §1.1 (Configuration Over Code — config tables exist for every variable rule)
- ARCHITECTURE.md §1.6 (Time zone — `timestamptz` everywhere)
- ARCHITECTURE.md §3.10 (system_config completeness)
- BEHAVIORAL_SPECIFICATION.md §3.2 (profile values)
- BEHAVIORAL_SPECIFICATION.md §3.3 (staffing patterns)
- AGENTS.md

For each rule, constant, or constraint in those sections, find where the migration enforces it.

Report in this format:

**ENFORCED** — rule: [quote from spec] → file:line implementing it

**MISSING** — rule: [quote from spec] → not found in diff

**DRIFTED** — rule: [quote from spec] → diff does something different: [what it does instead]

**AMBIGUOUS** — rule: [quote from spec] → implementation made a choice; flag for human review

Specific things to check:

- Is `operating_profiles.escalation_chain` stored as ordered JSONB (ordered array of steps)?
- Is `staffing_patterns.block_headcounts` stored in the compressed range format (not expanded)?
- Is `hm_leave.status` an enum (not a free-text field)?
- Does `scheduling_periods.preference_deadline` allow NULL?
- Does `scheduling_periods.published_at` allow NULL?
- Are ALL timestamp columns `timestamptz` — not a single plain `timestamp`?
- Does `weekly_cap_overrides` have composite PK on `week_start_date`?
- Does `hmod_rotor` FK to users with the hm/bm role check (or is that deferred to phase-02)?
- Does the float_routing seed have ZERO rows for `winter_break`?
- Does `system_config` have a row for `no_ack_trigger_offset_minutes`?
- Does `system_config` have a row for `ack_deadline_offset_minutes`?
- Are the 11 single-staff houses present in staffing_patterns for `regular_school_year`?
- Are there NO staffing_pattern rows for non-Harnwell houses under `winter_break`?

Do NOT make any code changes. Report findings only.
Use the `engineering:code-review` skill.
