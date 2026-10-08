---
description: "ahel.ai account for Ahel Desktop: one browser sign-in whose grant the Ahel MCP server and Ahel models share, plus the Discover catalog and team Remote namespaces."
kind: "package-reference"
---

# @ahel/dsh-ahel-account

English | [中文](README.zh.md)

## Summary

The ahel.ai account for Ahel Desktop. One browser sign-in stores one OAuth grant under the credential reference `AHEL_ACCOUNT`; the Ahel MCP server (`dsh-mcp-client` with `auth.credentialRef: AHEL_ACCOUNT`) and Ahel models (`dsh-llm-ahel`) both use it.

## Table of Contents

- [Use this package](#use-this-package)
- [Catalog: the ahelCatalog namespace](#catalog-the-ahelcatalog-namespace)
- [Team: the ahelTeam namespace](#team-the-ahelteam-namespace)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

```yaml
- id: ahel-account
  name: '@ahel/dsh-ahel-account'
```

| Field | Default | Meaning |
|---|---|---|
| `appOrigin` | `https://ahel.ai` | Authorization server and API origin |
| `resource` | `https://mcp.ahel.ai/mcp` | RFC 8707 resource the token is bound to |
| `credentialRef` | `AHEL_ACCOUNT` | Credential reference holding the grant |
| `clientName` | `Ahel Desktop` | Registered client name; ` on <host name>` is appended |
| `signInTimeoutMs` | `300000` | Wait for the browser callback |
| `requestTimeoutMs` | `30000` | Deadline per ahel.ai request |
| `refreshSkewMs` | `60000` | Refresh when the token expires within this window |
| `healthPath` | `/api/health/live` | Read on `appOrigin` to tell whether ahel.ai is reachable (`reachable` in the view) |
| `reachableIntervalMs` | `60000` | Wait between reachability reads while ahel.ai answers |
| `unreachableIntervalMs` | `5000` | Wait between reachability reads while it does not |
| `launchTokenEnv` | `AHEL_LAUNCH_TOKEN` | Environment variable holding a launch grant from ahel.ai's hosted chat; empty disables it |
| `hostedSignInPath` | `/chat/` | Path on `appOrigin` a launched Host's Sign in reloads |
| `hostedSignOutPath` | `/app/settings` | Path on `appOrigin` a launched Host's Sign out opens |

The service is `ctx.ahelAccount`; the Remote namespace `ahelAccount` exposes `state()`, `signIn()`, `cancelSignIn(id)`, `signOut()`, `profile()` and the `watch` stream. Host code also has `accessToken()` (refreshes on demand), `revalidate()` (forces one refresh after a 401), `setOpener(fn)` and `reportBilling(billing)`. `dsh-llm-ahel` calls `reportBilling` with each metered request's hold and settle; the view's `billing` then carries the latest one (phase, Session, model, held, charged and balance cents) to `watch` subscribers without emitting `ahel-account/changed`. Signing out or choosing another workspace clears it.

Sign-in copies the `ahel` CLI flow: discovery, a loopback listener on `127.0.0.1:<random port>/callback`, a fresh dynamic client registration per sign-in (a fixed client id would stay revoked forever), PKCE S256, scopes `openid profile email offline_access`, then `GET /api/mcp/profile`. `signIn()` resolves once the authorize URL exists and returns it in `attempt.authorizeUrl`; the opener set with `setOpener` opens it, otherwise it is logged. Sign-out calls `POST /api/mcp/revoke`, then deletes the credential even if the revoke failed.

### Launch grant (hosted chat)

ahel.ai's hosted chat starts one Host per person and hands it the person's sign-in through `AHEL_LAUNCH_TOKEN`: JSON `{"client_id": "...", "refresh_token": "..."}` for a first-party client ahel.ai minted. At load the plugin removes the variable from `process.env`, redeems the refresh token once at the discovered token endpoint (with `resource`), reads the profile and stores the result under `AHEL_ACCOUNT`, replacing a grant an earlier pod left on the volume. ahel.ai rotates refresh tokens, so the copy in the process environment stops working after that first refresh. `state()` and every bearer read wait for this step. A malformed or refused token is logged without its value and leaves the account signed out.

A Host launched this way reports `hosted: { signInUrl, signOutUrl }` in the view. `signIn()` and `signOut()` refuse, because the person's ahel.ai session owns the grant; the client sends Sign in to `signInUrl` (a fresh launch) and Sign out to `signOutUrl`. Hosts started without the variable report `hosted: null`.

### Chat workspace stamp

Each chat records the ahel.ai workspace it was started in. At the first step a top-level chat takes before any prompt is logged, the Host appends the log-only session event `ahel-account/chat-workspace` (`{ workspace }`) with the selected workspace, or, while none is selected, the workspace ahel.ai's team summary names for the account; a first turn cancelled before its step leaves the stamp to the next one. The event carries the envelope's `ignorable: true`, so a build that does not know it still opens the chat. The `ahelWorkspace` Session projection carries the id, or null, on every Session list row, and a fork inherits it. Chats with prompts from before the stamp existed, or started while neither workspace could be read (signed out, ahel.ai unreachable), stay unstamped. The hosted chat lists only the selected workspace's chats.

The stamp binds the chat: its Ahel MCP tool calls (answered through `mcp-client/workspace`), its card presses, its Ahel model requests and its Ahel Web Search calls (`chatWorkspace(sessionId)`, Host-only) act in the stamped workspace whatever workspace is selected later, and a subagent acts in its parent chat's. Selecting another workspace only changes which chats are listed and where new chats start; an unstamped chat follows the selection. The Remote method `pinChat(sessionId, workspace)` stamps a chat that has taken no step yet with a workspace the person has a seat in (read live from ahel.ai, else the stored profile), as a queued issue run does with its issue's workspace; otherwise it fails with `ahel-account/workspace-unavailable`. `ahelIssues.list` reads in the selected workspace, else in the account default the team summary names, and answers that id; `get`, `comment` and `run` take a run's workspace, and `run` and `comment` without one go to the workspace the run's chat acts in. `ahelIssues.confirmWaiting(id, sessionId)` reads whether one of the person's own confirm cards is still listed as waiting for their press (`GET /api/desktop/approvals`, read only) in the workspace the chat acts in.

<a id="catalog-the-ahelcatalog-namespace"></a>
## Catalog: the `ahelCatalog` namespace

A child service, `ctx.ahelCatalog`, gives the desktop the ahel.ai Discover catalog and the person's installs. Its Remote namespace `ahelCatalog` exposes six methods.
- `browse(query)` and `browsePart(query, groupKey, offset)` read the anonymous `GET /api/public/catalog-search?view=listing` that ahel.ai/discover reads. They work signed out. Row links and marks come back as absolute ahel.ai URLs.
- `browse` takes `concept` (`apps`, `mcp-servers`, `skills`, `packs`) for ahel.ai's Discover sections; an ahel.ai without the listing `concept` filter is answered from `?concept=` catalog search instead.
- `installed()`, `add(id)` and `setEnabled(key, on)` call the Ahel MCP gateway tools `installed`, `install` and `switch`. They use this account's bearer and the selected `?workspace=`, and refresh once after a 401. The desktop and ahel.ai therefore share one server state.
- Failures are `RemoteError` codes: `ahel-catalog/busy` (HTTP 429), `ahel-catalog/unreachable`, `ahel-catalog/signed-out`, and `ahel-catalog/refused`, whose message is ahel.ai's own sentence.
- The gateway has no uninstall tool, so removing an app is done on ahel.ai at `/app/apps`.

<a id="team-the-ahelteam-namespace"></a>
## Team: the `ahelTeam` namespace

A child service, `ctx.ahelTeam`, calls ahel.ai's `/api/desktop/*` routes with this account's bearer and the selected `?workspace=`; it refreshes once after a 401.
- Methods: `summary()` (approvals, unread handoffs, balance, `defaultModel`), `models()` (`GET /api/llm/v1/models` with ahel.ai's facts per model: short name, maker, best-for line, typical message price, the workspace's approximate last charge), `workspaceModel()` and `setWorkspaceModel(model)` (`GET`/`PUT /api/desktop/workspace/model`; owner or team lead only), `decideApproval(id, decision, note)`, `signIns()`, `connectPanel(app)`, `connect(app, values)`, `disconnect(app)`, `inbox()`, `openHandoff(id)`, `prepareHandoff(draft)`, `shareHandoff(share)` and `markHandoffDone(id)`.
- Errors: `ahel-team/signed-out`, `ahel-team/outdated` (ahel.ai has no `/api/desktop` yet: show "Update ahel.ai"), `ahel-team/forbidden`, `ahel-team/refused`, `ahel-team/busy` and `ahel-team/unreachable`; refusal messages are ahel.ai's own sentences.
- `connect` sends key values only to `POST /api/desktop/connect`, never logs them and never puts them in an error.
- Each read of the workspace default (`summary()`, `workspaceModel()`, `setWorkspaceModel()`) emits `ahel-account/default-model`. `default-model.ts` keeps the Host's saved default model (`agentDefaultModel`) on the workspace default, else on the first model the Ahel route lists; a listed own-key model is kept while no default is set. It re-checks on sign-in, route and settings changes. So chats the Host starts by itself (issue runs it picks up, webhooks) start where a new chat in the UI does. A chat's own pick stays with that chat.

<a id="model-experience"></a>
## Model Experience

None. The package adds no tools or prompt text. Its one session event, `ahel-account/chat-workspace`, is log-only and never reaches a model request.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The grant is stored by the credentials provider in use (`credentials-local`: `$DSH_HOME/.credentials.yaml`, mode 600). A Keychain-backed provider is Phase 3.
- No workspace picker: ahel.ai pins the token to the person's single seat or oldest membership.

<a id="dev-note"></a>
### Dev Note

Maintainers change this package with the ahel.ai API: the `/api/mcp/*`, `/api/public/catalog-search` and `/api/desktop/*` shapes live in `src/types.ts`, and the catalog generator lists them in `scripts/gen-cordis-catalog.ts`.
