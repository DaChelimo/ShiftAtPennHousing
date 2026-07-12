# Desk Assistant, v1 Build Plan

Derived from `V1_SCOPE.md`. Status: **APPROVED, build in progress** (decisions locked
2026-07-10; Phases A and B1 done, see §9 progress log).

This document is written to be executed by an implementing agent with no other context
beyond the repo. It answers: what to build, in what order, against which contracts, with
which placeholder seams for the inputs that have not arrived yet (flowcharts, binders,
escalation rules), and how to verify each step. Read §0 before touching anything.

Nothing in this plan touches the staffing engine (float / claim / swap / pickup / coverage /
existing notifications). v1 is purely additive, per scope §2 and §8.

---

## 0. Implementer briefing (read first)

### 0.1 Source hierarchy

1. `BEHAVIORAL_SPECIFICATION.md` — what the system must do (staffing; unchanged by v1).
2. `ARCHITECTURE.md` — schema/code enforcement.
3. `AGENTS.md` — repo conventions and hard invariants. All apply here.
4. `docs/desk-assistant/V1_SCOPE.md` — the assistant's scope. This plan implements it.
5. This file — the build contract. Where this plan pins a decision, do not re-litigate it.

### 0.2 Environment facts (verified 2026-07-10)

- **Worktree:** this repo is a git worktree at `Shift-desk-assistant` on branch
  `feat/desk-assistant`, off `feat/ui-float-polish`. **One-way dependency:** merge
  `feat/ui-float-polish` → `feat/desk-assistant` only, never the reverse.
- **Deps installed:** `pnpm install` has been run in this worktree (worktrees do not share
  `node_modules`).
- **`psql` is NOT on PATH.** Reach the local DB via
  `docker exec -i supabase_db_Shift_PennHousing psql -U postgres -X ...`
  (port 54322 externally, container name matters — several other Supabase projects run
  side by side).
- **Migration drift (important):** the local DB has `20260703000002` applied, which does
  NOT exist in this worktree's `supabase/migrations/` (it lives on `feat/ui-float-polish`).
  Therefore `supabase migration up` from this worktree will mis-sync. To apply a new
  migration: **first `git merge feat/ui-float-polish` into this branch** (the sanctioned
  sync), or apply manually via docker-exec psql and insert the version row into
  `supabase_migrations.schema_migrations`. To _validate_ DDL without applying, wrap it:
  `{ echo "BEGIN;"; cat <mig>.sql; echo "ROLLBACK;"; } | docker exec -i supabase_db_Shift_PennHousing psql -U postgres -X -v ON_ERROR_STOP=1`
- **⛔ Never `supabase db reset`** (or any DB wipe) without the user's explicit go-ahead.
- **RTK proxy** rewrites common commands and can swallow tool output (notably vitest).
  If output looks truncated/garbled, prefix with `rtk proxy`.
- **`prompts/` directory is excluded from agent reads** (`.claudeignore`). Do not read it.

### 0.3 Repo conventions that bite here

- **No em/en dashes** in any user-facing or stored copy (web, mobile, EF responses,
  seeded rule text). Re-punctuate. Docs/comments/tests are exempt.
- After ANY migration change: `supabase gen types typescript --local >
packages/shared/src/database.types.ts`, then **rebuild `@shift/shared`** (web consumes
  its `dist/`, not `src/` — skipping the rebuild makes new `.rpc()` names untyped).
- pgTAP files live in `supabase/tests/*.sql`. `pnpm pgtap:file <path>` runs one file via
  raw psql, but **RLS-read assertions only pass under `supabase test db`** (raw psql on
  54322 cannot read base tables as `authenticated`); structure pgTAP accordingly and run
  the RLS suites with `supabase test db` when possible.
- Vitest: `pnpm --filter @shift/core exec vitest run tests/desk-assistant` (or
  `pnpm test:quick` for the dot-reporter full suite).
- Commits: one feature per commit (`type(scope): summary`); migration + its pgTAP + the
  code + docs for that feature ship together. Nothing in this feature is committed yet —
  see §7.2 for the planned commit series.

### 0.4 Secrets and models (deploy-time config, never committed)

- `VOYAGE_API_KEY` — Voyage AI embeddings (EF secret / local `.env` for scripts).
- `ANTHROPIC_API_KEY` — Claude generation (EF secret).
- `DA_GENERATION_MODEL` — env override; default `claude-sonnet-5` (cost/latency fit for
  desk Q&A; Opus is not required for grounded extraction over supplied context).
- Embedding model/dimension are pinned in code: `voyage-3`, 1024 (see §1.1).
- Follow the phase-12/13a precedent: code paths ship and **degrade gracefully** when a
  secret is absent (clear 503 with a reason, never a crash or a silent no-op).

---

## 1. Locked decisions (2026-07-10, user-confirmed)

1. **Embeddings: Voyage AI `voyage-3`, 1024-dim.** Pinned in
   `packages/core/src/desk-assistant/embeddings.ts` (`EMBEDDING_MODEL`, `EMBEDDING_DIM`)
   and the `vector(1024)` column. Provider sits behind the `EmbeddingProvider` interface;
   a future switch is a re-embed, not a rewrite. `assertEmbeddingDimension` guards ingest.
2. **Page handoff: app-notification is the default, delivered as a NEW critical-alert
   tier; legacy-pager-format is a supported alternative adapter.** The critical-alert
   tier (Phase F0) is: undismissable / respond-only (not swipe-away), a unique
   disruptive-but-not-annoying sound, iOS time-sensitive/critical-style presentation,
   Android full-screen-intent channel, escalating re-notification until responded.
   It extends `dispatch-push`; it does not alter any staffing notification.
3. **Web: standalone responsive screens FIRST (phone-web + laptop-web), attach to the
   broader SW/SM/admin app later.** Built inside `apps/web` as a self-contained route
   group with its own minimal shell, behind one `<DeskAssistant/>` mount component, so the
   other workstream can host it later without rework. Surface work leads; it does not wait.

---

## 2. Non-goals (from scope §9 — do not drift)

No staffing/float/claim/swap/pickup changes; no summer-float-rule change; no Allied form
digitization; no Allied as a user; no masked contact; no cost/ops dashboards; no physical
pager hardware. The assistant **never initiates or changes an assignment**: it reads duty
state, it never writes it.

---

## 3. Integration contract (corrected 2026-07-10 — read carefully)

**Repo fact:** Edge Functions in this codebase do NOT import `packages/core` (verified:
no EF imports it; Deno cannot import the pnpm workspace, and Supabase bundles only the
functions directory). The established pattern is: DB-heavy logic lives in **SQL
functions**; EF-side glue lives in **`supabase/functions/_shared/*.ts`** Deno modules;
`packages/core` is the tested source of truth consumed directly by `apps/web` (Node).

The Desk Assistant follows that pattern with three placements, chosen to keep exactly ONE
authoritative implementation of each piece of logic:

1. **Scope enforcement → SQL, single source.** The scoping matrix lives in
   `da_can_read_item` (already merged in migration `20260710000001`). Retrieval calls it
   inside the `match_kb_chunks` RPC (Phase B2), and RLS calls it on direct reads. Deno
   never re-implements the matrix. `packages/core/src/desk-assistant/scope.ts` is the
   TS _mirror_ used by web-side logic and by the shared truth-table test; the Vitest truth
   table + the pgTAP suite pin SQL and TS to each other.
2. **Chunking + ingestion → Node script, imports core directly.** Ingestion is a
   controlled operator pipeline (scope §7.1), not a user-facing request, so it is a CLI
   script (`scripts/desk-assistant/ingest.ts`, run with `tsx`), NOT an Edge Function.
   The script imports `@shift/core` (no duplication of the chunker), reads
   `VOYAGE_API_KEY` + the service-role key from env, and writes `kb_documents`/`kb_chunks`.
3. **Ask-time glue → one small Deno mirror.** `supabase/functions/_shared/desk-assistant.ts`
   contains ONLY what `da-ask` needs at runtime: the prompt strings, the guardrail regexes,
   the retrieval constants (topK 6, per-doc cap 3, grounding threshold 0.5), and citation
   grouping. Header comment on BOTH sides declares the mirror relationship
   (`packages/core/src/desk-assistant/{prompts,guardrails,citations,retrieval}.ts` are the
   contract; core's Vitest is the test of record; update in lockstep). This mirror is
   ~120 lines and changes rarely; the scope matrix is deliberately NOT part of it.

**`da-ask` pipeline (pinned order):**

1. Authenticate bearer → `auth.uid` (reject anon).
2. Load requester profile in one query (roles, home house, `is_active`).
3. Guardrails on the question text: incident probe → immediate refusal
   (`INCIDENT_PROBE_REFUSAL`), still logged as a message; life-safety detect → set
   preamble; access-decision detect → set inform-and-defer framing.
4. Embed the question (Voyage, 1 call).
5. `rpc('match_kb_chunks', { p_user_id, p_query_embedding, p_top_k: 24 })` — returns
   scope-filtered candidates with `similarity = 1 - (embedding <=> query)`.
6. Mirror-side selection: per-document cap 3 → top 6 → `grounded` iff any
   similarity ≥ 0.5.
7. Grounded → Claude generation (`GROUNDED_SYSTEM_PROMPT` + preambles + numbered context;
   answer must cite). Not grounded → `buildDeferralMessage(...)`; from Phase E onward the
   routing hint comes from the routing engine.
8. Persist: upsert `da_conversations`, insert user + assistant `da_messages`
   (`citations` jsonb, `deferred` flag).
9. Respond `{ messageId, content, citations, deferred, safety: {lifeSafety, access} }`.

---

## 4. Status board

| Phase | Scope                                                                       | Status                      |
| ----- | --------------------------------------------------------------------------- | --------------------------- |
| A     | Foundations: schema, scope substrate, embeddings seam                       | **DONE** (verified; see §9) |
| B1    | Pure Q&A core: chunking, retrieval, citations, guardrails, prompts          | **DONE** (verified; see §9) |
| B2    | Q&A I/O: `match_kb_chunks` RPC, ingest script, `da-ask` EF, fixtures, pgTAP | **DONE** (verified; see §9) |
| C     | Per-house overlay + scoping through retrieval, all houses                   | **DONE** (verified; see §9) |
| D     | Redaction pipeline (two representations) + output guardrail wiring          | **DONE** (verified; see §9) |
| E     | Escalation routing engine + live duty-state resolution                      | **DONE** (verified; see §9) |
| F0    | Critical-alert notification tier                                            | **DONE** (verified; see §9) |
| F     | Page drafting + handoff adapters                                            | **DONE** (verified; see §9) |
| G     | Surfaces: standalone responsive web, desk view, mobile                      | **DONE** (verified; see §9) |

---

## 5. Phases in detail

Every phase ends with: core Vitest green (`tests/desk-assistant/`), full core suite green,
`tsc --noEmit` + eslint clean, migration validated via rolled-back transaction (if any),
and the progress log in §9 updated. "BLOCKED-INPUT" marks the seam awaiting user content —
build against the placeholder, never wait.

### Phase A — Foundations — DONE

Shipped: migration `20260710000001_desk_assistant_foundations.sql` (pgvector; enums
`da_sensitivity_enum`, `da_source_type_enum`; tables `kb_documents`, `kb_chunks` with
`vector(1024)` + HNSW cosine index, `da_conversations`, `da_messages`; placeholder scope
function `da_can_read_item`; RLS same-migration). Core: `types.ts`, `scope.ts`,
`embeddings.ts`. 22 Vitest. NOTE: migration validated but **not yet applied** (see §0.2
drift); pgTAP lands in B2 per commit-grouping convention.

### Phase B1 — Pure grounded-Q&A core — DONE

Shipped in `packages/core/src/desk-assistant/`: `chunking.ts` (paragraph packing, overlap,
hard-split), `retrieval.ts` (`selectContext`: scope-filter → rank → per-doc cap → topK →
grounded-or-defer; constants exported), `citations.ts` (`buildCitations`,
`formatCitationLine`, dashless), `guardrails.ts` (`detectLifeSafety`,
`mentionsAccessDecision`, `looksLikeIncidentProbe`), `prompts.ts`
(`GROUNDED_SYSTEM_PROMPT`, `buildDeferralMessage`, `lifeSafetyPreamble`,
`INCIDENT_PROBE_REFUSAL`). 23 Vitest (45 total desk-assistant).

### Phase B2 — Q&A I/O: retrieval RPC, ingest script, da-ask, fixtures, pgTAP

**Deliverables**

- Migration `supabase/migrations/<ts>_desk_assistant_retrieval.sql`:
  ```sql
  CREATE FUNCTION match_kb_chunks(
    p_user_id uuid, p_query_embedding vector(1024), p_top_k int DEFAULT 24
  ) RETURNS TABLE (
    chunk_id uuid, document_id uuid, content text, source_ref text,
    house_scope text, sensitivity da_sensitivity_enum, allowed_roles text[],
    similarity double precision
  )
  ```
  SECURITY DEFINER, `search_path = public`; `EXECUTE` granted to `service_role` ONLY
  (the EF passes the authenticated user's id explicitly — do NOT grant to
  `authenticated`, that would be the confused-deputy shape flagged in the 2026-07-07
  audit). Body: `SELECT ..., 1 - (embedding <=> p_query_embedding) AS similarity FROM
kb_chunks WHERE embedding IS NOT NULL AND da_can_read_item(p_user_id, house_scope,
sensitivity, allowed_roles) ORDER BY embedding <=> p_query_embedding LIMIT p_top_k;`
  (pgvector 0.8 iterative scans handle the filtered ANN fine at this corpus size).
- `scripts/desk-assistant/ingest.ts` (tsx; imports `@shift/core` chunker +
  `assertEmbeddingDimension`; Voyage batch embed; inserts document + chunks; `--replace`
  deletes any prior document matching (source_type, source_ref, house_scope) first so
  re-ingestion is idempotent; denormalizes scope columns onto chunks).
- `scripts/desk-assistant/fixtures/*.md` — synthetic corpus: a fake "shared binder"
  (packages, lockouts, elevator, leak, alarm protocol), a fake "Harnwell overlay"
  (perimeter doors, key retrieval), one `restricted` HM-only item. Frontmatter carries
  metadata (source_type, source_ref, house_scope, sensitivity, allowed_roles).
  BLOCKED-INPUT (§10.2): real binders/HM guide are ingested through the SAME script;
  fixtures are then deleted with `--replace` semantics or a `--purge-fixtures` flag.
- `supabase/functions/_shared/desk-assistant.ts` — the ask-time mirror (§3.3).
- `supabase/functions/da-ask/index.ts` — the pinned pipeline (§3). CORS headers as in
  existing EFs; degrade with a clear 503 JSON if `VOYAGE_API_KEY`/`ANTHROPIC_API_KEY`
  unset.
- `supabase/tests/desk-assistant-scope.sql` — pgTAP mirroring the 22-case Vitest truth
  table against `da_can_read_item` (callable under raw psql since it is a function, not
  an RLS read), plus RLS smoke (structure for `supabase test db`).
  **Acceptance**
- Ingest fixtures locally → `da-ask` (served via `supabase functions serve`) returns a
  cited answer for "how do I retrieve a spare key at Harnwell" as a Harnwell SW, the SAME
  question as a Quad SW gets no Harnwell overlay content, and an off-corpus question
  returns `deferred: true` with the §8-compliant message. Incident-probe text returns the
  refusal without a generation call.
- pgTAP file green; core suite green; types regenerated + `@shift/shared` rebuilt.

### Phase C — Per-house overlay semantics, all houses

Overlay precedence is a RANKING concern, not just a filter: when a shared chunk and a
home-house overlay chunk both match, the overlay must win placement.
**Deliverables:** `overlay.ts` in core — `applyOverlayPrecedence(context, houseId)`:
stable re-rank where an overlay chunk outranks a shared chunk within similarity tolerance
0.05 (pinned; tune only with a test change); export and use from `selectContext` via an
optional `requesterHouseId` option. Mirror the constant into the Deno mirror. Extend the
fixture corpus with a second house overlay to prove isolation both ways.
**Tests:** Vitest (precedence, tolerance boundary, cross-house isolation); extend the
pgTAP truth table for the second overlay.
**BLOCKED-INPUT (§10.5):** the real role/house scoping matrix replaces the placeholder in
`da_can_read_item` + `scope.ts` + both test suites (one review, four files, no shape change).

### Phase D — Redaction pipeline: two representations + output guardrail

**Deliverables**

- Migration `<ts>_desk_assistant_incidents.sql`:
  ```sql
  CREATE TABLE kb_incidents_raw (
    incident_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_content text NOT NULL,
    occurred_on date,
    house_id text REFERENCES houses (id),
    classification text NOT NULL DEFAULT 'pending'
      CHECK (classification IN ('pending', 'lesson_extracted', 'private_no_lesson')),
    lesson_document_id uuid REFERENCES kb_documents (document_id),
    created_at timestamptz NOT NULL DEFAULT now()
  );
  ```
  RLS: **service-role bypass ONLY. Zero authenticated policies.** Raw incidents are
  never client-readable and never indexed (scope §7.2 rationale: if raw text is not in
  the store the retriever reads, no retrieval bug or injection can surface it).
- Core `redaction.ts`: the classify/de-identify prompt + few-shot config (pure strings),
  `RedactionDecision` types (`no_lesson` | `lesson`), and a validator that rejects a
  "lesson" containing names/emails/room numbers (regex heuristics — defense in depth
  behind the Claude pass).
- `scripts/desk-assistant/redact-incident.ts`: raw text → Claude classify+de-identify →
  on `lesson`: validator → ingest as `source_type='incident_lesson'`, link
  `lesson_document_id`, set classification; on `no_lesson`: store raw only.
- Output guardrail: `looksLikeIncidentProbe` is already wired in `da-ask` (B2); add the
  post-generation check that scans the ANSWER for incident-identifying patterns before
  returning (belt and suspenders).
  **Tests:** Vitest (validator accepts/rejects fixtures; decision types), pgTAP
  (authenticated SELECT on `kb_incidents_raw` yields zero rows/denied; no
  `incident_lesson` document may carry `sensitivity='general'` unless validator-passed —
  enforce via trigger or script-level check, pin: script-level + pgTAP shape check).
  **BLOCKED-INPUT (§10.3):** the live incident-form feed. The script is the manual path
  until the mechanism is confirmed; do not build ingestion from email/forms speculatively.

### Phase E — Context-aware escalation routing

**Deliverables**

- Migration `<ts>_desk_assistant_routing.sql`:
  ```sql
  CREATE TABLE routing_rules (
    rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_type text NOT NULL,          -- 'access' | 'equipment' | 'facilities' | ... (placeholder taxonomy)
    tier text NOT NULL CHECK (tier IN ('desk_sm','csmod','rsm','hmod','project_admin')),
    day_type text NOT NULL DEFAULT 'any' CHECK (day_type IN ('any','weekday','weekend')),
    window_start time,                  -- NULL = all day; NY wall-clock window
    window_end time,
    season_scope text NOT NULL DEFAULT 'any' CHECK (season_scope IN ('any','academic','summer')),
    priority int NOT NULL DEFAULT 0,    -- lower wins within matches
    active boolean NOT NULL DEFAULT true
  );
  ```
  RLS: service bypass + authenticated read. Seed a PLACEHOLDER ruleset (access→csmod,
  equipment→rsm-else-hmod, default→hmod) clearly marked in the seed comments.
- Core `routing.ts`: `resolveRoute(input: { issueType, atNy: {dayType, timeHHMM, season},
rules: RoutingRule[], duty: DutyStateSnapshot }): RouteDecision` — pure; picks the
  matching rule (issue_type, day/season/window, priority), then walks the tier to a
  PERSON via the snapshot (`csmod`, `rsm`, `hmod`, `project_admin` slots, each nullable)
  with fallbacks: unfilled tier → next tier up; terminal = project administrator
  (mirrors the phase-07 terminal-contact precedent). Returns
  `{ tier, userId | null, fallbackChain, ruleId }`.
- `supabase/functions/da-route/index.ts`: snapshot duty state by REUSING existing SQL —
  `resolve_hmod_on_duty(now)`, `resolve_rsm_for_house(house, now)`,
  `system_config('project_administrator_user_id')`, current season from
  operating-seasons state. **Do not fork or reimplement any duty logic.** CSMOD
  resolution: the student-manager tier contact — pin as the on-duty SM slot resolved from
  the schedule; placeholder until the real ladder arrives. `da-ask`'s deferral path calls
  the same snapshot+resolve to append a live routing hint.
  **Tests:** Vitest — rule matching across day/season/window permutations, priority ties,
  leave-fallback walk, empty-duty terminal contact. Injected clock ALWAYS (repo rule:
  never read a clock inside tested logic).
  **BLOCKED-INPUT (§10.1, the single most important input):** the real ladder/windows
  replace the seed + possibly the placeholder taxonomy enum values. Table shape and engine
  are built to absorb that as data.

### Phase F0 — Critical-alert notification tier

Additive severity through the EXISTING delivery machinery (phase-12 system). No staffing
notification changes.
**Deliverables**

- Migration: `da_page_deliveries` (page_id FK → Phase F drafts, recipient, status
  `pending|delivered|responded`, `severity` fixed `'critical'`, timestamps) + a
  `snapshot_page_ack_reminders` cadence helper — ONE helper used by every send path
  (phase-12 lesson: the force-trigger path once missed the cadence because it was
  inlined; do not repeat).
- `dispatch-push` extension: a `severity: 'critical'` payload branch → Android
  full-screen-intent channel id + custom sound name; iOS time-sensitive/critical
  interruption-level + sound asset. **Degrades to a normal high-priority push when the
  platform entitlement/channel is absent** (entitlements + sound assets are deploy-time
  config, per repo precedent). Web surface degrades to an in-app blocking banner
  (scope §3 platform limitation: web push is never a hard dependency).
- Re-notification until `responded` via the existing pending-deliveries re-check pattern
  (at-least-once is acceptable and precedented; do NOT stamp delivered-before-send).
  **Tests:** Vitest for the pure severity/degrade decision; pgTAP for delivery-row RLS
  (recipient + author read).

### Phase F — AI-assisted page drafting + handoff

**Deliverables**

- Migration `<ts>_desk_assistant_pages.sql`: `da_page_drafts` (draft_id, conversation_id,
  author_user_id, issue_type, `fields jsonb` (collected critical fields),
  `missing_fields text[]`, body text, recipient_user_id (nullable until send),
  status `draft|sent|responded|cancelled`, handoff_adapter `app_notification|legacy_pager`,
  timestamps). RLS: author full CRUD on own drafts; recipient read on sent.
- Core `page-fields.ts`: `REQUIRED_FIELDS: Record<issueType, FieldSpec[]>` (data-driven;
  placeholder specs: building-wide vs isolated, shift end time, what was already tried,
  location, callback number) + `missingFields(issueType, collected)`; `page-draft.ts`:
  draft-assembly prompt config + `PageHandoffAdapter` interface with the two adapters'
  pure formatting (`formatForNotification`, `formatForLegacyPager`), and
  `DEFAULT_HANDOFF_ADAPTER = 'app_notification'` (the §10.4 flip-point).
- `supabase/functions/da-draft-page/index.ts`: classify issue type (Claude, constrained
  choice) → compute missing fields → EITHER return questions (the UI asks only for what
  is missing) OR assemble the draft (Claude) + resolve recipient via Phase E → persist
  draft, return for review. **Never sends.**
- `supabase/functions/da-send-page/index.ts`: takes a reviewed (possibly edited) draft +
  chosen adapter; `app_notification` → Phase F0 delivery to the resolved recipient;
  `legacy_pager` → returns the formatted text for the worker to paste. Records status.
  Human-in-the-loop is STRUCTURAL: send is a separate endpoint from draft, and it
  requires the caller to be the draft's author.
  **Tests:** Vitest (field resolution, missing-field logic, both adapters' formatting —
  dashless), pgTAP (draft RLS; a non-author cannot send someone else's draft).

### Phase G — Surfaces: standalone responsive web, desk view, mobile

Web leads (locked decision 3).
**Deliverables**

- `apps/web/components/assistant/DeskAssistant.tsx` — the single mount component: chat
  thread, streamed answer rendering, citation chips (from `citations` jsonb), routing
  card ("contact X now" via `da-route`), draft-review modal (edit freely / send as-is /
  choose adapter), guardrail styling (life-safety preamble visually loud).
- Routes: `apps/web/app/(assistant)/assistant/page.tsx` (responsive phone+laptop; own
  minimal shell, NOT the admin AppShell) and
  `apps/web/app/(assistant)/assistant/desk/page.tsx` (desk-monitor layout: larger type,
  persistent conversation, idle-reset). Gate via existing auth (`proxy.ts` route
  protection); internal roles only (scope §3).
- Design: Tailwind v4 tokens, brand `#0061FC`, rounded controls + brand focus-ring per
  the web design system; **no em/en dashes in any copy**.
- Mobile (KMP), after web: shared `assistant/` ViewModel in `commonMain` (snapshot +
  injected `now`; StateFlow wrapper pattern), Compose + SwiftUI chat screens, critical-
  alert presentation (F0). KMP gotchas apply: `kotlin.concurrent.Volatile`, validate with
  `:shared:compileKotlinIosSimulatorArm64`, Maestro selectors get stable testTags.
  **Tests:** Playwright (ask → cited answer; off-corpus → deferral + routing card; draft →
  review → send stub), Vitest for any extracted pure UI logic, kotlin.test for the VM,
  Maestro flow for mobile.
  **Acceptance:** the web surface works end-to-end against fixture content at phone and
  laptop widths with zero horizontal scroll; the desk view survives a day of reuse
  (conversation reset affordance); web build green across all routes.

---

## 6. Safety guardrails → named tests (scope §8)

Every hard rule is a named, phase-assigned test, not a hope:

1. Grounded-or-defer → B2 acceptance (off-corpus deferral) + `retrieval.test.ts` grounding
   threshold cases.
2. Life-safety never substituted → `guardrails` detection tests + a Playwright case
   asserting the emergency-line preamble renders first.
3. Access inform-and-defer → `mentionsAccessDecision` tests + prompt text pinned in
   `prompts.ts` (never authorize; unsure → do not grant, escalate).
4. No incident/PII disclosure → Phase D validator + pgTAP zero-read on `kb_incidents_raw`
   - the probe-refusal path test.
5. Human-in-the-loop pages → Phase F structural split (draft ≠ send) + pgTAP author-only
   send.

---

## 7. Sequencing and commits

### 7.1 Dependency order

```
A ──> B1 ──> B2 ──> C
              ├───> D
              ├───> E ──┐
              ├───> F0 ─┼──> F ──> G (mobile tail)
              └───> G (web can start on B2's da-ask)
```

D, E, F0 are mutually independent after B2 and parallelizable. G's web surface starts
against B2 and grows as C–F land.

### 7.2 Planned commit series (nothing committed yet)

1. `docs(desk-assistant): v1 build plan` — this file + V1_SCOPE already on branch.
2. `feat(desk-assistant): KB schema, scope substrate, grounded-QA core` — migration
   `20260710000001` + B2's retrieval migration + `packages/core/src/desk-assistant/` +
   45+ Vitest + `desk-assistant-scope.sql` pgTAP + regenerated types (A+B1+B2 DB/core).
3. `feat(desk-assistant): ingest script, fixtures, da-ask` — scripts + `_shared` mirror +
   EF (B2 I/O).
4. `feat(desk-assistant): per-house overlay precedence` (C).
5. `feat(desk-assistant): incident redaction pipeline` (D, migration + script + tests).
6. `feat(desk-assistant): escalation routing engine` (E, migration + core + EF + tests).
7. `feat(desk-assistant): critical-alert delivery tier` (F0).
8. `feat(desk-assistant): page drafting and handoff` (F).
9. `feat(desk-assistant): web assistant surface` / `feat(desk-assistant): mobile
assistant` (G, split).

---

## 8. Input-arrival playbook (the seams)

When the user's PDFs/flowcharts/decisions arrive, the touch points are exactly these:

- **Escalation rules (§10.1)** → replace the `routing_rules` seed (+ taxonomy CHECK values
  if the real issue types differ); re-run Phase E permutation tests against real rules.
- **Binders / HM guide (§10.2)** → `tsx scripts/desk-assistant/ingest.ts <file> --replace`
  per document; purge fixtures; no code change.
- **Incident mechanism (§10.3)** → wire the confirmed feed into
  `redact-incident.ts`'s input side only.
- **Handoff confirmation (§10.4)** → `DEFAULT_HANDOFF_ADAPTER` constant, one line.
- **Scoping matrix (§10.5)** → `da_can_read_item` (SQL) + `scope.ts` (TS) + both truth-
  table suites, updated together in one commit.

---

## 9. Progress log

- **2026-07-10 — Decisions locked** (§1): Voyage voyage-3 (1024d); app-notification default as a
  new critical-alert tier + legacy-pager adapter; standalone responsive web surface first.
- **2026-07-10 — Phase A (Foundations) DONE + verified.**
  - Migration `20260710000001_desk_assistant_foundations.sql`: `pgvector`, enums
    (`da_sensitivity_enum`, `da_source_type_enum`), tables `kb_documents` / `kb_chunks`
    (HNSW cosine index, `vector(1024)`) / `da_conversations` / `da_messages`, the placeholder
    scoping function `da_can_read_item`, and RLS (service-role bypass + scoped authenticated
    read) in the same migration. Validated by applying inside a rolled-back transaction against
    the live local DB (all statements OK, nothing persisted). NOT yet applied for real (see
    §0.2 drift note).
  - `packages/core/src/desk-assistant/`: `types.ts`, `scope.ts` (TS mirror of `da_can_read_item`,
    the §10.5 seam), `embeddings.ts` (`EmbeddingProvider` seam, `EMBEDDING_DIM=1024`).
  - 22 Vitest (scope truth table shared with pgTAP-to-come). tsc + lint clean; full core suite
    674 green.
- **2026-07-10 — Phase B1 core (grounded Q&A logic) DONE + verified.**
  - `chunking.ts`, `retrieval.ts` (`selectContext`), `citations.ts`, `guardrails.ts`,
    `prompts.ts`. 23 more Vitest (45 desk-assistant total). tsc + lint clean.
- **2026-07-10 — Plan revised for implementer-readiness.** Corrected the EF↔core integration
  model to the repo's real pattern (SQL functions + `_shared` Deno glue + Node ingest script;
  EFs never import `packages/core`), pinned the `da-ask` pipeline and `match_kb_chunks`
  contract (service-role-only EXECUTE against the confused-deputy audit), added the migration-
  drift warning, per-phase deliverable paths/DDL sketches/acceptance criteria, the pgTAP
  runner caveat, secrets/model config, and the commit series. Renamed "Phase 4a" → Phase F0;
  split Phase B into B1 (done) / B2 (I/O, next).
- **2026-07-10 — Phase B2 (Q&A I/O) DONE + verified.**
  - Migration `20260710000002_desk_assistant_retrieval.sql`: `match_kb_chunks` RPC
    (SECURITY DEFINER, service-role-only EXECUTE, scope-filtered via `da_can_read_item`,
    cosine similarity). Applied additively to the dev DB (not a reset) + recorded in
    `schema_migrations`.
  - `scripts/desk-assistant/ingest.ts` (tsx; frontmatter parse → core chunker → Voyage or
    `--fake` offline embedder → insert; `--replace` idempotent, `--dry-run`) + 3 fixture
    docs (shared binder, Harnwell overlay, restricted HM doc).
  - `supabase/functions/_shared/desk-assistant.ts` (ask-time mirror), `voyage.ts`,
    `anthropic.ts`, and `da-ask/index.ts` (pinned pipeline; 503 without keys). EFs written,
    not run (no Deno locally — the planned untested I/O layer).
  - `supabase/tests/desk-assistant-scope.sql` pgTAP (19/19 against `da_can_read_item`,
    self-contained fixtures).
  - Verified: 54 desk-assistant Vitest (incl. mirror-parity import of the Deno file) + full
    core suite 706 green; pgTAP 19/19; ingest dry-run + `--fake` ingest of all 3 fixtures;
    live `match_kb_chunks` proves a Harnwell SW sees the Harnwell overlay + shared corpus
    while a Quad SW sees only shared and neither sees the restricted doc. Fake-embedded rows
    then removed to keep the dev DB clean for real-key ingest. tsc + lint clean.
- **2026-07-10 — Phase C (per-house overlay precedence) DONE + verified.**
  `overlay.ts` (`OVERLAY_TOLERANCE=0.05`, `overlayBoost`, `applyOverlayPrecedence`); folded an
  additive home-overlay boost into `selectContext` (opt-in `requesterHouseId`,
  backward-compatible) and the Deno `narrowContext` mirror; `da-ask` passes the worker's home
  house; added a Quad overlay fixture. Grounding stays on RAW similarity (boost affects
  placement only). 9 overlay Vitest + mirror OVERLAY_TOLERANCE parity (63 desk-assistant
  total). No migration (precedence is post-retrieval, not SQL). tsc + lint clean.
- **2026-07-10 — Phase D (incident redaction, two representations) DONE + verified.**
  Migration `20260710000003_desk_assistant_incidents.sql`: `kb_incidents_raw` with a
  service-role-bypass-ONLY policy (no authenticated/anon read path) and no embedding column.
  Core `redaction.ts`: `REDACTION_SYSTEM_PROMPT`, `validateLesson` (PII heuristics:
  email/phone/room/date/named-person), `containsIncidentLeakage` (output guardrail),
  `parseRedactionDecision`. `scripts/desk-assistant/redact-incident.ts` (raw stored always;
  lesson validated → indexed, else raw only; `--fake` offline). da-ask fails closed on
  answer leakage. 12 redaction Vitest + mirror leakage parity (76 desk-assistant total).
  Verified: pgTAP 5/5; offline demo showed private→raw-only, lesson→raw+indexed, and raw
  sensitive text never in kb_chunks (0 rows). Demo rows cleaned up. tsc + lint clean.
- **2026-07-10 — Phase E (escalation routing engine) DONE + verified.**
  Migration `20260710000004_desk_assistant_routing.sql`: `routing_rules` (issue_type, tier
  desk_sm/csmod/rsm/hmod/project_admin, day_type, NY window, season_scope, priority) + RLS +
  a clearly-marked PLACEHOLDER seed (access→csmod, equipment→rsm, facilities/general→hmod).
  Core `routing.ts`: `resolveRoute` (rule match by issue/season/day/window + priority, then
  walk `TIER_LADDER` up past unfilled slots to the terminal project admin). Deno mirror
  `_shared/desk-assistant-routing.ts` (import-free structural client) with `snapshotDutyState`
  reusing existing `resolve_hmod_on_duty`/`resolve_rsm_for_house`/project-admin config (csmod/
  desk_sm are null placeholders per §10.1); `da-route` EF; `da-ask` defer path now appends a
  live routing hint. 13 routing Vitest + 2 mirror-parity (91 desk-assistant total); seed
  verified in DB. tsc + lint clean. BLOCKED-INPUT §10.1: real ladder replaces the seed.
- **2026-07-10 — Phases F0 + F (critical-alert delivery + page drafting) DONE + verified.**
  Migrations `20260710000005_desk_assistant_pages.sql` (`da_page_drafts`; author-manages-own
  - recipient-reads-sent RLS) and `20260710000006_desk_assistant_page_delivery.sql`
    (`da_page_deliveries`; critical severity; recipient reads/responds, author reads; reminder
    columns). Core: `page-fields.ts` (`requiredFieldsFor`/`missingFields`/`isPageComplete`),
    `page-draft.ts` (both handoff adapters + `DEFAULT_HANDOFF_ADAPTER='app_notification'` flip
    point + assembly prompt), `delivery.ts` (`resolvePageAlertPresentation` per platform/
    capability with graceful degrade, reminder cadence). Deno mirror
    `_shared/desk-assistant-pages.ts`; EFs `da-draft-page` (classify + ask-only-missing +
    assemble + resolve recipient; never sends) and `da-send-page` (author-only send; records
    critical delivery + schedules re-notify; legacy-pager returns pasteable text).
    15 pages Vitest + 5 mirror-parity (111 desk-assistant total; full core suite 763).
    pgTAP `desk-assistant-pages.sql` 10/10. tsc + lint clean.
    DEVIATION (noted): the staffing `dispatch-push` is intentionally NOT modified (it is coupled
    to the `notifications` table and must stay untouched); page delivery uses its own path, so
    the critical-alert tier adds nothing to staffing notifications. iOS critical entitlement +
    Android full-screen-intent channel + the unique sound asset are deploy-time config; the code
    degrades to a prominent-but-dismissable push / web in-app banner without them.
- **2026-07-10 — Phase G (surfaces) DONE + verified.**
  - **Web (standalone, responsive):** new `apps/web/app/(assistant)/` route group with its own
    minimal auth-gated shell (NOT the admin AppShell), `assistant/` chat page + `assistant/desk/`
    desk-monitor layout. `AssistantChat.tsx` (thread, citation chips, life-safety banner, routing
    card on defer), `PageDraftModal.tsx` (pick issue → answer only-missing fields → review/edit →
    send, adapter choice). `lib/actions/assistant.ts` server actions forward the session token to
    da-ask/da-draft-page/da-send-page (forceTrigger pattern; 503 → "not configured yet"). `/assistant`
    added to proxy protected prefixes. Verified: assistant files tsc-clean (0 errors) + eslint-clean.
    NOTE: `pnpm --filter @shift/web build` currently fails on 11 PRE-EXISTING errors in the
    operating-seasons admin feature (`isAdmin` missing from lib/auth, `@shift/shared` +
    compileSeason/\*WindowInput missing from this worktree's core) — worktree drift from another
    workstream, not this feature; my routes compile clean. Live E2E needs the EFs deployed with
    Voyage/Anthropic keys.
  - **Mobile (KMP shared decision surface):** new `shared/.../assistant/` (`AssistantModels`,
    `AssistantConversation` pure transitions) + `viewmodel/AssistantViewModel.kt` (synchronous
    StateFlow wrapper in the UpdatesViewModel shape; network is the data layer, scoped out of
    tests) + 8 kotlin.test cases. Verified: `./gradlew :shared:testAndroidHostTest` compiled +
    ran my 8/8 (AssistantViewModelTest tests=8 failures=0). The suite's ONE red test is a
    pre-existing en-dash bug in FloatCarouselTest (flagged as a separate task), unrelated to this
    feature. Native Compose/SwiftUI screens are the untested UI layer (per repo convention), the
    mobile analogue of the web components. (`local.properties` sdk.dir set for the SDK at
    ~/Library/Android/sdk; gitignored.)
- **ALL PHASES A-G COMPLETE.** Remaining before production: the §10 content/decisions (real
  escalation rules, binders/HM guide, incident feed, scoping matrix) load through the built seams;
  deploy-time secrets (Voyage/Anthropic keys, iOS critical entitlement, Android full-screen channel,
  Firebase); native mobile screens + Playwright/Maestro E2E once EFs are deployed. Nothing committed.

- **2026-07-10 — Post-build fixes (user-requested, minimal).**
  - **Web build now green** (`pnpm --filter @shift/web build` exit 0). Fixed the pre-existing
    operating-seasons drift with 4 minimal changes: (1) `packages/core/src/index.ts` named
    re-export of the operating-seasons public slice (`compileSeason` + 4 `*Input` types) — a
    bare `export *` collides with cap-modification `CapEnforcement` / orchestrator `ChainStep`,
    which is why it was never in the barrel; (2) `apps/web/lib/auth.ts` added `admin` to
    `AppRole` + an `isAdmin` helper; (3) `PeopleRoster.tsx` ROLE_META gained the now-required
    `admin` entry; (4) built `@shift/shared` dist (was unbuilt). Core suite still 763.
  - **En-dashes fixed** across mobile: mechanical `–`->`-` sweep over `apps/mobile/shared/src`
    (code + tests in lockstep, so the ~65 en-dash assertions and the formatters stay aligned)
    - `androidApp/src` + `iosApp` (194+42+27 -> 0). `:shared:testAndroidHostTest` BUILD
      SUCCESSFUL (the prior lone red `FloatCarouselTest` now matches hyphen output). Em-dashes
      left untouched (out of the request's scope). The spawned en-dash task is withdrawn.
