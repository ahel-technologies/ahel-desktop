#!/bin/sh
# Boot one person's hosted chat Host. State lives under $DSH_HOME (the
# person's volume). The `chat` profile is created from the shipped web
# template on first boot; the hosted overlay is applied on every boot.
# Extra arguments are passed to the web app after the image's own flags.
set -eu

# The hosted chat runs no program the person names: mcp-client refuses stdio
# servers (packages/mcp/mcp-client/src/transport.ts). Set here, after the pod
# environment, so nothing the person can configure turns it back on.
export DSH_MCP_STDIO=off

# New files are owner-only. The volume's fsGroup re-applies group read/write
# on every mount, and the Host refuses a group-readable credentials document
# (builds before the in-process repair), so narrow it before the Host starts.
umask 077
if [ -f "$DSH_HOME/.credentials.yaml" ]; then
  chmod 600 "$DSH_HOME/.credentials.yaml"
fi

mkdir -p "$DSH_HOME/workspaces"
cd "$DSH_HOME/workspaces"

set -- --no-open \
  --port "$CHAT_PORT" \
  --public-url "$CHAT_PUBLIC_URL" \
  --trusted-host "$CHAT_TRUSTED_HOST" \
  "$@"

overlay=/app/node_modules/@ahel/dsh-web-app/hosted/chat.patch.yml
if [ -f "$DSH_HOME/profiles/chat/package.json" ]; then
  exec node /app/node_modules/@ahel/dsh/lib/bin.js --profile chat --patch "$overlay" "$@"
fi
exec node /app/node_modules/@ahel/dsh/lib/bin.js --profile chat --from-default-profile web --patch "$overlay" "$@"
