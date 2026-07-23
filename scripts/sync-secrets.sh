#!/usr/bin/env bash
#
# scripts/sync-secrets.sh — pull dev secrets from Infisical and materialize the
# gitignored local .env files each part of the app actually reads.
#
# Infisical is the single source of truth (project "Shift@PennHousing",
# "Development" environment). Its secret names don't all match the exact env
# var names the code reads (`apps/web/lib/env.ts`,
# `supabase/functions/da-ask/index.ts`), so this script pulls once and remaps:
#
#   Infisical secret name          -> env var name / destination
#   ------------------------------    ---------------------------------------
#   CLAUDE_AI_CHATBOT_DESK_ASSISTANT -> CLAUDE_AI_CHATBOT_DESK_ASSISTANT (supabase/functions/.env)
#   CLAUDE_AI_SCHEDULING_AGENT     -> CLAUDE_AI_CREATE_SCHEDULE_KEY (apps/web/.env.local)
#   CLAUDE_AI_CHATBOT_UPLOAD_CHUNKER -> CLAUDE_AI_CHATBOT_UPLOAD_CHUNKER (apps/web/.env.local)
#   CLAUDE_AI_CHATBOT_PROPOSE      -> CLAUDE_AI_CHATBOT_PROPOSE (apps/web/.env.local)
#   CHAT_EMBEDDING_VOYAGER         -> VOYAGE_API_KEY (supabase/functions/.env + apps/web/.env.local)
#   NEXT_PUBLIC_SUPABASE_ANON      -> NEXT_PUBLIC_SUPABASE_ANON_KEY (apps/web/.env.local)
#   SUPABASE_SERVICE_ROLE          -> SUPABASE_SERVICE_ROLE_KEY (apps/web/.env.local)
#
# No generic ANTHROPIC_API_KEY anywhere on purpose (per-feature key hygiene, see
# AGENTS.md Conventions): every Anthropic call site in the repo reads a name that
# says which feature it's for. scripts/desk-assistant/redact-incident.ts (a
# manual operator CLI, not synced by this script) also reads
# CLAUDE_AI_CHATBOT_DESK_ASSISTANT — export it in your shell before running it.
#
# Re-run any time a secret changes in Infisical. Never prints secret values —
# only key names — so it's safe to run with output visible.
#
# Requires: `infisical login` once per machine, and this repo already linked
# via `infisical init` (.infisical.json, already present).

set -euo pipefail
cd "$(dirname "$0")/.."

ENVIRONMENT="${1:-dev}"

# --format=json, not dotenv: the dotenv writer wraps every value in single
# quotes, and Docker's --env-file loading (used by the Supabase Edge Runtime
# container) does NOT strip that shell-style quoting the way bash would — so
# a naive `cut` on the dotenv output bakes literal leading/trailing quote
# characters into every secret. Parsing JSON sidesteps the ambiguity entirely.
RAW_JSON="$(infisical export --env="$ENVIRONMENT" --format=json)"

get() {
  printf '%s' "$RAW_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
name = sys.argv[1]
for item in data:
    if item['key'] == name:
        sys.stdout.write(item['value'])
        break
" "$1"
}

CLAUDE_AI_CHATBOT_DESK_ASSISTANT="$(get CLAUDE_AI_CHATBOT_DESK_ASSISTANT)"
CLAUDE_AI_CREATE_SCHEDULE_KEY="$(get CLAUDE_AI_SCHEDULING_AGENT)"
CLAUDE_AI_CHATBOT_UPLOAD_CHUNKER="$(get CLAUDE_AI_CHATBOT_UPLOAD_CHUNKER)"
CLAUDE_AI_CHATBOT_PROPOSE="$(get CLAUDE_AI_CHATBOT_PROPOSE)"
VOYAGE_API_KEY="$(get CHAT_EMBEDDING_VOYAGER)"
NEXT_PUBLIC_SUPABASE_ANON_KEY="$(get NEXT_PUBLIC_SUPABASE_ANON)"
SUPABASE_SERVICE_ROLE_KEY="$(get SUPABASE_SERVICE_ROLE)"

for name in CLAUDE_AI_CHATBOT_DESK_ASSISTANT CLAUDE_AI_CREATE_SCHEDULE_KEY CLAUDE_AI_CHATBOT_UPLOAD_CHUNKER CLAUDE_AI_CHATBOT_PROPOSE VOYAGE_API_KEY \
  NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
  if [ -z "${!name}" ]; then
    echo "warning: $name resolved to empty — check the Infisical secret name mapping above" >&2
  fi
done

# --- supabase/functions/.env — Edge Functions runtime (da-ask, da-draft-page). ---
cat >supabase/functions/.env <<EOF
CLAUDE_AI_CHATBOT_DESK_ASSISTANT=$CLAUDE_AI_CHATBOT_DESK_ASSISTANT
VOYAGE_API_KEY=$VOYAGE_API_KEY
EOF

# --- apps/web/.env.local — Next.js. Keep the local-Supabase defaults for the
# URL (lib/env.ts already falls back to them); only the values Infisical
# actually owns are written here. ---
cat >apps/web/.env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
CLAUDE_AI_CREATE_SCHEDULE_KEY=$CLAUDE_AI_CREATE_SCHEDULE_KEY
CLAUDE_AI_CHATBOT_UPLOAD_CHUNKER=$CLAUDE_AI_CHATBOT_UPLOAD_CHUNKER
CLAUDE_AI_CHATBOT_PROPOSE=$CLAUDE_AI_CHATBOT_PROPOSE
VOYAGE_API_KEY=$VOYAGE_API_KEY
EOF

echo "Synced secrets from Infisical ($ENVIRONMENT) into:"
echo "  - supabase/functions/.env  (CLAUDE_AI_CHATBOT_DESK_ASSISTANT, VOYAGE_API_KEY)"
echo "  - apps/web/.env.local      (NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CLAUDE_AI_CREATE_SCHEDULE_KEY, CLAUDE_AI_CHATBOT_UPLOAD_CHUNKER, CLAUDE_AI_CHATBOT_PROPOSE, VOYAGE_API_KEY)"
echo
echo "Restart the local Supabase stack for the Edge Functions runtime to pick up the new .env:"
echo "  supabase stop && supabase start"
