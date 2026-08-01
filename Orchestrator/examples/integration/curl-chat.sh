#!/usr/bin/env bash
# Call Orchestrator HTTP from any project (start server first: npm run serve).
set -euo pipefail

BASE="${ORCHESTRATOR_URL:-http://127.0.0.1:8787}"
WORKSPACE="${WORKSPACE_ROOT:-$(pwd)}"
PROMPT="${1:-Hello from integration example}"

echo "GET $BASE/health"
curl -sS "$BASE/health" | head -c 500
echo
echo

echo "POST $BASE/v1/chat workspace=$WORKSPACE"
curl -sS -X POST "$BASE/v1/chat" \
  -H "Content-Type: application/json" \
  ${INTEGRATION_HTTP_TOKEN:+-H "Authorization: Bearer $INTEGRATION_HTTP_TOKEN"} \
  -d "$(jq -n --arg p "$PROMPT" --arg w "$WORKSPACE" \
    '{prompt:$p, workspaceRoot:$w, sessionId:"integration-demo", options:{toolsEnabled:false}}')"
echo
