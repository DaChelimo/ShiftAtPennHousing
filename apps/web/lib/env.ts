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

// Server-only. Never import this into a client component.
export const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? LOCAL_SERVICE_ROLE_KEY;

// Server-only. Powers the AI schedule generator; no local default (the
// adapter fails loudly when unset so the feature degrades to a clear error).
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

// The Claude model driving the propose/repair loop. Swap via env (e.g. to
// claude-opus-4-8) without code changes.
export const AI_SCHEDULE_MODEL = process.env.AI_SCHEDULE_MODEL ?? 'claude-sonnet-5';
