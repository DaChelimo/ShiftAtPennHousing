# In-app how-to guides (assistant KB source)

These markdown files are the **how-to / navigation guide** for the worker mobile
app. They are authored as Desk Assistant knowledge so the assistant can answer
"how do I ... in the app" questions directly, concisely, and with a citation,
instead of workers paging a manager or guessing whether a feature exists. They
are the reactive, on-demand layer of the onboarding program (the first-run tour
and the just-in-time coach-marks are the proactive layers, in the mobile app).

## What they are

- `source_type: app_guide` (added by migration `20260713000004`) — production
  content, distinct from the synthetic `fixture` corpus and from house policy
  `house_binder`s. Retrieval never filters on `source_type`; it exists for clean
  categorization and for the citation label the assistant shows back.
- `sensitivity: general`, `allowed_roles:` empty, `house_scope:` empty — every
  worker at every house can retrieve them.
- Durable (no `effective_from` / `effective_until`) — evergreen, they never age
  out. Re-author and re-ingest when a flow's labels change.
- Each file has a **distinct `source_ref`** so `--replace` is idempotent per
  file (the replace key is `source_type + source_ref + house_scope`).

## Writing style

Phrase each section the way a worker would actually ask ("How do I drop a
shift?"), and use the **verbatim on-screen labels** ("Manage shift", "Drop the
shift", "Propose swap", "Claim shift", ...). The assistant grounds its answers in
this text, so wrong labels would send workers to the wrong button. No em or en
dashes (project-wide rule for surfaced/stored copy).

## Ingesting

Same CLI as the fixtures. Requires `@shift/core` built and the local stack up.

```bash
pnpm --filter @shift/core build            # once, if dist is stale

# Validate parsing + chunking (no DB, no embeddings, no API key):
npx tsx scripts/desk-assistant/ingest.ts scripts/desk-assistant/app-guides/dropping-a-shift.md --dry-run

# Ingest for real (needs VOYAGE_API_KEY for voyage-3 embeddings):
VOYAGE_API_KEY=... npx tsx scripts/desk-assistant/ingest.ts scripts/desk-assistant/app-guides/dropping-a-shift.md --replace

# Local offline check with deterministic fake embeddings (retrieval is
# token-overlap only, for wiring verification, never for production):
npx tsx scripts/desk-assistant/ingest.ts scripts/desk-assistant/app-guides/dropping-a-shift.md --replace --fake
```

Ingest every guide (real embeddings):

```bash
for f in scripts/desk-assistant/app-guides/*.md; do
  VOYAGE_API_KEY=... npx tsx scripts/desk-assistant/ingest.ts "$f" --replace
done
```

## The guides

| File                             | Covers                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `getting-around.md`              | The five tabs, the More menu, finding the Assistant, calendar Week/Day view, week hours, week navigation |
| `dropping-a-shift.md`            | Drop whole / partial / permanent, short-notice warning, what happens after                               |
| `swapping-a-shift.md`            | Propose a swap, give/take amounts, permanent swap, multi-person, swap vs hand off                        |
| `handing-off-a-shift.md`         | One-way hand off, choosing a recipient, how it looks to the receiver                                     |
| `responding-to-swap-requests.md` | Swaps tab, Accept/Decline, cancel outgoing, deadlines                                                    |
| `claiming-open-shifts.md`        | Claim open shifts, partial claim, cap warnings, permanent pickup                                         |
| `break-shifts.md`                | Break sign-up calendar, claiming/dropping, no-hours opt-out, open/close timing                           |
| `house-and-contacts.md`          | House grid, house switcher, calling the desk or a coworker                                               |
| `float-assignments.md`           | What a float is, hours unchanged, accept/acknowledge/decline, deadlines                                  |
| `using-the-assistant.md`         | What the Assistant answers, how to open it, when to use it vs a manager                                  |
