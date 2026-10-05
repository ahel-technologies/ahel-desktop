#!/usr/bin/env bash
# Dev-only: boot `dsh --profile web` with the MCP Apps card fixture (replay
# model + stdio fixture MCP server + card host) in an isolated DSH_HOME.
# Open the printed URL, send any prompt, and the replayed model calls the
# fixture card tool. Needs a prior `pnpm run build`. Uses no key or account.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
HOME_DIR="${AHEL_CARD_FIXTURE_HOME:-$(mktemp -d -t ahel-card-fixture)}"
export AHEL_CARD_FIXTURE_SESSION="$REPO/docs/phase1/fixture/card-fixture.session.v4.jsonl"
export AHEL_CARD_FIXTURE_SERVER="$REPO/packages/client/ui-mcp-app/tests/fixtures/cards-server.mjs"
cd "$REPO"
DSH_HOME="$HOME_DIR" exec corepack pnpm dsh --profile web \
  --patch apps/web/tests/pin-browse-picker.overlay.yml \
  --patch docs/spike/desktop-no-telemetry.cordis.yml \
  --patch docs/phase1/fixture/card-fixture.cordis.patch.yml \
  --patch docs/phase1/fixture/ui-mcp-app.dev.cordis.patch.yml \
  --no-open "$@"
