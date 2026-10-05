#!/usr/bin/env bash
# Dev-only: boot `dsh --profile web` with the Ahel MCP row (spike OAuth) and
# the card host, in an isolated DSH_HOME, and print the ahel.ai sign-in URL.
# Signing in is a human step. After sign-in, Ahel tool results render as cards.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
HOME_DIR="${AHEL_SIGNIN_HOME:-$(mktemp -d -t ahel-signin)}"
cd "$REPO"
DSH_HOME="$HOME_DIR" corepack pnpm dsh --profile web \
  --patch docs/spike/ahel-mcp.cordis.yml \
  --patch docs/spike/desktop-no-telemetry.cordis.yml \
  --patch docs/phase1/fixture/ui-mcp-app.dev.cordis.patch.yml \
  --no-open "$@" > "$HOME_DIR/web.log" 2>&1 &
echo "dsh web started (pid $!, DSH_HOME $HOME_DIR). Waiting for the sign-in URL..."
for _ in $(seq 1 60); do
  if [ -f "$HOME_DIR/mcp-oauth/ahel.authorize-url.txt" ]; then
    echo "Open this URL and sign in to ahel.ai:"; cat "$HOME_DIR/mcp-oauth/ahel.authorize-url.txt"; echo
    grep -m1 'dsh web:' "$HOME_DIR/web.log" || true
    exit 0
  fi
  sleep 2
done
echo "No sign-in URL after 120 s; see $HOME_DIR/web.log"
