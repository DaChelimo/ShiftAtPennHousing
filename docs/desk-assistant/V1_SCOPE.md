# Desk Assistant, v1 Scope

Working name: "Desk Assistant." A grounded, cited AI assistant that helps desk staff
answer their own questions, follow the correct procedure, reach the right contact, and,
when escalation is genuinely needed, draft a complete and correctly routed page.

Status: DRAFT for review. This is a scoping document, not a build plan. It supplements
but does not replace BEHAVIORAL_SPECIFICATION.md and ARCHITECTURE.md. Nothing here changes
any existing behavior (staffing, float, claim, swap, notifications); v1 is purely additive.

---

## 1. Problem

Desk staff page the Housing Manager on Duty (HMOD) far more than they need to, and the
pages that do go up are often incomplete. Three root causes:

1. **Knowledge gaps.** A worker hits a situation they have not seen (fire alarm affecting
   one room vs the whole building, an emergency door opened, a contractor asking for
   access, a leak, an elevator down). The correct action often exists in writing or in an
   experienced HMOD's head, but the worker cannot find it in the moment, so they page.
2. **Mis-routing.** Many pages should have gone to a different tier first (access issues to
   the student-manager tier, equipment to the IC), but the worker does not know the chain,
   which shifts by season, day, and who is on leave. The HMOD becomes the first stop instead
   of the last.
3. **Incomplete pages.** When a page is warranted, it frequently lacks the one fact the HMOD
   needs (building-wide vs isolated, shift end time, what was already tried), forcing a
   call-back and slowing resolution.

Compounding all three: onboarding new student workers and getting them up to speed is slow,
and hard-won procedural knowledge is lost when people cycle out. There is documentation
(house binders, the summer binder, an HM guide), but long guides do not get read in the
moment they are needed.

## 2. Goals and non-goals

### Goals (v1)

- Let a worker self-serve troubleshooting, general, and access questions, with answers
  **grounded in official documentation and citing their source**.
- Point a worker to the **correct current contact** for their situation, computed from
  live duty state and season/day/time rules, not a static list.
- When escalation is warranted, **collect the critical information up front and draft a
  complete, correctly categorized page**, with human review and override before it goes.
- Reduce both the **volume** and the **incompleteness** of pages reaching the HMOD.
- Shorten new-worker ramp by making experiential knowledge queryable.

### Non-goals (v1)

- **Staffing operations.** Float, claim, swap, pickup, and coverage all stay with the
  existing engine. The assistant never initiates or changes an assignment.
- **No change to the summer float rule** or any staffing behavior. The current engine is
  untouched.
- **No Allied coverage-request form digitization.** (Future.)
- **No masked / app-mediated contact.** (Out.)
- **No cost/ops dashboard** and no service-level or hospitality-vs-residential reporting.
- **No physical-pager hardware integration** assumed in v1 (see §7.4 open decision).

## 3. Users and surfaces

### Users (v1)

Internal roles only: **Student Worker (SW), Student Manager (SM), Residential Services
Manager (RSM), Housing Manager (HM)**. Allied is excluded from v1.

Answers and available knowledge are **scoped by role and house** (see §6). An SW, an SM,
and an HM asking the same question may see different levels of detail and different
contacts.

### Surfaces (all v1)

- Existing **mobile worker app** (KMP: shared logic, native UI).
- **Web app**, including a **desk-facing web view** (staff work at the desk with a monitor;
  the assistant should open there).
- A **broader SW/SM/admin web app**, device-agnostic. This app is a **separate v1 workstream
  owned by a different agent**; the Desk Assistant is one of the surfaces that mounts onto
  it. Coordinate the integration boundary with that workstream, do not rebuild it here.

**Platform limitation.** Off-mobile surfaces (both web apps) have **reduced notification and
widget support** relative to the native mobile app. Any assistant behavior that depends on
push notifications or home-screen widgets must degrade gracefully on web and must not be a
hard dependency for the core web experience.

## 4. Core capabilities

### 4.1 Grounded Q&A

Troubleshooting, general questions, and access questions. Every substantive answer is
grounded in the indexed official documentation and **states where the guidance came from**
(for example, "per the Harnwell summer binder, keys section"). The assistant does not answer
procedural questions from general model knowledge alone; if it has no grounded source, it
says so and offers to route the worker to the right contact.

### 4.2 Context-aware escalation routing

The assistant answers "who do I contact right now for this?" It does **not** just recite a
fixed ladder. Routing = a **rules layer** (which tier owns which issue type, under which
season/day/time windows) resolved against the app's **live duty state** (who is actually on
duty, accounting for leave and coverage). Correction from stakeholder: the student-manager
tier contact is the **CSMOD** (not "ASMOD," which does not exist); the exact ladder and
windows are a required design input (§10).

### 4.3 AI-assisted page drafting

When the assistant cannot resolve the situation and escalation is warranted, it:

1. Determines the issue type and the **critical fields** that type requires (for example,
   building-wide vs isolated; shift end time; what was already tried).
2. Asks the worker only for what is missing.
3. **Drafts a complete, categorized page** and resolves the correct recipient.
4. Presents it for **human review**; the worker can edit freely or send as-is.
5. Hands the page off through the existing channel (§7.4).

This directly targets the "I wish these questions were asked" pain: the HMOD receives a
complete page instead of starting from scratch or calling back. It also encodes the
callout-vs-no-show distinction and the experienced-HMOD courtesy sequence as guidance the
assistant can surface, without the assistant taking any staffing action itself.

## 5. Motivation for adoption

RHS leadership decides adoption, so v1 is framed around what moves them, alongside the
student-worker benefit:

- **Fewer and better pages**, reducing HMOD load and protecting experienced staff.
- **A defensible record.** Leadership already values written documentation of what was
  requested and done; grounded, cited, logged interactions reinforce that.
- **Faster, more consistent onboarding.**

(We deliberately exclude cost dashboards and service-level reporting from v1.)

## 6. Knowledge model

### 6.1 Sources (all pre-approved ground truth)

- The HM guide (academic year; request from the HM).
- House **binders** (rules, and who has access to what).
- The **summer binder** (official, already reviewed and verified).
- Historical incident/page records, **only via the redaction pipeline** in §7.2.

### 6.2 Shape: "same rule, different person"

Most procedures are shared across the 13 houses; the biggest per-house difference is
**contacts/directory**. So the knowledge base is a **shared rule corpus** plus a **per-house
overlay** for the cases that genuinely differ (perimeter doors, key retrieval, access
specifics, heaviest at Harnwell). Contacts are resolved from live app state, not stored as
prose in the rules.

### 6.3 Access tiers

Each knowledge item carries a **sensitivity** tag and an **audience/role scope**. Retrieval
is filtered by the asking user's role and house. Items that are private (disciplinary or
sensitive incidents) never enter the retrievable index at all (§7.2).

## 7. Architecture

Fits the existing stack: pure logic in `packages/core`, Supabase Postgres for storage and
retrieval (pgvector), Edge Functions as thin wrappers, Claude for generation and for the
classification/redaction passes. No Supabase SDK imports in `packages/core`.

### 7.1 Ingestion

Official documents are chunked, embedded (pgvector), and stored with metadata (source,
house scope, role scope, sensitivity). Ingestion is a controlled pipeline; because the
sources are already approved, no additional human approval gate is required for the binders
and guide. Incident-derived knowledge goes through §7.2 first.

### 7.2 Classification and redaction (two representations)

Primary control at **ingestion**, second layer at **retrieval**. This implements
"use as guidance, never disclose the specific incident."

- **Ingestion pass (classify + de-identify).** For any incident-derived content, produce
  two representations:
  - the **raw record**: access-controlled, **not placed in the retrievable index**;
  - a **de-identified lesson**: the generalizable takeaway (for example, "in summer,
    perimeter-door access for water-check contractors is not permitted"), which **is**
    indexed. Disciplinary/private incidents produce no indexed lesson at all.
- **Retrieval/output pass (guardrail).** A lightweight filter enforces guidance-not-
  disclosure, blocks attempts to surface specific past incidents ("tell me what happened
  the other day"), and catches leakage or prompt injection.

Rationale: if raw sensitive text lives in the vector store, a retrieval bug or injection can
surface it. Keeping it out entirely is the safer, cheaper control; the retrieval filter is
defense in depth. This is the "two LLM passes" idea, made concrete.

### 7.3 Retrieval and generation

Role- and house-scoped retrieval over the index, then a grounded generation that must cite
sources and must decline (and offer routing) when no grounded source supports an answer.
Model: Claude.

### 7.4 Escalation routing and page handoff

- **Routing rules** (issue type to owning tier, by season/day/time) live in a small,
  reviewable rules layer (candidate: `packages/core`, pure and testable).
- **Contact resolution** reuses existing app machinery: HMOD-on-duty resolution, RSM
  routing, the leave/HMOD-transfer path, and the operating-seasons/calendar state. The
  assistant reads current duty state; it does not maintain its own.
- **Page handoff (open decision).** Two candidate paths, to confirm with stakeholder:
  (a) deliver the drafted page through the app's existing notification/delivery system to
  the resolved on-duty contact; or (b) format the page for the worker to enter into the
  current pager channel, if that channel must remain authoritative. v1 assumes **no direct
  physical-pager hardware integration** until this is decided.

### 7.5 Mapping onto the existing app

- Storage + retrieval: new Supabase tables + pgvector, with RLS (role/house scoping) in the
  same migrations that create them.
- Pure logic (ranking, routing rules, redaction prompt/config, page-field requirements):
  `packages/core`, unit-tested with Vitest.
- Orchestration (embedding calls, Claude calls, retrieval): Edge Functions, thin.
- Clients: chat UI in the mobile app and web app; the desk-facing web view.
- Duty/season state and notification delivery: reuse existing functions; do not fork.

## 8. Safety, privacy, and guardrails (hard rules)

1. **Grounded and cited, or it defers.** No invented procedures. If unsupported, say so and
   route to a human.
2. **Life-safety never substituted.** For fire, medical, or emergency-door situations, the
   assistant surfaces the documented protocol and pushes the worker to the proper emergency
   line and escalation. It never positions itself as a replacement for emergency protocol.
3. **Access decisions: inform and defer, never authorize.** The assistant states policy
   (who may access what, when). When unsure, it tells the worker **not to grant** and to
   escalate. (The summer perimeter-door mistake is the canonical case.)
4. **No disclosure of specific incidents or PII.** Guidance only; private/disciplinary
   content is never indexed (§7.2).
5. **Human in the loop for pages.** The worker always reviews and can edit or override a
   drafted page before it sends.

These sit alongside, and do not alter, the existing hard invariants (Harnwell training,
float direction, no-takeback, block atomicity, NY timezone), which are assignment-level and
unaffected by v1.

## 9. Explicitly out of scope for v1

- Allied coverage-request form digitization (future).
- Any change to the summer float rule or staffing engine.
- Masked / app-mediated contact.
- Cost/ops dashboards; service-level and hospitality-vs-residential reporting.
- Allied as a user.
- Direct physical-pager hardware integration (pending §7.4 decision).
- The "5.0" item (unspecified; dropped).

## 10. Inputs needed before build

1. **Escalation rules.** The exact tier ladder (SW/desk, CSMOD, HMOD, others), which issue
   types route where, and the season/day/time windows, including leave fallbacks. This is
   the single most important design input for §4.2.
2. **Knowledge sources.** Access to the HM guide, the house binders, and the summer binder,
   in a form we can ingest.
3. **Incident-form mechanism.** Confirm how pages/incidents are currently recorded (likely
   a form that auto-generates an email) so we can decide whether and how to ingest de-
   identified lessons in v1 or defer.
4. **Page handoff decision** (§7.4): app notification vs formatted-for-legacy-pager.
5. **Role/house scoping matrix.** What each role should and should not see.

## 11. Suggested build order

1. Knowledge ingestion + retrieval + grounded, cited Q&A for a **single house (Harnwell)**,
   shared corpus only, one surface (desk web or mobile).
2. Role/house scoping + the per-house overlay; extend to all houses.
3. Redaction pipeline (§7.2) and, if approved, de-identified incident lessons.
4. Context-aware escalation routing (§4.2) using live duty state.
5. AI-assisted page drafting (§4.3) with the confirmed handoff path.

Each step is independently shippable and testable, and none touches the staffing engine.
