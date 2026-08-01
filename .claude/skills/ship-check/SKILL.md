---
name: ship-check
description: Run the pre-ship product QA pass on one or more user journeys. Invoke before committing a user-facing feature, when the ship-check commit guard fires, or when asked "what breaks", "what did we miss", "is this ready to ship", "QA this", "how could a worker misuse this". Scopes the slice, spawns the ship-check persona, merges findings, and writes a fix-ticket report into docs/qa/. Not a code review and not a security audit.
---

# Ship Check

Dispatches the `ship-check` subagent. The persona, its severity model, its failure taxonomy,
and its output contract all live in `.claude/agents/ship-check.md`, in its own context window,
because a QA pass that shares context with the session that wrote the code inherits that
session's belief that the code is correct.

This skill is the ritual: scope, fan out, merge, write. The persona is the judgement.

## 0. Turn on QA mode (mandatory, before anything else)

The app runs against a hosted staging project. QA passes run **strictly** against the local
stack, because the agents probe destructively and staging is the fixture the user's physical
device depends on.

```bash
scripts/qa/qa-mode.sh on
```

That creates the `.qa-mode` marker, which does two things: it derives every tool's environment
to local, and it arms `scripts/hooks/qa-remote-guard.js` to deny any Bash command naming the
remote project ref or a `*.supabase.co` host.

Cleanup is handled by the harness, not by you: `SessionEnd` clears the marker, and
`SessionStart` deletes any marker left over from a previous session. You do not need to
remember to turn it off, and you should not rely on remembering.

Verify before spawning anything, and pass the requirement down to every agent you spawn:

```bash
scripts/qa/qa-mode.sh status
```

If the user has not yet cloned staging into local, or the catalog-parity diff has not been run,
say so now. Both of those read the remote project, so they must happen with QA mode **off**,
before this step. Ordering is: `clone-remote-to-local.sh` then `catalog-parity.sh` then
`qa-mode.sh on`. Any divergence the parity diff reports is itself a finding and belongs in the
report.

## 1. Scope the slice

Slice by **user journey, cross-stack**, never by platform. A platform-ordered pass
structurally cannot see the seam failures, where mobile assumes the RPC validates and the RPC
assumes the client already did. A journey slice follows one path end to end: mobile UI and its
ViewModel, the web equivalent, the Edge Function, the RPC, the RLS policy, the notification it
emits.

`docs/qa/COVERAGE.md` holds the 15 journeys and their state. Use it to pick.

- **Invoked from the commit guard**: the gate names the journeys the diff touches. Use those.
- **Invoked by name**: use what the user named.
- **Invoked with no scope**: read `COVERAGE.md`, propose the highest-risk not-started slices,
  and ask before spending the budget. Do not silently start a fifteen-slice sweep.

## 2. Fan out

Spawn one `ship-check` agent per slice, in parallel when the slices are independent. Two to
four at a time is the useful range. Beyond that the merge cost exceeds the parallelism gain,
and slices start colliding on the same files.

Slices that share a write path (drop and permanent drop, swaps and the pending guard) are
**not** independent. Give those to one agent as a single slice, or the two agents will file
the same finding from two directions and you will spend the merge budget deduping.

Each agent's prompt states:

- The journey, named end to end with its actual surfaces.
- The exact output path: `docs/qa/qa-<slice>-<YYYY-MM-DD>.md`.
- That it must read `docs/qa/ACCEPTED-RISKS.md` before reporting.
- Any relevant `AGENTS.md` invariants for that journey, so it does not have to rediscover
  which escalations are automatic.

Run them in the background. Each needs its own context and a real amount of it.

If `subagent_type: ship-check` is not found, the agent registry has not picked up the file
yet, which happens in a session that started before the file existed. Fall back to spawning
`general-purpose` with an instruction to read `.claude/agents/ship-check.md` in full and adopt
everything below its frontmatter as its persona. Mention the restart to the user so the
fallback does not become silently permanent.

## 3. Merge

When two slices touch the same seam they will find the same defect from different sides. Merge
those into one ticket, keep the more concrete repro, and list both journeys under
**Journey**. Do not keep both: a duplicate ticket gets fixed twice or, more often, zero times
because each reader assumes the other one is being handled.

Re-rank after merging. A defect that two independent journeys both hit has a larger blast
radius than either slice could see alone, and that usually raises its severity.

Then apply the persona's own credibility rules across the merged set, because they are easier
to enforce here than inside a single agent:

- Drop anything without a `file:line` and a trigger sequence.
- Drop anything already in `ACCEPTED-RISKS.md`, unless the agent explicitly argued that
  conditions changed.
- If the merged list has no P0 or P1 and a pile of P3s, that is a failed pass. Say so to the
  user rather than shipping the P3s as if they were the finding.

## 4. Write

One report per slice at `docs/qa/qa-<slice>-<YYYY-MM-DD>.md`, tickets ordered P0 first, each
self-contained enough that a different coding agent can take one without reading the rest.

Update `docs/qa/COVERAGE.md`: mark the slice passed with its date and the report link, and
record the P0/P1 count so the next pass can see which journeys have a history.

If the pass surfaced a _deliberate_ tradeoff that is not yet registered, add it to
`ACCEPTED-RISKS.md` so the next pass does not rediscover it. Only when it is genuinely a
decision someone made. "Not gotten to yet" is a backlog item, not an accepted risk.

## 5. Relay

The agent reports are not shown to the user, so relay them. Lead with the P0 and P1 count and
the single worst finding, then the tickets in severity order.

Always carry through the **Verified clean** and **Not checked** sections. They are what make
the report falsifiable, and dropping them turns a QA pass into a list of scary maybes.

Give an honest read on whether the findings are worth acting on. If the pass was thin, say it
was thin. A QA function that reports success every time is one nobody reads.

## What this skill does not do

Do not fix anything here. The persona is report-only by construction (no `Edit` tool), and
that is the point: the inspector does not do the repairs. Let the user decide what to act on,
then treat each fix as its own change with its own commit.

Do not run the security methodology. If a hole sits on the journey, the persona files it; the
sweep belongs to `security-audit`. Do not review code quality; that is `architecture-review`.
