# @ahel/dsh-ahel-account

The ahel.ai account for Ahel Desktop. One browser sign-in stores one OAuth grant under the credential reference `AHEL_ACCOUNT`; the Ahel MCP server (`dsh-mcp-client` with `auth.credentialRef: AHEL_ACCOUNT`) and Ahel models (`dsh-llm-ahel`) both use it.

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

The service is `ctx.ahelAccount`; the Remote namespace `ahelAccount` exposes `state()`, `signIn()`, `cancelSignIn(id)`, `signOut()`, `profile()` and the `watch` stream. Host code also has `accessToken()` (refreshes on demand), `revalidate()` (forces one refresh after a 401) and `setOpener(fn)`.

Sign-in copies the `ahel` CLI flow: discovery, a loopback listener on `127.0.0.1:<random port>/callback`, a fresh dynamic client registration per sign-in (a fixed client id would stay revoked forever), PKCE S256, scopes `openid profile email offline_access`, then `GET /api/mcp/profile`. `signIn()` resolves once the authorize URL exists and returns it in `attempt.authorizeUrl`; the opener set with `setOpener` opens it, otherwise it is logged. Sign-out calls `POST /api/mcp/revoke`, then deletes the credential even if the revoke failed.

## Catalog: the `ahelCatalog` namespace

A child service, `ctx.ahelCatalog`, gives the desktop the ahel.ai Discover catalog and the person's installs. Its Remote namespace `ahelCatalog` exposes six methods.
- `browse(query)` and `browsePart(query, groupKey, offset)` read the anonymous `GET /api/public/catalog-search?view=listing` that ahel.ai/discover reads. They work signed out. Row links and marks come back as absolute ahel.ai URLs.
- `knowledge(q)` reads the anonymous `GET /api/public/catalog-search?concept=knowledge` (dataset rows) and sorts them into ahel.ai's four Knowledge products (`src/knowledge.ts`, a copy of ahel's `KNOWLEDGE_PRODUCTS`). Works signed out.
- `installed()`, `add(id)` and `setEnabled(key, on)` call the Ahel MCP gateway tools `installed`, `install` and `switch`. They use this account's bearer and the selected `?workspace=`, and refresh once after a 401. The desktop and ahel.ai therefore share one server state.
- Failures are `RemoteError` codes: `ahel-catalog/busy` (HTTP 429), `ahel-catalog/unreachable`, `ahel-catalog/signed-out`, and `ahel-catalog/refused`, whose message is ahel.ai's own sentence.
- The gateway has no uninstall tool, so removing an app is done on ahel.ai at `/app/apps`.

## Team: the `ahelTeam` namespace

A child service, `ctx.ahelTeam`, calls ahel.ai's `/api/desktop/*` routes with this account's bearer and the selected `?workspace=`; it refreshes once after a 401.
- Methods: `summary()` (approvals, unread handoffs, balance), `decideApproval(id, decision, note)`, `signIns()`, `connectPanel(app)`, `connect(app, values)`, `disconnect(app)`, `inbox()`, `openHandoff(id)`, `prepareHandoff(draft)`, `shareHandoff(share)` and `markHandoffDone(id)`.
- Errors: `ahel-team/signed-out`, `ahel-team/outdated` (ahel.ai has no `/api/desktop` yet: show "Update ahel.ai"), `ahel-team/forbidden`, `ahel-team/refused`, `ahel-team/busy` and `ahel-team/unreachable`; refusal messages are ahel.ai's own sentences.
- `connect` sends key values only to `POST /api/desktop/connect`, never logs them and never puts them in an error.

## Model Experience

None. The package adds no tools, prompt text or session events.

## Known Limitations and Deferred Work

- The grant is stored by the credentials provider in use (`credentials-local`: `$DSH_HOME/.credentials.yaml`, mode 600). A Keychain-backed provider is Phase 3.
- No workspace picker: ahel.ai pins the token to the person's single seat or oldest membership.
