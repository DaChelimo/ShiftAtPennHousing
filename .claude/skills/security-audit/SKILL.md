---
name: security-audit
description: Run the adversarial security auditor against this repo. Invoke before committing anything that touches supabase/migrations, supabase/functions, an RLS policy, apps/web/lib/auth.ts, or apps/web/lib/actions; and on demand for a full sweep across every user journey. Also invoke when asked to "check this for security holes", "audit the RLS", "can a worker escalate", "is this endpoint safe", or "security scan before I commit".
---

# Security Audit

Dispatches the `security-auditor` subagent. The persona, methodology, and calibration all
live in `.claude/agents/security-auditor.md` (its own context window, since the surface spans
every migration, every Edge Function, and hundreds of `SECURITY DEFINER` declarations).
Counts are deliberately not quoted here; the agent measures them from the live catalog,
because a hardcoded number rots and then reads as authoritative.

## Pick the mode

**`precommit`** (default) when the user is about to commit, mentions a commit, or names
specific changed files. Diff-scoped plus the always-on regression checks. Minutes. Ends in
a `SAFE TO COMMIT` / `BLOCK` verdict.

**`full`** when the user asks for a complete, thorough, or journey-wide scan, or names no
scope at all. Whole methodology, every user journey. Writes
`docs/security/audit-<YYYY-MM-DD>.md`. Expect an hour or more.

If genuinely unclear which they want, ask. Do not silently run the hour-long sweep when they
wanted a gate, or the gate when they wanted the sweep.

## Dispatch

Precondition: the local stack must be up, because grants are authoritative in the running
catalog and not in the migrations, and because the auditor needs a live REST API to prove
exploits with curl. Check first and start it if needed:

```bash
supabase status >/dev/null 2>&1 || supabase start
```

The agent drives two scripts, both read-only:

- `scripts/security/attack-surface.sh` — nine catalog probes (`definers`, `noauthz`, `views`,
  `rls`, `writes`, `policies`, `searchpath`, `edge`, `granttests`), each with a `READ THIS`
  note on which rows are real holes and which are safe by construction.
- `scripts/security/mint-jwt.sh` — mints a local-only user JWT so the audit can attack as a
  real signed-in worker. Without it only the anonymous persona exists, and roughly half this
  schema is `anon=f, auth=t`, so coverage claims would be false.

Then spawn the agent with `subagent_type: security-auditor`, stating the mode on the first
line of the prompt (`Mode: precommit` or `Mode: full`) and passing along any scope the user
named. Run it in the background; it is long-running and needs its own context.

If `subagent_type: security-auditor` is not found, the agent registry has not picked up the
file yet, which happens in a session that started before the file existed. Fall back to
spawning `general-purpose` with an instruction to read
`.claude/agents/security-auditor.md` in full and adopt everything below its frontmatter as
its persona, then say the mode. Mention the restart to the user so the fallback is not
silently permanent.

## Relaying the result

The agent's report is not shown to the user, so relay it. Lead with the verdict, then
findings in severity order with `file:line` and the concrete repro. Always carry through the
**verified safe** and **not checked** sections; they are what make the report falsifiable,
and dropping them turns a real audit into a list of scary maybes.

Do not fix anything as part of this skill. The auditor is deliberately report-only. Let the
user decide what to act on, then treat any fix as its own change with its own commit.
