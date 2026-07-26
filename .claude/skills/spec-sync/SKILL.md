---
name: spec-sync
description: Update BEHAVIORAL_SPECIFICATION.md and ARCHITECTURE.md so they describe a feature you just built, in the same commit as the feature. Invoke proactively whenever a change ships a new user-facing capability/screen/surface, a new role/tier/permission/routing rule, a new subsystem (a packages/core module, a group of Edge Functions, a family of tables), a change to any documented rule/threshold/default (including a superseded behavior), a new system_config key or configurable parameter, or a new deploy-time requirement (env var, API key, cron, required config row). Also invoke when asked to "document this feature", "update the specs", or when a spec-vs-code drift or a BSpec-vs-ARCH contradiction is suspected. Do NOT invoke for copy tweaks, refactors with no behavior change, or pure test additions.
---

# Spec Sync

**A feature is not done until BEHAVIORAL_SPECIFICATION.md and ARCHITECTURE.md describe it.**

These two files are the ground truth other people and future agents read to learn what this
system is. Anything true only in code, or only in a `docs/**/PLAN.md`, is invisible.

This skill exists because of a real drift found on 2026-07-22: the Desk Assistant, knowledge
base, AI scheduling, widgets, and SMOD/CSMOD routing had all shipped with **zero mention in
either spec**, and two statements in the specs had been silently superseded by later
migrations. The specs describe the **whole product**, not just the staffing engine.

## Step 1 — Confirm this actually triggers

Any one of these is enough:

- A new user-facing capability, screen, or surface on web or mobile.
- A new role, tier, duty concept, permission, or routing rule.
- A new subsystem: a new `packages/core/src/*` module, a new group of Edge Functions, a new
  family of tables.
- A change to an existing documented rule, threshold, or default, **including** a behavior
  that is superseded (grandfathering becoming cancellation, a floor moving 2 to 1, a gate
  widening from own-house to cross-house).
- A new system-wide configurable parameter or `system_config` key.
- A new deploy-time requirement: an env var, an API key, a cron, a config row that must be
  set for correct behavior.

Copy tweaks, refactors with no behavior change, and pure test additions do **not** trigger it.
Stop here if none apply.

## Step 2 — Read the source, not your memory

Ground every sentence you are about to write in something you actually read: the migration,
the module, the Edge Function. **If you cannot point to the code that makes a sentence true,
do not write the sentence.** Note the file and symbol for each claim as you go; you will need
them in step 5.

## Step 3 — Write the behavior into BEHAVIORAL_SPECIFICATION.md

State the **observable rule, implementation-free**: who can do what, when it fires, what the
user sees, what is guaranteed, and what is refused. No table names, no function names, no
migration numbers.

- New configurable parameters go in **§14**.
- New permissions go in **§13**.

## Step 4 — Write the mechanism into ARCHITECTURE.md

State **how it is enforced**: tables and enums, which module is pure versus which Edge
Function orchestrates, the algorithm, the data flow, the invariants the schema enforces, and
any deploy-time config.

## Step 5 — Hunt superseded text (do not skip this)

This is the step that gets skipped, and skipping it is worse than not documenting at all.
Appending a new section while a contradicting sentence survives elsewhere leaves two specs
that disagree with each other.

For each behavior you changed, grep **both** specs for the old statement and correct it **in
place**:

```bash
grep -n "<old threshold, old role name, old rule phrase>" BEHAVIORAL_SPECIFICATION.md ARCHITECTURE.md
```

Search for the old _number_ and the old _phrasing_ separately. A floor that moved from 2 to 1
may be written as "at least two blocks" in one place and "2-block minimum" in another.

## Step 6 — Check the two specs agree

If BEHAVIORAL_SPECIFICATION.md and ARCHITECTURE.md state different things about the same
behavior, that is a **P0**. Stop and reconcile with the user before writing more code on top
of it. One of them is describing a system that does not exist.

## Hard rules

1. **Ship the spec edit in the same commit** as the feature. Do not defer to a follow-up;
   follow-ups do not happen.
2. **Never renumber existing sections.** Code comments, tests, and both specs cross-reference
   section numbers (`BSpec §5.4`, `ARCH §2.8`). Append new top-level sections at the end of
   the numbered run; add subsections in place.
3. **Fix superseded text in place**, do not merely append a correction.
4. **A plan under `docs/` never satisfies this rule.** Plans and scoping documents are
   working documents. When a plan lands, promote its settled behavior into the specs and let
   the plan document become history.
5. **The nested `AGENTS.md` files are not a substitute.** A detailed note there plus silence
   in the specs is exactly the failure mode this skill exists to prevent. A note belongs in
   `AGENTS.md` only when it is an agent-facing guardrail; the behavior itself still goes in
   the specs.
6. **Flag drastic changes rather than absorbing them.** If the change alters a hard invariant,
   a documented default, or a role's authority, say so explicitly, get the user's
   confirmation, and record the decision **with its date** in the spec. Treat it as a spec
   amendment, not an implementation detail.
7. **No em or en dashes** in any spec text that quotes or defines user-facing copy.

## Before you call the feature done

- [ ] Behavior stated in BEHAVIORAL_SPECIFICATION.md.
- [ ] Mechanism stated in ARCHITECTURE.md.
- [ ] Superseded sentences in both specs grepped for and corrected in place.
- [ ] New config keys in BSpec §14; new permissions in BSpec §13.
- [ ] Deploy-time requirements (env vars, keys, crons, required config rows) recorded.
- [ ] The two specs agree with each other and with the code.
- [ ] Spec edits are staged in the **same commit** as the feature.
