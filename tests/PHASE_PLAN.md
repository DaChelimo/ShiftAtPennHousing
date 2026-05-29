# Shift@PennHousing — Implementation Phase Plan

This file is for human reference only. It tracks the 14-phase implementation roadmap.

> **Source of truth:** the authoritative phase roadmap lives in `prompts/` (one
> directory per phase). This table is a hand-maintained snapshot and may drift;
> when in doubt, the `prompts/` phase directories are canonical. (Resolves
> F-00-007 — the table is explicitly marked reference-only rather than rebuilt,
> since `prompts/` is `.claudeignore`d and must not be read by coding agents.)

| Phase | Name                 | Description                                                 |
| ----- | -------------------- | ----------------------------------------------------------- |
| 00    | Foundation           | Monorepo, Supabase init, Next.js, Compose Multiplatform, CI |
| 01    | Core Schema          | Houses, workers, shifts, blocks — base tables + RLS         |
| 02    | Auth                 | Supabase Auth + role mapping (staff, SM, HM, BM)            |
| 03    | Scheduling Engine    | Shift generation, block allocation, constraint enforcement  |
| 04    | Float System         | Float routing, eligibility rules, float assignment logic    |
| 05    | Claim & Swap         | Worker self-service — claim open shifts, propose swaps      |
| 06    | Pickup               | Manager-initiated pickup flows                              |
| 07    | Notifications        | Push + in-app notifications for shift events                |
| 08    | Web Dashboard        | Next.js UI — schedule view, manager controls                |
| 09    | Mobile App           | Compose Multiplatform — Android + iOS worker app            |
| 10    | Reporting            | Hours tracking, compliance exports, audit log               |
| 11    | Integrations         | External calendar sync, payroll export                      |
| 12    | Admin Panel          | House config, worker management, system settings            |
| 13a   | Maestro E2E (Mobile) | End-to-end mobile test suite via Maestro                    |
| 13b   | Playwright E2E (Web) | End-to-end web test suite via Playwright                    |
| 14    | Hardening            | Load testing, security audit, launch readiness              |
