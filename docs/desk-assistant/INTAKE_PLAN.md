# Desk Assistant, Knowledge Intake Pipeline

Working name: "KB Intake." A controlled, mostly-automated pipeline for growing the Desk
Assistant knowledge base from real source documents (PDFs, markdown, plain text, and later
forwarded emails) without a human hand-pasting content into a chat and hand-writing
frontmatter each time.

Status: SPEC for review. Supplements V1_SCOPE.md (see its section 7.1 Ingestion and section
7.2 Classification/redaction). Purely additive: nothing here changes the staffing engine or
the retrieval/generation surface already built in Desk Assistant v1. It replaces the manual
`scripts/desk-assistant/ingest.ts` workflow as the primary way content enters the KB, and
reuses that script's chunk/embed/index back half unchanged.

---

## 1. Problem

Today the retrievable index grows one way: an operator turns a source (an RSM email, a
binder page, a guide) into markdown with frontmatter by hand, then runs
`tsx scripts/desk-assistant/ingest.ts <file.md>`. The chunk -> embed (Voyage voyage-3) ->
insert (`kb_documents` / `kb_chunks`) back half is already automated and fine. The manual
cost is entirely in the front half:

1. Turning a PDF / email / photo into clean text.
2. Writing the metadata (title, source_ref citation, house_scope, sensitivity,
   allowed_roles, source_type).
3. Making the section 7.2 redaction / scoping call for anything incident-derived.

That front half is what "coming to Claude and pasting" actually is, and it does not scale as
sources arrive continuously from pages and weekly emails. This spec automates the mechanical
part of the front half and leaves the operator a one-click review, so the KB grows on its
own cadence.

---

## 2. Target pipeline

Source-agnostic, five stages:

1. **Ingress.** A document arrives. v1: drag-drop upload on a web admin page. Later: a
   forwarded-email inbox drops into the same queue (section 8, deferred).
2. **Normalize.** PDF / MD / TXT (and later email) becomes clean markdown text in one
   `NormalizedDoc` shape, regardless of input format.
3. **Propose.** Claude drafts the frontmatter (title, source_ref, house_scope, sensitivity,
   allowed_roles, source_type) and runs the section 7.2 classify/redact pass, producing the
   raw-record vs de-identified-lesson split for incident-derived content.
4. **Review.** The operator sees normalized text, editable proposed metadata, and the
   redaction split in an admin queue. Edit or approve. Seconds, not a paste session.
5. **Commit.** On approve, the existing chunk -> embed -> insert path runs. Idempotent
   re-ingest keyed on `(source_type, source_ref, house_scope)` via the existing `--replace`
   semantics.

### 2.1 Locked design decisions

| Decision               | Choice                  | Why                                                                                                                                                           |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ingress mechanism (v1) | Web admin upload page   | Web-first is already locked; human-in-loop by construction; least new infra. Email forwarding is a later phase.                                               |
| Automation level       | Propose-then-approve    | Nothing goes live until the operator approves. Matches the section 8 safety rules and the "sources are pre-approved" invariant. Still removes all paste toil. |
| Input formats (v1)     | Text-layer PDF + MD/TXT | Covers digital PDFs, email-exported-as-PDF, and already-bulleted markdown. No OCR. Scans/photos deferred to a vision-OCR follow-on.                           |

### 2.2 Why the review step stays

The safety rules already governing the assistant force it:

- Section 8.1 grounded-and-cited: only vetted procedures may reach a worker.
- Section 7.2 incident redaction: incident-derived content must be de-identified before it
  is indexed, and disciplinary/private content must never be indexed at all.
- Section 8.4 no PII.

A fully autonomous "anything that arrives goes live" pipeline cannot satisfy these for email
and incident content. This design removes the toil (parsing, chunking, embedding, drafting
metadata, running redaction) but keeps the oversight (one approve button). The machine does
the work; the operator makes the call.

---

## 3. Build phases

### Phase 1, Normalization core

Location: `packages/core/src/desk-assistant/normalize/`. Pure, no Supabase, Vitest-tested,
per the "pure logic in core" convention.

- `NormalizedDoc` type: `{ text: string; format: 'pdf' | 'markdown' | 'text'; warnings: string[] }`.
- MD / TXT passthrough plus a shared post-clean applied to every format: dehyphenate
  line-wrapped words, strip repeated page headers/footers, collapse whitespace, normalize
  bullet glyphs, and apply the no-em-dash / no-en-dash sweep so stored copy is
  punctuation-clean (project rule).
- PDF: core declares the interface `extractPdfText(buffer): NormalizedDoc` only. The actual
  text-layer parser library cannot live in the SDK-free core, so its implementation is
  injected from the EF/script layer.
- Deterministic: same input, same output.

### Phase 2, Metadata + redaction proposer

Location: prompts + schema in `packages/core/src/desk-assistant/` (extend `redaction.ts`
into a `propose` step); the Claude call in a thin Edge Function `desk-assistant-propose`.

- Input: `NormalizedDoc.text` plus optional operator hints (house, source type).
- Output: `{ proposedMeta: DocMeta, representations: { rawRecord?: string, deIdentifiedLesson?: string } }`.
- The prompt classifies incident content per section 7.2 and refuses to emit an indexed
  lesson for disciplinary/private material.
- Prompts and the output schema live in core and are fixture-tested; only the network call
  is in the EF (mirrors the existing EF/core split).

### Phase 3, Intake surface + review queue

Migration (additive) + web.

- New table `kb_intake` (section 4).
- New private Storage bucket for original uploads.
- Extend `da_source_type_enum` with `email` and `pdf_upload` (additive; existing values
  unchanged).
- Refactor the commit half of `scripts/desk-assistant/ingest.ts` (chunk -> Voyage ->
  insert `kb_documents` / `kb_chunks`) into one shared `commitDocument()` used by BOTH the
  CLI and the web approve action, so there is exactly one write path.
- Web admin page in the existing admin area (HM / BM / RSM): drag-drop upload -> the row
  enters the queue -> a review panel shows normalized text, editable proposed frontmatter,
  and the raw-vs-lesson split -> Approve (calls `commitDocument`) or Reject.

### Phase 4, Automated email feed (deferred, not built in this pass)

Documented seam only: an inbound-email webhook (for example SendGrid/Postmark inbound) that
parses a forwarded RSM email into `NormalizedDoc` and drops it into the same `kb_intake`
queue as `source_type = email`. Same review/approve path, different ingress. Requires
inbound-email infra and DNS, so it is out of this build.

---

## 4. Data model additions

All additive; each new table gets its RLS policies in the same migration (project rule).

### 4.1 `kb_intake` (staging)

One row per uploaded document, tracked from upload to live.

| Column                      | Type                    | Notes                                 |
| --------------------------- | ----------------------- | ------------------------------------- |
| `intake_id`                 | uuid PK                 |                                       |
| `original_storage_path`     | text                    | path in the uploads bucket            |
| `original_filename`         | text                    | as uploaded                           |
| `input_format`              | text                    | `pdf` / `markdown` / `text`           |
| `normalized_text`           | text                    | filled after normalize                |
| `proposed_meta`             | jsonb                   | filled after propose                  |
| `representations`           | jsonb                   | `{ rawRecord?, deIdentifiedLesson? }` |
| `status`                    | `da_intake_status_enum` | lifecycle, section 6.2                |
| `status_detail`             | text                    | human-readable last step / error      |
| `document_id`               | uuid FK -> kb_documents | set on commit                         |
| `created_by`                | uuid FK -> users        | uploader                              |
| `created_at` / `updated_at` | timestamptz             |                                       |

RLS: HM / BM / RSM only (reuse `user_has_house_admin_role` plus the RSM predicate, matching
the rest of the assistant admin surface). Service-role bypass for the EFs.

### 4.2 Storage bucket

Private bucket `kb-uploads` for original files. Access via signed URLs from the admin page;
service-role for the EFs. Originals are retained for provenance and re-normalization.

### 4.3 Enum extensions

- `da_source_type_enum`: add `email`, `pdf_upload`.
- New `da_intake_status_enum`: see section 6.2.

---

## 4a. Time-aware knowledge and duty routing

The naive failure this section prevents: an RSM email says "Celine Walker is backup BA"
and "all pro staff out 6/19". Indexed as flat text, a similarity search two weeks later
happily returns Celine as the contact, or cites a leave window that has expired. And "who is
HMOD" changes every rotor week, so there is no single correct answer to store at all. Three
kinds of knowledge need three mechanisms.

### 4a.1 The taxonomy

- **Durable rules** (timeless procedure): "do not page HMOD during business hours", "only
  Harnwell residents sign out carts". Belong in the vector index. Rarely expire.
- **Live duty state** (who fills a tier right now or for a given date): resolved by TOOL
  against structured state, NEVER indexed.
- **Dated announcements** (a fact with a validity window): "Michelle out 7/10 to 7/17",
  "all pro staff out 6/19", "Celine is backup BA". Indexed, but with an effective window so
  they expire out of retrieval.

### 4a.2 What the verification established (2026-07-11)

Traced the existing duty machinery (findings recorded against BUILD tracker task 1):

- `resolve_hmod_on_duty(p_at timestamptz)` and `resolve_rsm_for_house(p_house_id, p_at)` are
  BOTH as-of-arbitrary-date capable (no internal `now()`), and both already walk `hm_leave`,
  a structured per-person date-range leave table with a `replacement_user_id` delegation
  chain. So "who is HMOD/RSM for house X as of date D, honoring leaves" is answerable today
  for any D, including future dates. The project-administrator terminal is time-invariant.
- Two real gaps: the student-manager tiers (`desk_sm`, `csmod`) have NO on-duty resolver
  (stubbed null in the `da-route` snapshot, awaiting the unbuilt section 10.1 resolver), and
  there is NO Building Administrator / backup-BA concept in the schema at all.

### 4a.3 The design that follows from it

1. **Query classification.** Before retrieval, classify the question: durable-knowledge
   (RAG) vs who-is-on-duty / who-do-I-contact (duty tool). Ambiguous or mixed questions do
   both and prefer the tool answer for the contact part. Misclassification degrades to a
   deferral per section 8.1, never a fabricated answer.
2. **Duty tool with an as-of date.** For contact questions, resolve via `resolveRoute` plus a
   `DutySnapshot` computed AS OF the asked date (reusing `resolve_hmod_on_duty` /
   `resolve_rsm_for_house`), not RAG. This is what makes "who is the contact next Tuesday"
   correct and the changing-HMOD case a non-problem. The `da-route` snapshot gains an
   optional as-of parameter (today it only resolves "now").
3. **Temporal metadata on KB items.** `kb_documents` / `kb_chunks` gain `effective_from`,
   `effective_until` (null = durable/open-ended) and a `temporality` class (`durable` |
   `until_superseded` | `expires`). Retrieval filters to the window as of the query date, so
   expired announcements drop out of the candidate set. The proposer extracts these using the
   source's own date as the anchor for relative dates ("tomorrow (6/19)"); the operator
   confirms them at review (this is why relative-date extraction being imperfect is safe).
4. **Recency / supersession.** When several in-window chunks answer one question, prefer the
   most recent source; a newer "backup BA" doc supersedes the older via the existing
   `(source_type, source_ref, house_scope)` idempotent replace.
5. **Read-only chat.** A worker asserting "the HM next Tuesday is Mary" is NEVER persisted.
   The assistant discards the assertion and answers from the tool / KB. Intake is a gated
   HM/BM/RSM pipeline; worker chat is not an ingestion path. This is structural, not a prompt.

### 4a.4 The intake split

For a source like an RSM email, the proposer classifies each item and the operator confirms
the split at review:

- durable rule -> KB (durable).
- dated announcement that maps to no structured tier (backup-BA coverage, one-off out-of-office)
  -> KB with an `effective_from`/`effective_until` window (`expires`).
- dated fact that DOES map to a structured tier the app models (an HM/BM/RSM leave) -> the
  operator is pointed at the existing `hm_leave` submission path so duty resolution honors it;
  it is not indexed as prose.

### 4a.5 Duty tiers, resolved (built 2026-07-12)

The hierarchy (reference_duty_hierarchy_roles) is SM < RSM < HM < BA, and all tiers are now
modeled:

- **BA (Building Administrator)** = the existing `bm` role, scoped per house.
  `resolve_ba_for_house(house, at)` (migration 20260712000010) resolves the leave-aware bm,
  and the routing ladder gained a `ba` tier ABOVE `hmod`. So when the RSM and HM both resolve
  out on leave, the walk-up lands on the BA (e.g. Celine). This is the canonical "who is in
  charge this week" answer, now automatic and as-of-date correct. Live-verified.
- **SMOD (Student Manager on Duty, summer)** and **CSMOD (Conferences Manager on Duty)** are
  reached via a SHARED DUTY PHONE (same number for whoever is on duty). The assistant routes
  to the tier and surfaces the configured phone (`system_config` keys `smod_duty_phone` /
  `csmod_duty_phone`); it does not resolve a person. da-ask has a dedicated smod/csmod branch,
  and the classifier detects `ba` / `smod` / `csmod` distinctly.
- The previously mislabeled CSMOD tier ("student manager on duty") is corrected to
  "Conferences Manager on Duty (CSMOD)".

Deploy/seed: Celine needs a `bm` `user_roles` row per house she covers (Rodin / Harrison /
Harnwell); deployers set the two duty-phone config keys.

---

## 5. Reuse and boundaries

- Chunking: reuse `chunkDocument()` unchanged. The already-bulleted, date-grouped emails pass
  through the normalizer untouched and chunk cleanly on their existing section boundaries.
- Embedding: reuse Voyage voyage-3 (1024-dim), `EMBEDDING_MODEL` / `EMBEDDING_DIM`.
- Write path: the single `commitDocument()` is the only place rows enter `kb_documents` /
  `kb_chunks` after this lands. The CLI keeps working (useful for bulk/scripted loads) but
  calls the same function.
- No change to retrieval, generation, routing, or page-draft. This spec ends at "content is
  live in the index."

---

## 6. Progress tracking

Two distinct things get tracked. Part A is for us while we build the feature. Part B is a
feature of the app itself, for the operator growing the KB.

### 6.1 Part A, Build progress (implementation tracking)

Purpose: at any point during implementation, anyone can see how much of the intake feature
is done and how much is pending, and the person we are building for gets reliable status
updates rather than guesses.

Mechanism:

1. **Live checklist in this doc (section 9).** Every phase is broken into concrete tasks
   with a status (Not started / In progress / Done / Blocked). It is updated as work lands,
   so this file is the single source of truth for build progress. A one-line progress
   summary (for example "9 of 21 tasks done, Phase 1 complete, Phase 3 in progress") sits at
   the top of that section.
2. **Harness task list mirror.** During implementation the same tasks are mirrored into the
   session task tracker (TaskCreate / TaskUpdate), so progress is visible in-tool and each
   task flips to in_progress / completed as it moves. The checklist in section 9 is the
   durable record; the task tracker is the live view during a working session.
3. **Reliable status updates.** After each phase (or on request) we report: what completed,
   what is in progress, what is pending, and any blockers, tied back to the section 9
   checklist so the numbers are verifiable, not vibes.

Rule: a task is only marked Done when its verification (section 7) passes, not when the code
is written. "Done" means demonstrated.

### 6.2 Part B, In-app ingestion progress (runtime tracking)

Purpose: the operator using the admin upload page always sees where each document is in the
pipeline and the overall health of the queue, so growing the KB gives reliable, visible
feedback instead of a silent script.

Per-document lifecycle. `da_intake_status_enum`:

| Status        | Meaning                                       | Operator-facing label    |
| ------------- | --------------------------------------------- | ------------------------ |
| `uploaded`    | file stored, not yet processed                | Uploaded                 |
| `normalizing` | extracting/cleaning text                      | Reading document         |
| `proposed`    | metadata + redaction drafted, awaiting review | Ready for review         |
| `in_review`   | operator has it open                          | In review                |
| `approved`    | operator approved, commit running             | Approving                |
| `embedding`   | chunk + embed + insert in flight              | Adding to knowledge base |
| `live`        | rows in `kb_chunks`, retrievable              | Live                     |
| `rejected`    | operator declined                             | Rejected                 |
| `failed`      | a step errored; `status_detail` says which    | Needs attention          |

Notes:

- `status_detail` carries the human-readable reason on `failed` (for example "PDF has no
  text layer, needs OCR") and the current step otherwise. Operator-facing labels avoid em
  and en dashes per the project copy rule.
- The status advances as each stage completes. v1 shows it live by polling (`router.refresh`
  on a short interval while any row is mid-pipeline) plus a manual Refresh; a Supabase
  Realtime subscription is the follow-on that removes the poll.

Aggregate queue view (a small dashboard on the admin page):

- Counts by status: how many awaiting review, how many live, how many failed/rejected.
- KB size: total `kb_documents` and `kb_chunks`, and last-ingested timestamp.
- This is the "how much has been done, how much is still pending" view for the content
  itself, and the reliable update surface for the person using the app.

---

## 7. Verification

- Vitest: normalize (Phase 1) and propose prompt/schema (Phase 2). Core stays the tested
  surface.
- pgTAP: `kb_intake` RLS (HM/BM/RSM only), the enum extensions, and the status lifecycle
  constraints.
- End-to-end: upload the already-processed Harnwell markdown and a sample text-layer PDF
  through the queue, watch the status advance to `live`, approve, and confirm rows land in
  `kb_chunks` and retrieval returns them with correct citations.
- Regression: the existing `ingest.ts --fake` / `--dry-run` paths still work through the
  refactored `commitDocument()`.

---

## 8. Out of scope for this build

- Inbound-email transport (Phase 4 seam): the queue accepts `source_type = email`, but the
  automated email receiver is deferred.
- Vision OCR for scanned pages and phone photos.
- Any change to retrieval, generation, routing, or page drafting.
- The section 10.5 scoping-matrix seam (still a placeholder in `da_can_read_item`); intake
  writes whatever `allowed_roles` / `sensitivity` the operator approves and inherits the
  matrix when it lands.

---

## 9. Implementation progress checklist

Progress: 24 of 25 tasks done. Full v1 built. 165 core tests green; web app type-checks
clean; migrations validated + temporal behavior proven live (rolled-back psql). The one
open item is the live end-to-end run, gated on repairing the pre-existing migration drift
(see Verification below).

### Phase 1, Normalization core (5/5) DONE

- [x] `NormalizedDoc` type + module (`normalize.ts`)
- [x] MD / TXT passthrough
- [x] Shared post-clean (dehyphenate, header/footer strip, whitespace, bullets, dash sweep)
- [x] `PdfTextExtractor` interface + injection point
- [x] Vitest coverage for normalize (14 tests green)

### Temporal + duty layer (4/4) DONE

- [x] Verify duty machinery is as-of-date capable (section 4a.2)
- [x] Temporal core: `temporal.ts` + retrieval validity filter + recency tiebreak
- [x] Query classification (`query-classify.ts`) + duty-tool routing with as-of date, wired into `da-ask`
- [x] `da-ask` resolves the duty snapshot as of the asked date (reusing `snapshotDutyState`'s existing as-of param)

### Phase 2, Metadata + redaction + temporal proposer (4/4) DONE

- [x] `propose` core: prompt + `ProposedDoc` schema + strict parser, durable/dated/structured-leave split, temporal extraction
- [x] Vitest for proposer + temporal + classify + commit
- [x] Propose step implemented as a Node web action (web-first; no Deno EF needed)
- [x] `PdfTextExtractor` seam wired in the web layer with `unpdf` (serverless pdf.js; text layer + page count; scans fall through to the "needs OCR" warning)

### Phase 3, Intake surface + review queue (9/9) DONE

- [x] Migration: `da_intake_status_enum` + `da_source_type_enum` extension
- [x] Migration: `kb_intake` table + RLS + `da_is_kb_admin`
- [x] Migration: `kb-uploads` Storage bucket + policies
- [x] Migration: temporal columns + `match_kb_chunks` p_as_of rewrite
- [x] Shared `commitDocument` row-builders in core (`commit.ts`); `ingest.ts` refactored onto them
- [x] Intake server actions (`kbIntake.ts`): upload -> normalize -> propose -> queue
- [x] Web admin page: upload + queue list with live status (`/admin/knowledge`)
- [x] Web admin: review panel (edit metadata, durable/dated/leave split, redaction lesson, approve/reject)
- [x] Aggregate queue dashboard (counts, KB size, last-ingested)

### Phase 4, Automated email feed (deferred)

- [ ] (seam only) documented; not built this pass

### Verification (2.5/3)

- [x] Vitest green (normalize, temporal, propose, classify, commit, mirror parity): 165 core tests
- [x] pgTAP written (`desk-assistant-intake.sql`); temporal filter + CHECK + RLS shape proven live via rolled-back psql
- [~] Live end-to-end (upload -> queue -> live -> retrieval): web type-checks clean; PDF extraction now wired (`unpdf`). Still blocked on repairing the pre-existing migration drift (`supabase migration repair ...`), then regenerating types and setting VOYAGE/ANTHROPIC keys.

### Duty roles (built 2026-07-12, section 4a.5)

- [x] `resolve_ba_for_house` migration (BA = leave-aware `bm`); validated + live-seeded (Celine resolves)
- [x] `ba` routing tier above `hmod` (core + mirror); BA walk-up unit-tested
- [x] Classifier + da-ask recognize `ba` / `smod` / `csmod`; SMOD/CSMOD route to tier + duty phone
- [x] `unpdf` PDF text extraction wired into the intake `extractPdf`
- [x] 167 core tests green; core builds; web tsc clean
