#!/bin/sh
# Boot one person's hosted chat Host. State lives under $DSH_HOME (the
# person's volume). The `chat` profile is created from the shipped web
# template on first boot; the hosted overlay is applied on every boot.
# Extra arguments are passed to the web app after the image's own flags.
set -eu

mkdir -p "$DSH_HOME/workspaces"
cd "$DSH_HOME/workspaces"

set -- --no-open \
  --port "$CHAT_PORT" \
  --public-url "$CHAT_PUBLIC_URL" \
  --trusted-host "$CHAT_TRUSTED_HOST" \
  "$@"

overlay=/app/node_modules/@ahel/dsh-web-app/hosted/chat.patch.yml
if [ -f "$DSH_HOME/profiles/chat/package.json" ]; then
  exec node /app/lib/bin.js --profile chat --patch "$overlay" "$@"
fi
exec node /app/lib/bin.js --profile chat --from-default-profile web --patch "$overlay" "$@"
