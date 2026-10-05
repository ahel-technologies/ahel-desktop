#!/usr/bin/env bash
# Launch the unsigned spike build with an isolated DSH_HOME, the Ahel MCP row,
# and telemetry off. Prints the ahel.ai sign-in URL once the MCP client asks for it.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
HOME_DIR="${AHEL_SPIKE_HOME:-$HOME/.ahel-desktop-spike}"
APP="$REPO/apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/mac-arm64/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"
mkdir -p "$HOME_DIR"
cat "$REPO/docs/spike/ahel-mcp.cordis.yml" "$REPO/docs/spike/desktop-no-telemetry.cordis.yml" > "$HOME_DIR/cordis.patch.yml"
rm -f "$HOME_DIR/mcp-oauth/ahel.authorize-url.txt"
DSH_HOME="$HOME_DIR" "$APP" > "$HOME_DIR/desktop.log" 2>&1 &
echo "Ahel Desktop spike started (pid $!). Waiting for the sign-in URL..."
for _ in $(seq 1 60); do
  if [ -f "$HOME_DIR/mcp-oauth/ahel.authorize-url.txt" ]; then
    echo; echo "Open this URL and sign in to ahel.ai:"; cat "$HOME_DIR/mcp-oauth/ahel.authorize-url.txt"; exit 0
  fi
  if [ -f "$HOME_DIR/mcp-oauth/ahel.json" ] && grep -q '"tokens"' "$HOME_DIR/mcp-oauth/ahel.json"; then
    echo "Already signed in (token stored)."; exit 0
  fi
  sleep 2
done
echo "No sign-in URL after 120 s; see $HOME_DIR/desktop.log"
