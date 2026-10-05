# Phase 2 wiring: Ahel login in the desktop shell

Status on `master` (Phase 2b). Packages: `@ahel/dsh-ahel-account` (service `ctx.ahelAccount`, Remote namespace `ahelAccount`), `@ahel/dsh-llm-ahel` (route `ahel`), `@ahel/dsh-client-ui-ahel-account` (browser UI).

## Done

1. Bundle: `packages/bundle/web-app/cordis.patch.yml` mounts `ahel-account`, `mcp-ahel` (`https://mcp.ahel.ai/mcp`, `auth.credentialRef: AHEL_ACCOUNT`), `llm-ahel` and `ui-ahel-account`; the packages are web-app dependencies. The standalone rows stay in [mcp-ahel.cordis.patch.yml](mcp-ahel.cordis.patch.yml) and [llm-ahel.cordis.patch.yml](llm-ahel.cordis.patch.yml) for other profiles.
2. Host RPC: `apps/desktop/src/host-settings.ts` exposes `connectHostRpc`; `ahel-account-backend.ts` calls `ahelAccount/state|signIn|cancelSignIn|signOut` and validates the view.
3. Welcome: `needsWelcome(signedIn)` returns `!signedIn`, read from `ahelAccount.state()` after the Host starts (an unreadable Host reads as signed out). The welcome-seen marker is gone.
4. Welcome window: "Sign in with Ahel" is primary. Main calls `signIn()`, opens `attempt.authorizeUrl` with `shell.openExternal` (https or loopback only), polls `state()` every second, pushes the phase to the renderer, and enters the workspace on `succeeded`. Cancel calls `cancelSignIn(id)`. Errors map `denied`, `timeout`, `network` to locale strings. "Use my own key" keeps keyless (BYO) entry.
5. Sidebar: `ui-ahel-account` fills `sidebar.footer.action` with the account entry (avatar, name or email, workspaces, Open ahel.ai, Sign out; signed out: Sign in with Ahel through `window.open`, which the shell hands to the system browser).
6. Settings > Models: `ui-ahel-account` fills `settings.models.footer` with the Ahel row (state, sign-in). BYO routes (`anthropic`, `openai`) stay on `llm-pi-ai` with keys from the same page; the `ahel` route comes from `llm-ahel` and appears in the model menu once signed in.

## Done in Phase 2b

1. Sign-out from the sidebar closes the workspace and shows the welcome at once (renderer hint over `account-changed` IPC; main re-reads `ahelAccount.state()`).
2. llm-ahel lists `GET /api/llm/v1/models` only when it answers 200; otherwise the model menu shows one disabled "Ahel (connecting…)" row and the read retries every 30 s. The route exists only while signed in. After the list loads, the first Ahel model becomes the saved default when none is saved and no bring-your-own route is configured.
3. Workspace picker in the account menu (from the `/api/mcp/profile` workspaces captured at sign-in). The choice is the `ahel-account` `workspace` setting, mirrored into the grant; MCP sends `?workspace=` (`auth.workspaceParam`), models send `?workspace=` on `/models` and `X-Ahel-Workspace` on completions.
4. Account menu links: Studio (`/app/studio`), Discover (`/discover`), Vault (`/app/vault`), ahel.ai (`/app`), each with `?workspace=` when one is chosen.
5. npm scope `@deepseek-ai/*` is now `@ahel/*`; the `dsh` CLI name stays. Profiles naming the old scope are rewritten on load.

## Left

1. Tokens live in `$DSH_HOME/.credentials.yaml` (mode 600). A Keychain provider is Phase 3.
2. The metered proxy (`/api/llm/v1`) is on ahel branch `desktop-metered-models`, not live; until it is, the menu shows "Ahel (connecting…)" and the composer has no Ahel model.
3. The workspace list is the one captured at sign-in; a workspace joined later shows after the next sign-in.

## Team features

1. Host: `ahel-account` Remote namespace `ahelTeam` calls ahel.ai `/api/desktop/*` (ahel PR #297) with the account bearer and `?workspace=`: `GET summary` (approvals, inbox unread, credits), `PATCH approvals/{id}`, `GET|POST|DELETE connect`, `GET|POST handoffs` (prepare, share, done). Redirects are refused; Connect values travel only in the POST body.
2. UI (`ui-ahel-account`): balance line and Top up in the account menu; Approvals row (Owner/Admin only) with count badge and notifications; Inbox row with unread badge; Connect sheet from Your apps and Discover; "Share with teammate" in the session menu.
3. Polling: summary every 30 s while the window has focus, at once on focus (at most every 5 s), on sign-in and workspace change, and after each team write. Signed out it makes no calls.
4. Degrades: a bare 404, or a 401 without `WWW-Authenticate` (an ahel.ai without PR #297), is `ahel-team/outdated`: the menu says "Update ahel.ai to see your balance here", Approvals, Inbox and Share say "Update ahel.ai to … here", Connect falls back to "Finish on ahel.ai". It stops polling until the next focus.
5. With no workspace chosen, the Approvals row takes the role from the summary; on an outdated ahel.ai, which sends none, it shows when any signed-in workspace is Owner or Admin.
6. Screens: `screens/team-{signed-out,outdated,signed-in}-*.png`, taken from the web profile in headless Playwright with a scratch `DSH_HOME`, a loopback stand-in for ahel.ai (PR #297 shapes) and a test grant; no real account.
7. Credits read PR #297's `workspaceSpentTodayCents` (the whole workspace's spend today).
8. Discover has no Knowledge section: its strip is Apps, MCP servers, Skills and Packs (`screens/discover-sections.png`).
