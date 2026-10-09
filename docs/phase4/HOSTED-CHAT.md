# Hosted chat Host image

`ghcr.io/ahel-technologies/ahel-chat-host` runs one person's Ahel Host for the browser chat at `ahel.ai/chat/`. It is the same Host and client as Ahel Desktop's browser surface: the `chat` profile is the web template plus [`packages/bundle/web-app/hosted/chat.patch.yml`](../../packages/bundle/web-app/hosted/chat.patch.yml). ahel.ai's chat gateway runs one pod per signed-in person and owns TLS, the `/chat/` prefix and the person's session.

## What is in the image

- `node:22-slim`, a production deploy of `dsh` and its bundles under `/app`, the built web client. No Python, no Electron, no local CLIs.
- Runs as `node` (uid 1000). State lives in `DSH_HOME=/data`: the profile, Sessions, the Workspace (`/data/workspaces/default-workspace`) and `.credentials.yaml`.
- Listens on `0.0.0.0:3080` (the overlay sets the bind; the CLI still refuses `--host 0.0.0.0`).
- The overlay drops the folder picker, local CLIs, child processes and the plugin page. The entrypoint sets `DSH_MCP_STDIO=off`, so MCP servers connect over http(s) only; a `stdio` server fails to load with a one-line reason. The person keeps chat, Ahel models, their own keys (stored in their volume), the Ahel MCP server, Discover, Your apps, Approvals and Inbox.

| Variable | Default | Meaning |
|---|---|---|
| `AHEL_LAUNCH_TOKEN` | unset | Launch grant, JSON `{"client_id": "...", "refresh_token": "..."}` |
| `DSH_BROWSER_TOKEN` | unset (random) | The Host's browser launch token, chosen by the gateway: canonical base64url of 32 bytes; anything else is ignored |
| `CHAT_PUBLIC_URL` | `https://ahel.ai/chat/` | Advertised root (printed URL, web-surface prompt) |
| `CHAT_TRUSTED_HOST` | `ahel.ai` | Browser-visible authority the API fence accepts |
| `CHAT_PORT` | `3080` | Listen port |
| `DSH_HOME` | `/data` | Mount the person's volume here |

## The launch grant

The gateway asks ahel.ai for a grant minted for the first-party chat client and passes it as `AHEL_LAUNCH_TOKEN`. At load the `ahel-account` plugin removes the variable from `process.env`, redeems the refresh token once and stores the grant under `AHEL_ACCOUNT` in `/data/.credentials.yaml`, replacing a grant an earlier pod left there. ahel.ai rotates refresh tokens, so the value in the pod spec stops working 30 seconds after that first refresh. From then on the Host refreshes like Desktop (access token 1 hour, refresh token 30 days).

A Host launched with a token reports `hosted` in the account view. Its Sign in opens `https://ahel.ai/chat/?signin=1`, where the gateway deletes the person's pod (never the volume) and redirects to `/chat/`, so a new Host starts with a fresh grant. Its Sign out opens `https://ahel.ai/app/settings`; the Host refuses `signIn` and `signOut` itself. A malformed or refused token leaves the account signed out. The Host's logger has no console sink in this profile, so that shows only in the UI.

## The browser session

The gateway picks the Host's browser launch token (`DSH_BROWSER_TOKEN`, 32 random bytes in base64url) and puts it in the pod spec, so it never reads pod logs. On the bare mount it sends `GET /?token=<token>` with `Host: ahel.ai` (after stripping `/chat`); the Host answers `303 ./` with a `dsh-auth-<hash>` cookie (`Path=/`, HttpOnly, SameSite=Strict, no `Secure`), which the gateway rewrites to `Path=/chat/; Secure; SameSite=Lax`. The token survives a container restart (same pod spec), and so does the cookie, because its signing secret lives in `/data/.credentials.yaml`. The proxy preserves `Host`, strips `/chat`, forwards WebSocket upgrades (`/api/remote.mux`) and redirects `/chat` to `/chat/` ([reverse-proxy guide](../user/guide/public-deployments.md)). The Host still prints `dsh web: <public url>?token=...` on stdout.

## Theme

The chat follows the ahel.ai account theme, the `ahel.theme` cookie (`light`, `dark` or `system`; Path=/, Domain=.ahel.ai, readable by page script) that ahel.ai and app.ahel.ai write from Settings > Appearance. The `ui-hosted-chat` Host half adds a boot script after ui-theme's, so the first paint already uses the cookie's palette; the theme service starts from it, and the chat re-reads the cookie when the tab regains focus. A theme change made in the chat (the rail's Theme row or Chat settings > Appearance) writes the same cookie, with the Domain attribute only on ahel.ai hosts, and the `ahel.theme` localStorage key of the ahel.ai origin. Without the cookie the chat keeps `system`; a non-loopback page does not store the chat's own theme setting.

## Probes

Every page answers `401` without the cookie, so a Kubernetes `httpGet` probe fails. The port opens a moment before the routes are mounted, and `/` answers `404` in that window, so a listening port does not mean the Host serves. The gateway therefore checks `GET /` itself (anything but `404` or `5xx`) once per pod before it sends a browser there; the pod uses a `tcpSocket` probe on 3080. This exec probe (the image `HEALTHCHECK` uses the same command) suits liveness:

```sh
node -e "fetch('http://127.0.0.1:3080/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
```

## Run it locally

```sh
docker build -f docker/chat-host/Dockerfile \
  --build-arg DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD) -t ahel-chat-host .
docker run --rm -p 127.0.0.1:3080:3080 -v chat-data:/data \
  -e CHAT_PUBLIC_URL=http://localhost:3080/ -e CHAT_TRUSTED_HOST=localhost:3080 \
  -e AHEL_LAUNCH_TOKEN='{"client_id":"fake-client","refresh_token":"fake-refresh"}' \
  ahel-chat-host
```

Open the printed `http://localhost:3080/?token=...` URL. ahel.ai refuses the fake token, so the chat loads signed out with Sign in pointing at ahel.ai; a model key added in Settings > Models works. To test under `/chat/`, put a prefix-stripping proxy on another port and set `CHAT_PUBLIC_URL=http://localhost:<port>/chat/` and `CHAT_TRUSTED_HOST=localhost:<port>`.

To see the signed-in path without ahel.ai, run a stub that answers `/.well-known/oauth-authorization-server`, a `refresh_token` grant at its `token_endpoint` and `GET /api/mcp/profile`, and add one more overlay. Extra `docker run` arguments go to the web app, so `--patch` needs the full command:

```yaml
# stub.patch.yml, mounted at /data/stub.patch.yml
- id: ahel-account
  config:
    appOrigin: http://host.docker.internal:8198
- id: mcp-ahel
  disabled: true
- id: web-search-ahel
  disabled: true
```

```sh
docker run --rm ... --entrypoint node ahel-chat-host /app/node_modules/@ahel/dsh/lib/bin.js \
  --profile chat --from-default-profile web \
  --patch /app/node_modules/@ahel/dsh-web-app/hosted/chat.patch.yml --patch /data/stub.patch.yml \
  --no-open --public-url http://localhost:3080/ --trusted-host localhost:3080
```

`appOrigin` accepts plain HTTP only on loopback hosts, so run the stub behind an HTTPS tunnel or inside the container's network namespace when `host.docker.internal` is refused. The image's `/tmp` must allow exec (a Kubernetes `emptyDir` does; Docker's `--tmpfs /tmp` needs `exec`), because the native addon loader loads from it. Drop `--from-default-profile web` once the volume holds the `chat` profile.

## Measured (2026-10-06, Docker Desktop on an M-series Mac, linux/arm64)

| What | Result |
|---|---|
| Image | 617 MB uncompressed, `/app` 221 MB, Node 22.23 |
| Build from a clean tree | about 4 minutes, no layer cache |
| `docker run` to port listening | 1.0 s |
| RSS | 147 MB idle, 186 MB with one client connected; 1 process, no children |
| Client under `/chat/` through a local proxy | composer ready in 0.7 s (local process) and 3.0 s (first cold load from the container) |

## End to end on one machine

`scripts/run-e2e.sh <ahel checkout> [users] [turns]` runs the real chat gateway (`services/chat-gateway` from the ahel checkout) behind a TLS front, one `ahel-chat-host:e2e` container per person (`scripts/docker-k8s.mjs` answers the gateway's Kubernetes calls with Docker), and a fake ahel.ai (`scripts/fake-ahel.mjs`) that serves the session read, the grant mint with the real route's checks, the OAuth refresh with rotation, the profile and a mock model behind `/api/llm/v1`. `scripts/load.mjs` opens `/chat/` for each person in its own browser context of one headless Chromium and sends turns. Everything else in `scripts/` is the research note's measurement set: `measure.sh` (cold boot), `cdp.mjs` (client load under a prefix), `turns.mjs` (turns with RSS), `mock.mjs` and `proxy.mjs`.

Measured 2026-10-06, Docker Desktop on an M-series Mac (6 CPUs, 8 GB VM), image from master with this change:

| Run | Result |
|---|---|
| 1 person, cold (no pod, no volume) | Host page after 1.7 s (pod create, boot, readiness, cookie exchange), composer ready 2.2 s, turn 0.77 s |
| 20 people at once, cold | 20/20 signed in through their launch grants, 60/60 turns; Host page p50 7.1 s, max 9.3 s; composer p50 13.2 s, max 16.8 s; turn p50 1.4 s, p90 3.5 s; 0 failed requests, 0 console errors |
| Same 20, warm pods, new browsers | Host page p50 0.18 s, composer p50 3.1 s (20 tabs rendering in one Chromium) |
| Host RSS after 3 turns | mean 189 MB, max 207 MB (512 MiB limit) |
| `?signin=1` | old pod deleted, new pod with a fresh grant on the same volume, signed in, composer 1.5 s |
| Container restart | the spent launch token is refused once, the stored grant stays, still signed in |

The 20-person cold numbers are bound by the 6-CPU VM booting 20 Hosts and rendering 20 clients at once; arkenstone has 40 CPUs. Before the readiness check, 11 of 20 cold starts got the Host's boot-window `404` and stayed there.

## Image builds

`.github/workflows/chat-host-image.yml` builds `linux/amd64` on GitHub-hosted runners on every `v*` tag (tags `<version>`, `latest`, `sha-<short>`) and on manual dispatch (`sha-<short>`, plus `latest` from master), and pushes with the workflow's `GITHUB_TOKEN`. The first push creates the package private; make it readable by the cluster's pull secret or public in the organization's package settings.

## Go-live checklist

For the coordinator. Every cluster command uses `--context contabo-arkenstone-prod-k8s` and is recorded in the ahel repo (`infra/k8s/chat/README.md` holds the full commands). Nothing here prints a secret.

1. **Merge, in this order** (each with every check `success`, not cancelled):
   1. ahel [#338](https://github.com/ahel-technologies/ahel/pull/338) (web chat client, grant mint, `chat` lane, 25 % markup). Live: `/api/health/live` shows its head SHA.
   2. ahel [#340](https://github.com/ahel-technologies/ahel/pull/340) (gateway, `infra/k8s/chat`, app NetworkPolicy rule, nav link). Its merge publishes `ghcr.io/ahel-technologies/chat-gateway:latest`.
   3. ahel [#341](https://github.com/ahel-technologies/ahel/pull/341) (landing "No download? Chat in the browser") only after step 5 smoke passes.
2. **Publish the Host image** from ahel-desktop master: `gh workflow run chat-host-image.yml -R ahel-technologies/ahel-desktop --ref master` (tags `latest` and `sha-<short>`). Check the run's every job is `success`. The package is private; the pods pull with `ghcr-creds`, which step 3 copies.
3. **Apply the cluster side** (operator: the coordinator):
   - `kubectl --context contabo-arkenstone-prod-k8s apply -k infra/k8s/chat` (from the ahel checkout at the #340 merge).
   - Copy `ghcr-creds` from `ahel` into `ahel-chat` (README step 2, `jq` pipe).
   - Secret `ahel-chat-gateway`, key `CHAT_GATEWAY_SECRET`: one value generated with `openssl rand -hex 32`, written to namespaces `ahel` and `ahel-chat` (README step 2 loop). Created by the coordinator; record it as vault entry `CHAT_GATEWAY_SECRET` in `~/.config/ahel/secrets/SECRETS.md`.
   - `rollout restart deploy/ahel -n ahel` and `deploy/chat-gateway -n ahel-chat`.
   - Check: `kubectl --context contabo-arkenstone-prod-k8s -n ahel-chat get deploy,cronjob,netpol,resourcequota` and the admission policy's `status.typeChecking` prints nothing.
4. **Route** (operator: the coordinator, Cloudflare): tunnel `ahel`, Public hostnames, add above the `ahel.ai` rule `{"hostname": "ahel.ai", "path": "^/chat(/.*)?$", "service": "http://chat-gateway.ahel-chat.svc.cluster.local:80"}`; add a no-script Worker route `ahel.ai/chat*` and the same line in ahel `landing/edge/routes.json`; record the tunnel rule in the infra repo (`manifests/ops/cloudflared.yaml` header).
5. **Smoke on a real account**:
   1. Signed out: `curl -sI -H 'accept: text/html' https://ahel.ai/chat/` answers `302` to `/login?next=%2Fchat%2F`.
   2. Signed in on ahel.ai, open `https://ahel.ai/chat/`: "Starting your chat" for a few seconds, then the chat. One `chat-<hash>` pod in `kubectl --context contabo-arkenstone-prod-k8s -n ahel-chat get pods`; time from first load to composer (the cold start on arkenstone).
   3. The account menu shows the person and workspace (signed in through the launch grant); the model menu lists Ahel models.
   4. Send one turn on an Ahel model: the answer streams, the ledger records a `_chat` lane charge at the marked-up rate (ahel prod DB recipe), and the balance drops by that amount.
   5. Ask for something that needs an Ahel MCP write: the confirm card appears and nothing runs before approval.
   6. Reload: same Session, no new pod. Open the chat from a second browser signed in as another person: a second pod.
   7. `curl -s -X POST -H 'origin: https://evil.example' https://ahel.ai/chat/api/session/list` answers `403`; `curl -s -X POST https://ahel.ai/api/internal/chat/grant` answers `404`.
   8. After 30+ minutes idle the reaper deletes the pod; the next load starts a new one with the old Sessions.
   9. Workspaces: as a person with two ahel.ai workspaces, start a chat in each. The Chats column, Cmd+K and `@` list only the selected workspace's chats; switching in the rail swaps the list and replaces an open chat of the other workspace with a new chat; a reload into either workspace never shows the other's chats first.
   10. Isolation: `infra/k8s/chat/smoke-isolation.sh` (ahel repo) execs into a running chat pod and prints `PASS` for each wall: postgres, the `ahel-web` service, `10.43.0.1:443`, `173.249.13.52:6443`, `169.254.169.254` and another chat pod's `3080` all refuse. Any `FAIL` stops go-live.
6. **Rollback facts, captured before step 1**: the ahel deploy SHA before #338; gateway rollback is `kubectl --context contabo-arkenstone-prod-k8s -n ahel-chat scale deploy/chat-gateway --replicas=0` plus removing the tunnel rule (the nav link then leads to a 404 until #340 is reverted); Host pods go with `kubectl --context contabo-arkenstone-prod-k8s -n ahel-chat delete pods -l app.kubernetes.io/part-of=ahel-chat-host` (volumes stay). A Host image rolled back past the chat workspace stamp still opens every chat, because the `ahel-account/chat-workspace` event is written with `ignorable: true`.

Open items that do not block go-live:
- `/chat/` shares the ahel.ai origin, so script in the Host client could call `ahel.ai/api/*` with the person's session (it cannot read the HttpOnly cookie). A `chat.ahel.ai` origin removes this.
- `AHEL_LAUNCH_TOKEN` and `DSH_BROWSER_TOKEN` are readable in the pod spec by cluster operators; the launch token dies 30 s after first use.
- The Host logs nothing to the console in this profile, so a refused launch grant shows only as signed out in the UI; Sign in there replaces the pod.
- The gateway passes the switcher-cookie workspace to the mint, which checks the seat, but the Host acts in the person's default workspace until they pick one.
- Deleting an account does not yet delete its `chat-<hash>-data` volume.
- A cold Session row whose projection cache misses carries no `ahelWorkspace`, so the chat counts as the account default's workspace in the Chats list; the next Session format change must re-fold `ahelWorkspace`.
