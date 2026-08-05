// Environment configuration for the admin web app.
//
// Public values (URL + anon key) reach the browser; the service-role key is
// server-only and used solely for privileged RPCs (publish_schedule) that bypass
// RLS. Local-Supabase defaults keep `next build` working without a .env (the
// well-known local anon/service keys); deployed environments override via env.
// See e2e/README.md — the E2E harness expects a seeded local Supabase.

// Well-known keys emitted by `supabase start` for the local stack.
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? LOCAL_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? LOCAL_ANON_KEY;

// Decides whether login is passwordless (email OTP) or password-based. Defaults to
// 'development' (password auth, matching the seeded abc123 local accounts) everywhere
// except a deploy target that explicitly sets NEXT_PUBLIC_AUTH_MODE=production. This is
// an env var, not a system_config row, on purpose: it decides whether a password field
// exists in the UI at all, and changing it must require a redeploy, not a runtime UPDATE
// an app admin could flip. See docs/... (2-factor / passwordless auth plan).
export const AUTH_MODE = (process.env.NEXT_PUBLIC_AUTH_MODE ?? 'development') as
  | 'production'
  | 'development';
export const PASSWORDLESS_AUTH_ENABLED = AUTH_MODE === 'production';

// The public origin of THIS web app (not Supabase). Used to build the redirect target
// for invite / password-setup / reset links so GoTrue sends the worker back to
// /auth/update-password. Must be listed in supabase/config.toml site_url /
// additional_redirect_urls (and the deployed project's Auth redirect allowlist).
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000';

// Server-only. Never import this into a client component.
export const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? LOCAL_SERVICE_ROLE_KEY;

// Server-only. Powers the AI schedule generator; no local default (the
// adapter fails loudly when unset so the feature degrades to a clear error).
// No generic-name fallback on purpose: reusing a bare ANTHROPIC_API_KEY across
// features makes per-feature spend impossible to attribute (per-feature key
// hygiene; see AGENTS.md Conventions). Every deployed environment must set
// CLAUDE_AI_CREATE_SCHEDULE_KEY explicitly.
export const AI_SCHEDULE_KEY = process.env.CLAUDE_AI_CREATE_SCHEDULE_KEY ?? '';

// The Claude model driving the plan/propose/repair loop. Opus 4.8 by default
// for the strongest schedules; override via env (e.g. AI_SCHEDULE_MODEL=
// claude-sonnet-5 for a cheaper, faster run) without code changes.
export const AI_SCHEDULE_MODEL = process.env.AI_SCHEDULE_MODEL ?? 'claude-opus-4-8';

// Server-only. Dedicated Anthropic key for the KB intake "upload chunker" — the
// vision transcription of uploaded PDF pages (flowcharts/tables/scans) in
// lib/actions/kbIntake.ts. Kept separate from the scheduling-agent key on
// purpose so this feature's spend is attributable on its own (per-feature key
// hygiene; see AGENTS.md Conventions). No local default: the caller fails loudly
// when unset rather than silently reusing another feature's key. Materialized
// into apps/web/.env.local by scripts/sync-secrets.sh from the Infisical secret
// of the same name.
export const KB_UPLOAD_CHUNKER_KEY = process.env.CLAUDE_AI_CHATBOT_UPLOAD_CHUNKER ?? '';

// Server-only. Dedicated Anthropic key for the KB intake "propose" step — the
// metadata/temporal classification of extracted text in lib/actions/kbIntake.ts
// (claudePropose). Separate from the upload-chunker (vision) key on purpose so
// extraction vs. metadata-proposal spend is attributable independently
// (per-feature key hygiene; see AGENTS.md Conventions). No local default; the
// caller fails loudly when unset. Materialized into apps/web/.env.local by
// scripts/sync-secrets.sh from the Infisical secret of the same name.
export const KB_PROPOSE_KEY = process.env.CLAUDE_AI_CHATBOT_PROPOSE ?? '';
