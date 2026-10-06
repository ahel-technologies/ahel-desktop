# Hosted chat Host image

`ghcr.io/ahel-technologies/ahel-chat-host` runs one person's Ahel Host for the browser chat at `ahel.ai/chat/`. It is the same Host and client as Ahel Desktop's browser surface: the `chat` profile is the web template plus [`packages/bundle/web-app/hosted/chat.patch.yml`](../../packages/bundle/web-app/hosted/chat.patch.yml). ahel.ai's chat gateway runs one pod per signed-in person and owns TLS, the `/chat/` prefix and the person's session.

## What is in the image

- `node:22-slim`, a production deploy of `dsh` and its bundles under `/app`, the built web client. No Python, no Electron, no local CLIs.
- Runs as `node` (uid 1000). State lives in `DSH_HOME=/data`: the profile, Sessions, the Workspace (`/data/workspaces/default-workspace`) and `.credentials.yaml`.
- Listens on `0.0.0.0:3080` (the overlay sets the bind; the CLI still refuses `--host 0.0.0.0`).
- The overlay drops the folder picker, local CLIs, child processes and the plugin page. The person keeps chat, Ahel models, their own keys (stored in their volume), the Ahel MCP server, Discover, Your apps, Approvals and Inbox.

| Variable | Default | Meaning |
|---|---|---|
| `AHEL_LAUNCH_TOKEN` | unset | Launch grant, JSON `{"client_id": "...", "refresh_token": "..."}` |
| `CHAT_PUBLIC_URL` | `https://ahel.ai/chat/` | Advertised root (printed URL, web-surface prompt) |
| `CHAT_TRUSTED_HOST` | `ahel.ai` | Browser-visible authority the API fence accepts |
| `CHAT_PORT` | `3080` | Listen port |
| `DSH_HOME` | `/data` | Mount the person's volume here |

## The launch grant

The gateway asks ahel.ai for a grant minted for the first-party chat client and passes it as `AHEL_LAUNCH_TOKEN`. At load the `ahel-account` plugin removes the variable from `process.env`, redeems the refresh token once and stores the grant under `AHEL_ACCOUNT` in `/data/.credentials.yaml`, replacing a grant an earlier pod left there. ahel.ai rotates refresh tokens, so the value in the pod spec stops working 30 seconds after that first refresh. From then on the Host refreshes like Desktop (access token 1 hour, refresh token 30 days).

A Host launched with a token reports `hosted` in the account view. Its Sign in reloads `https://ahel.ai/chat/` (the gateway mints a fresh grant) and its Sign out opens `https://ahel.ai/app/settings`; the Host refuses `signIn` and `signOut` itself. A malformed or refused token leaves the account signed out. The Host's logger has no console sink in this profile, so that shows only in the UI.

## The browser session

The Host prints one line on stdout at boot:

```
dsh web: https://ahel.ai/chat/?token=<launch token> (LAN: http://<pod ip>:3080/?token=<launch token>)
```

That token is the Host's browser credential for this process. The gateway reads it from the pod log once, then sends `GET /?token=<token>` with `Host: ahel.ai` (after stripping `/chat`). The Host answers `303 ./` with a `dsh-auth-<hash>` cookie (`Path=/`, HttpOnly, SameSite=Strict, no `Secure`). The gateway either rewrites it to `Path=/chat/; Secure` for the browser or keeps it and adds it to every proxied request. The proxy must preserve `Host`, strip `/chat`, forward WebSocket upgrades (`/api/remote.mux`) and redirect `/chat` to `/chat/` ([reverse-proxy guide](../user/guide/public-deployments.md)).

## Probes

Every page answers `401` without the cookie, so a Kubernetes `httpGet` probe fails. Use a `tcpSocket` probe on 3080, or this exec probe (the image `HEALTHCHECK` uses the same command):

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

`appOrigin` accepts plain HTTP only on loopback hosts, so run the stub behind an HTTPS tunnel or inside the container's network namespace when `host.docker.internal` is refused. Drop `--from-default-profile web` once the volume holds the `chat` profile.

## Measured (2026-10-06, Docker Desktop on an M-series Mac, linux/arm64)

| What | Result |
|---|---|
| Image | 617 MB uncompressed, `/app` 221 MB, Node 22.23 |
| Build from a clean tree | about 4 minutes, no layer cache |
| `docker run` to port listening | 1.0 s |
| RSS | 147 MB idle, 186 MB with one client connected; 1 process, no children |
| Client under `/chat/` through a local proxy | composer ready in 0.7 s (local process) and 3.0 s (first cold load from the container) |

## Image builds

`.github/workflows/chat-host-image.yml` builds `linux/amd64` on GitHub-hosted runners on every `v*` tag (tags `<version>`, `latest`, `sha-<short>`) and on manual dispatch (`sha-<short>`), and pushes with the workflow's `GITHUB_TOKEN`. The first push creates the package private; make it readable by the cluster's pull secret or public in the organization's package settings.
