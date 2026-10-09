# syntax=docker/dockerfile:1.7
#
# ghcr.io/ahel-technologies/ahel-chat-host: one person's Ahel Host for the
# hosted chat at ahel.ai/chat. A production deploy of the `dsh` CLI on
# node:22-slim, booting the `chat` profile (the web template plus
# packages/bundle/web-app/hosted/chat.patch.yml). No Python, no Electron, no
# local CLIs. Build from the repository root:
#
#   docker build -f docker/chat-host/Dockerfile \
#     --build-arg DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD) -t ahel-chat-host .
#
# Running it locally: docs/phase4/HOSTED-CHAT.md.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm AS build
# The build context carries no .git; the client build records this commit instead.
# DSH_CLIENT_TITLE names the browser tab: "ahel", "<chat title> — ahel".
ARG DSH_CLIENT_COMMIT_HASH=0000000
ENV CI=1 DSH_TELEMETRY_DISABLED=1 DSH_CLIENT_COMMIT_HASH=${DSH_CLIENT_COMMIT_HASH} DSH_CLIENT_TITLE=ahel
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build
# A self-contained production tree: the CLI, its bundles, the built frontend
# and every workspace peer they import (runtime-manifest.mjs).
RUN node docker/chat-host/runtime-manifest.mjs \
  && pnpm install --no-frozen-lockfile --prefer-offline \
  && pnpm --filter @ahel/chat-host-runtime deploy --prod --legacy /out \
  && cp docker/chat-host/entrypoint.sh /out/entrypoint.sh \
  && chmod 0755 /out/entrypoint.sh

FROM node:${NODE_VERSION}-slim
# CHAT_READY_PATH: the ahel-account plugin's hostedReadyPath default. Its
# presence tells the chat gateway's startup probe that this image serves it.
ENV NODE_ENV=production \
    DSH_HOME=/data \
    CHAT_PORT=3080 \
    CHAT_PUBLIC_URL=https://ahel.ai/chat/ \
    CHAT_TRUSTED_HOST=ahel.ai \
    CHAT_READY_PATH=/_ahel/ready \
    NODE_OPTIONS=--max-old-space-size=320
COPY --from=build /out /app
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /data
EXPOSE 3080
# Any HTTP answer means the Host is serving; the index answers 401 without the session cookie.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.CHAT_PORT+'/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"]
ENTRYPOINT ["/app/entrypoint.sh"]
