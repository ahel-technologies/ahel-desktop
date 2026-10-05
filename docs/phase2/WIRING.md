# Phase 2 wiring: Ahel login in the desktop shell

Status on `phase2/ahel-login` (rebased on `master` a73af0eb64). Packages: `@deepseek-ai/dsh-ahel-account` (service `ctx.ahelAccount`, Remote namespace `ahelAccount`), `@deepseek-ai/dsh-llm-ahel` (route `ahel`), `@deepseek-ai/dsh-client-ui-ahel-account` (browser UI).

## Done

1. Bundle: `packages/bundle/web-app/cordis.patch.yml` mounts `ahel-account`, `mcp-ahel` (`https://mcp.ahel.ai/mcp`, `auth.credentialRef: AHEL_ACCOUNT`), `llm-ahel` and `ui-ahel-account`; the packages are web-app dependencies. The standalone rows stay in [mcp-ahel.cordis.patch.yml](mcp-ahel.cordis.patch.yml) and [llm-ahel.cordis.patch.yml](llm-ahel.cordis.patch.yml) for other profiles.
2. Host RPC: `apps/desktop/src/host-settings.ts` exposes `connectHostRpc`; `ahel-account-backend.ts` calls `ahelAccount/state|signIn|cancelSignIn|signOut` and validates the view.
3. Welcome: `needsWelcome(signedIn)` returns `!signedIn`, read from `ahelAccount.state()` after the Host starts (an unreadable Host reads as signed out). The welcome-seen marker is gone.
4. Welcome window: "Sign in with Ahel" is primary. Main calls `signIn()`, opens `attempt.authorizeUrl` with `shell.openExternal` (https or loopback only), polls `state()` every second, pushes the phase to the renderer, and enters the workspace on `succeeded`. Cancel calls `cancelSignIn(id)`. Errors map `denied`, `timeout`, `network` to locale strings. "Use my own key" keeps keyless (BYO) entry.
5. Sidebar: `ui-ahel-account` fills `sidebar.footer.action` with the account entry (avatar, name or email, workspaces, Open ahel.ai, Sign out; signed out: Sign in with Ahel through `window.open`, which the shell hands to the system browser).
6. Settings > Models: `ui-ahel-account` fills `settings.models.footer` with the Ahel row (state, sign-in). BYO routes (`anthropic`, `openai`) stay on `llm-pi-ai` with keys from the same page; the `ahel` route comes from `llm-ahel` and appears in the model menu once signed in.

## Left

1. Sign-out from the sidebar keeps the workspace open; the welcome returns on the next launch. Showing it at once needs main to watch `ahelAccount/watch`.
2. The model picker does not pick an Ahel model by default after sign-in.
3. Workspace picker (`X-Ahel-Workspace`) is not exposed; ahel.ai pins the token to the person's seat.
4. Tokens live in `$DSH_HOME/.credentials.yaml` (mode 600). A Keychain provider is Phase 3.
5. The metered proxy (`/api/llm/v1`) lands with ahel `desktop-metered-models`; until then the fallback model list shows and requests fail with a readable error.
