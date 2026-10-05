# Ahel Desktop: Phase 0 spike report

Date: 2026-10-05. Branch: `spike/phase-0`. Base: upstream `deepseek-ai/deepseek-harness` master `5badb15` (tag `upstream-base-5badb15`, release `dsh-v0.2.1-alpha.1`).

Gate: "an Ahel action renders a card in the dsh UI". Result: **not met**, for two reasons. Sign-in is waiting on Karl. dsh also has no MCP Apps (`ui://`) renderer, so an Ahel card cannot render until Phase 1 builds one. Everything up to the sign-in URL works in the packaged app.

## Build

- Toolchain: the repo pins `pnpm@11.7.0`; the machine has 9.15.4. `corepack pnpm` resolved 11.7.0 without a global change. Node 22.19.0 satisfies `^22.19.0 || >=24`.
- `corepack pnpm install`: green in 13 s. Lefthook hooks install into this checkout (pre-commit, pre-push).
- `corepack pnpm run build`: green in 2 min 09 s. It runs the native system addon, Host tsc+tsdown, Client tsc+tsdown and the Vite web build, and records 355 client artifacts.
- No build failures. The only warnings are tsdown deprecation notices and chunks over 500 kB.

## Package

Command: `cd apps/desktop && corepack pnpm run package:mac:arm64 --unsigned` with `CSC_IDENTITY_AUTO_DISCOVERY=false`.

Upstream mac packaging cannot run without Apple credentials. It requires `DSH_DESKTOP_MACOS_SIGNING_IDENTITY`, a team ID, notarization credentials and a `CSC_LINK` p12, and it creates a temporary keychain in the user's search list. `--unsigned` was Windows-only. Failures hit, in order, and how each was fixed:

| # | Failure | Fix (spike-only, committed) |
|---|---|---|
| 1 | `--unsigned requires win-x64` | `package-target.ts`: allow `--unsigned` for `mac-arm64`; skip `withMacOSSigningKeychain`; run electron-builder with `notarize=false`; pass `DSH_DESKTOP_UNSIGNED=1` to child steps |
| 2 | Missing `apps/desktop/.env.macos` | Local gitignored file with `DSH_DESKTOP_APP_ID=ai.ahel.desktop.spike` (no secrets) |
| 3 | `DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN requires an HTTPS origin` | `.env.macos`: `DSH_DESKTOP_AUTO_UPDATE_ENV=production`, `DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN=https://policy.ahel-desktop.invalid`. Failed policy fetches do not block the app. |
| 4 | `prepare-dsh.ts` signs the runtime with a Developer ID | Skip runtime signing when `DSH_DESKTOP_UNSIGNED=1` |
| 5 | `electron-builder-config.mjs` requires signing env and `forceCodeSigning` | When unsigned: identity `-` (ad-hoc), `forceCodeSigning/notarize/dmg.sign` false, skip signature verification and DMG notarization |
| 6 | `smoke-packaged-runtime.ts` rejects unsigned on mac | Allow `mac-arm64` |

Output: `apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/`
- `mac-arm64/DeepSeek Harness.app`: 1.0 GB, ad-hoc signed (`Signature=adhoc`, hardened runtime).
- `.dmg`: 376 MB. `.zip`: 380 MB.
- The packaged runtime smoke passed (Office to PDF, skill CLI discovery, `dsh web` boot).
- One packaging run takes about 6 minutes, because it re-runs `build:official`.
- Disk: 27 GB free before and 28 GB after; it stayed above 10 GB, so no caches were cleared. The `.desktop-build` tree is the main consumer.

## Ahel MCP mount

**Auth type:** OAuth 2.1 through the better-auth MCP plugin on ahel.ai, with dynamic client registration (RFC 7591), PKCE S256, public clients (`token_endpoint_auth_method: none`) and scopes `openid profile email offline_access`. Discovery: `https://ahel.ai/.well-known/oauth-authorization-server`. The gateway's 401 carries `WWW-Authenticate: Bearer resource_metadata="https://mcp.ahel.ai/.well-known/oauth-protected-resource"`. Source: `ahel/src/app/.well-known/oauth-authorization-server/route.ts`, `ahel/src/app/api/mcp/route.ts` (`unauthorized()` near line 1216), `ahel/src/lib/mcp/session.ts`.

**dsh gap:** upstream `dsh-mcp-client` only supports static `headers` and has no OAuth. The spike adds `packages/mcp/mcp-client/src/oauth.ts`, an `OAuthClientProvider` for MCP SDK 2.0. It is enabled per row with `oauth: { enabled, callbackPort, clientName }`. The provider:
- registers the client once;
- keeps one pending authorize URL for 10 minutes so reconnect attempts do not change the PKCE verifier;
- logs the URL and writes it to `$DSH_HOME/mcp-oauth/<server>.authorize-url.txt`;
- listens on `http://127.0.0.1:<port>/callback`;
- stores the client and tokens in `$DSH_HOME/mcp-oauth/<server>.json` (mode 600).

The supervisor's reconnect loop (`maxAttempts: 1000`) picks up the token without a restart.

**Ahel-side finding:** `https://ahel.ai/mcp` advertises protected resource `https://mcp.ahel.ai`. The MCP SDK rejects that as an RFC 9728 mismatch: "Protected resource https://mcp.ahel.ai does not match expected https://ahel.ai/mcp". claude.ai tolerates the mismatch; spec-strict clients do not. The spike therefore uses **`https://mcp.ahel.ai/mcp`**, and that works. Either document mcp.ahel.ai as the connector URL, or make `ahel.ai/mcp` advertise its own resource.

**Result:** the packaged app registered as an OAuth client and stopped at the ahel.ai sign-in page. The spike created three dynamic client registrations on prod ahel.ai; none of them is a user account. Screenshots:
- `docs/spike/desktop-welcome-gate.jpg`: upstream DeepSeek welcome gate.
- `docs/spike/desktop-main-window.jpg`: main window behind the gate.
- `docs/spike/ahel-signin-page.jpg`: the ahel.ai "Connect your AI to ahel" sign-in page the authorize URL lands on.

**Karl's step (sign-in):**
1. `cd /Users/karl/dev/ahel-tech/ahel-desktop && docs/spike/run-spike-desktop.sh`
2. The script prints `https://ahel.ai/api/auth/mcp/authorize?response_type=code&client_id=…&code_challenge=…&redirect_uri=http%3A%2F%2F127.0.0.1%3A33418%2Fcallback&scope=openid+profile+email+offline_access&prompt=consent&resource=https%3A%2F%2Fmcp.ahel.ai%2F`. Open it.
3. Sign in on ahel.ai with Google or the email link, then approve. The browser shows "Signed in. You can close this tab".
4. The token lands in `~/.ahel-desktop-spike/mcp-oauth/ahel.json`, and the app connects within 30 s.

The app must stay running during sign-in, because the callback listens on port 33418.

## Card test

**Blocked on Karl sign-in. Also blocked on a missing renderer** (Phase 1 work, not a sign-in issue).
- Ahel cards are MCP Apps. Tools carry `_meta.ui.resourceUri = ui://ahel/gateway-app-<v>.html` (plus `openai/outputTemplate`) and return `structuredContent` (`ahel/src/lib/mcp/tools.ts:165-251`).
- dsh has no MCP Apps support. The repo has no `ui://`, `resourceUri` or `mcp-ui` handling.
- `dsh-mcp-client` keeps `content` and `structuredContent` but drops tool and result `_meta`.
- The Web client renders MCP results as text, plus images (`ui-tool`).
- After sign-in, Ahel actions will run and show as text and JSON tool output, not as cards.
- Needed to render a card:
  1. Carry `_meta.ui` through `mcp-client/src/tools.ts` into the tool-result event.
  2. Fetch the `ui://` resource through `mcp-resources`.
  3. Add a `ui-tool` card that mounts the HTML in a sandboxed iframe and speaks the MCP Apps postMessage bridge (`ui/initialize`, tool-result notification, proxied `tools/call`, open-link, size changes).

  Estimate: 3 to 5 days for one agent.
- Model: none was configured. Per Karl, no DeepSeek key, and no vault keys were used. The UI runs without a model. A placeholder `ANTHROPIC_API_KEY` env does not pass the welcome gate.

## Prune

Method: `dsh --profile web --dump-config` (296 rows, 258 active, 185 distinct `@deepseek-ai/*` plugin packages mounted out of 486 workspace packages). The overlay `docs/spike/prune-chat-mcp.cordis.yml` was then booted with `dsh --profile web --patch … --no-open`. It boots clean, with 0 inactive entries.

Result: **102 keep / 84 drop** of the 185 mounted packages. Lists: `docs/spike/prune-keep.txt`, `docs/spike/prune-drop.txt`.

- Keep: agent + agent-loop, llm, llm-pi-ai, llm-retry, session/persistence/query/projection, storage, settings, credentials-local, authorization, user-approval, tools + system-prompt, mcp-client + mcp-resources, web-app, host-webserver, api-gateway/remotes and the session/settings/workspace controllers, and the chat/conversation/tool/approval/settings-models client UI.
- Drop: shell, bash/pwsh, terminal, subprocess, sandbox-local, fs tools, skills, subagents (including `subagent-claude-code`), PTC, workflows, jobs, schedule, goals, plan mode, web search/fetch, office-to-pdf, open-in-app, all `deepseek-*` plugins, telemetry, and the client panels for those features.

Coupling found while pruning:
- `api-session-controller` needs the `fs` service, so `fs-sandbox` and `sandbox-policy` stay.
- `permission-presets` needs `shell`, so it is dropped.
- `session-log-deepseek` needs `deepseekLlmApiExtensions`, so it is dropped. That plugin uploads session logs inside official DeepSeek API requests.

Re-add `compaction-basic` in Phase 1: it lived only inside the presets, and long chats need it. The prune is configuration-only; workspace packages still exist and still ship in the runtime tarball set. Phase 1 deletes them from `release:pack` / `prepare:packages`.

## Licences

`pnpm licenses list --json` was saved to `docs/spike/licenses.json` (all, 1214 packages) and `docs/spike/licenses-prod.json` (prod, 479), with local paths stripped.
- All: MIT 923, Apache-2.0 102, ISC 77, BSD-3 39, BSD-2 18, BlueOak 11, MPL-2.0 7, Unknown 5, CC0 4, Unlicense 4, other permissive 24.
- Prod: MIT 351, Apache-2.0 63, BSD-3 20, ISC 19, MPL-2.0 7, BSD-2 6, Unknown 2, LGPL 1, other 10.

No GPL, AGPL, SSPL or BUSL-only package in either tree. Flagged:

| Package | Licence | Pulled in by | Action |
|---|---|---|---|
| `@anthropic-ai/claude-agent-sdk` (+ darwin-arm64) | Unknown (Anthropic Commercial Terms) | `subagent-claude-code` | Drop (pruned) |
| `@deepseek-ai/libreoffice-kit` (+ darwin-arm64) | MPL-2.0 | `desktop-host`, `office-to-pdf` | Drop (pruned) |
| `@ubjs/core`, `@ubjs/node`, `@ubjs/node-darwin-arm64` | MPL-2.0 | `experimental/computer-use-cua-driver-native` | Drop |
| `@trycua/cua-driver-darwin-arm64` | MIT AND MPL-2.0 | same | Drop |
| `lightningcss` (+ darwin-arm64) | MPL-2.0 | Vite build (dev-time) | Keep, not shipped |
| `@img/sharp-libvips-darwin-arm64` | LGPL-3.0-or-later | `sharp` via attachment-local, spill-policy | Keep with notice (dynamic lib) or drop image offload |
| `dompurify` | MPL-2.0 OR Apache-2.0 | web | Choose Apache-2.0 |
| `jszip` | MIT OR GPL-3.0 | dev | Choose MIT |
| `eslint-plugin-sonarjs` | LGPL-3.0-only | lint (dev) | Not shipped |
| `buffers`, `khroma`, `union` | Unknown (no licence field) | documentpreview, mermaid (website), web dev server | Drop or verify |
| `@modelcontextprotocol/server-everything`, `server-filesystem` | SEE LICENSE | tests (dev) | Not shipped |

## Inventory

Grep across non-test, non-doc source.

| Item | What | Paths |
|---|---|---|
| Update feed | `electron-updater` generic provider, channel `nightly`, production origin fixed to `https://download.deepseek.com` | `apps/desktop/scripts/desktop-auto-update-environment.mjs:18`, `apps/desktop/src/update-coordinator.ts` (`autoUpdater`), `update-schedule.ts`, `update-http-executor.ts` |
| Upload hosts | Tencent COS upload, `download-test.deepseek.com`, bucket `bj-toc-download-test-1320056602` | `apps/desktop/scripts/desktop-cos.ts`, `cos-operation.ts`, `desktop-upload-run.ts`, `upload-target.ts`, `installed-update-cos.ts`, `installed-update-qualification.ts` |
| Mandatory update policy | Polls a policy origin and can block the app; test auth via Feishu | `apps/desktop/src/mandatory-update-policy.ts`, `mandatory-update-window.ts`, `policy-test-auth.ts`, `scripts/desktop-policy-environment.mjs` |
| Product telemetry | OTLP logs to `https://dsh-otel-collector.deepseeksvc.com/v1/logs`, enabled whenever the profile is `desktop` | `packages/host/product-telemetry-otel/src/index.ts:47`, `packages/bundle/web-app/cordis.patch.yml` (`desktop-product-telemetry`) |
| Client analytics | `product-analytics` `enabled` defaults to true | `packages/client/product-analytics/src/index.ts:30`, `apps/desktop/src/main.ts` (`analyticsEnabled`) |
| OTel / session telemetry | Exporter rows in base | `packages/telemetry/otel`, `packages/session/session-telemetry-otel`, `packages/session/session-telemetry` |
| DeepSeek account | Platform sign-in, `platform.deepseek.com`, `api.deepseek.com` | `packages/credentials/deepseek-account`, `packages/credentials/deepseek-account-platform/src/index.ts:53-56`, `apps/desktop-host/src/platform-session.ts`, `apps/desktop/src/account-backend.ts`, `platform-view.ts`, `preload-platform-account.ts` |
| DeepSeek LLM | `llm-deepseek` (`api.deepseek.com/anthropic`), `llm-deepseek-account`, `deepseek-llm-api-extensions`, `session-log-deepseek` (session-log upload), `plugin-package-inventory-deepseek` (sends the plugin inventory) | `packages/llm/llm-deepseek/src/config.ts:106`, `packages/llm/*deepseek*`, `packages/session/session-log-deepseek`, `packages/bundle/base/cordis.patch.yml` |
| DeepSeek web search | `api.deepseek.com/anthropic/v1` | `packages/web/web-search-deepseek/src/provider.ts:34` |
| `subagent-claude-code` | Spawns Claude Code through `@anthropic-ai/claude-agent-sdk` | `packages/subagent/subagent-claude-code/*`, preset rows in `packages/bundle/web-app/presets/{standard,ptc,cordis}.patch.yml` (disabled by default) |
| Crash reports | Local crash report helper | `apps/desktop/src/crash-report.ts` |
| Sentry / PostHog | None. "sentry" hits are unrelated words ("sentry" key handlers) | — |

Spike run note: the first two packaged launches (about 5 minutes) ran with default Desktop telemetry on, so anonymous product telemetry may have reached `deepseeksvc.com`. Later runs use `docs/spike/desktop-no-telemetry.cordis.yml`. Electron also created `~/Library/Application Support/@deepseek-ai/dsh-desktop`.

### DeepSeek key, account and model UI to remove in Phase 1 (Karl decision 2)

- **Desktop welcome window.** "Welcome to DeepSeek Harness", with Sign in (DeepSeek account) and Add API Key (DeepSeek key) buttons. Files: `apps/desktop/src/client/WelcomePage.tsx`, `welcome-window.ts`, `welcome-backend.ts` (reads the `llm-deepseek` `apiKeyEnv`), `welcome-api.ts` (`needsWelcome`), `preload-welcome.ts`.
- **Desktop platform account view.** DeepSeek platform webview and account backend. Files: `apps/desktop/src/platform-view.ts`, `account-backend.ts`, `preload-platform-account.ts`, `client-metadata.ts`, `host-process.ts`.
- **Settings → Account.** Package `packages/client/ui-settings-account`: `AccountSection.tsx`, `AccountMenu.tsx` (sidebar account menu), `SignInDialog.tsx`, `bonus-notices.ts`, `contact-url.ts`.
- **Settings → Models.** Package `packages/client/ui-settings-models`:
  - `DeepSeekOnboardingDialog.tsx`;
  - `ModelsSection.tsx` special-cases `deepseek-account`;
  - `ProviderEditor.tsx` and `CustomProviderCard.tsx` carry the DeepSeek base URL presets;
  - `locales.ts` holds `deepSeekBaseUrl` and `deepSeekAccount` copy;
  - `store.ts`.
- **Model picker in the composer.** Shows "DeepSeek-V41-Flash"; the default model row is `agent-default-model` → `deepseek-official/deepseek-flash`. Files: `packages/client/ui-model-selection/src/client/ModelSelect.tsx`, `provider-order.ts` (pins `deepseek-account` / `deepseek-official` first), `locales.ts`.
- **Settings → Web search.** DeepSeek search card. Files: `packages/client/ui-settings-web-search/src/client/web-search-card-controller.ts`, `locales.ts`.
- **Chat turn error.** "Stopped because you signed out of DeepSeek." File: `packages/client/ui-chat/src/client/conversation-nodes/turn-error.ts:36`.
- **Brand.** `packages/client/ui-brand-official` (DeepSeek logo and "Into the Unknown" hero); `apps/desktop/resources/*` icons; `productName`, `artifactName` and `protocols` in `apps/desktop/scripts/electron-builder-config.mjs`; the mic-permission copy.
- **Host plugins behind those screens.** `deepseek-account` (`dsh-deepseek-account-platform`), `account-controller`, `llm-deepseek`, `llm-deepseek-account`, `web-search-deepseek`, `deepseek-llm-api-extensions`, `session-log-deepseek`, `plugin-package-inventory-deepseek`. All are disabled in `prune-chat-mcp.cordis.yml`.

## Phase 2 auth: one ahel.ai login (Karl decision 1)

Goal: the only sign-in is the ahel.ai account, and the Ahel MCP connects automatically with that session.

1. **Replace the account plugin.** Write `@ahel/desktop-account` as a drop-in for `dsh-deepseek-account-platform`, implementing the same `DeepSeekAccount` service contract that `account-controller` and `apps/desktop/src/account-backend.ts` already consume: `state()`, `watch`, sign-in attempt, sign-out. Sign-in runs the OAuth flow in `mcp-client/src/oauth.ts`, moved into this plugin: ahel.ai authorization server, DCR once per install, PKCE, loopback callback. The browser is opened by the Electron shell (`shell.openExternal`) instead of a logged URL.
2. **Where the token lives.** The access and refresh tokens and the registered `client_id` go into the credentials seam (`ctx.credentials`, provider `credentials-local` → `$DSH_HOME/.credentials.yaml`, mode 600), under one reference such as `AHEL_ACCOUNT`. On macOS, Phase 3 can swap the provider for a Keychain-backed one. The spike's JSON file in `$DSH_HOME/mcp-oauth/` goes away.
3. **How MCP picks it up.** `mcp-client` gets an `auth: { credentialRef: 'AHEL_ACCOUNT' }` option. Its `authProvider.tokens()` reads that credential per request, and refresh is written back through the same seam. The `mcp-ahel` row ships in the Ahel bundle: url `https://mcp.ahel.ai/mcp`, always on. Sign-out deletes the credential and the MCP tools disappear.
4. **Welcome gate.** `needsWelcome` becomes `!ahelAccount.loggedIn`. The DeepSeek "Add API Key" path is deleted. Model access is either BYO keys (Claude or OpenAI) in Settings → Models through `llm-pi-ai`, or the Ahel-metered gateway as a `llm-pi-ai` provider whose credential is the same `AHEL_ACCOUNT` token.
5. **One client per install.** Use RFC 7591 DCR with a fixed `client_name` "Ahel Desktop", or pre-register a first-party public client on ahel.ai, so `prompt=consent` can be skipped for the first-party app.

## Brand surfaces (Karl decision 3: Ahel tile everywhere; inventory only)

Source mark for Phase 1: `ahel/design/project/assets/Logos/ahel-tile.svg` (and `ahel-tile-on-card.svg`).

### Icons electron-builder expects

| Surface | Current file | Format and sizes to generate from the tile |
|---|---|---|
| macOS app, Dock, Finder, About panel | `apps/desktop/resources/icon-macos.png` (1024×1024 RGBA), source `icon-macos.svg`; set as `mac.icon` in `apps/desktop/scripts/electron-builder-config.mjs` | 1024×1024 PNG. electron-builder builds the `.icns` (16, 32, 64, 128, 256, 512, 1024 = 16@1x through 512@2x). Use the macOS grid: 824×824 rounded-rect tile centred on the 1024 canvas, with transparent margin. A hand-made `icon.icns` is also accepted. |
| Windows app and installer exe | `apps/desktop/resources/icon-windows.png` (1024×1024), source `icon-windows.svg`; set as `win.icon` | PNG of at least 256×256 (keep 1024), or a `.ico` holding 16, 24, 32, 48, 64, 128 and 256 |
| Windows tray | `apps/desktop/resources/tray-windows.ico`: 7 PNG frames at 16, 20, 24, 32, 40, 48, 64; generated by `apps/desktop/scripts/render-tray-icon.ts` from `icon-windows.svg` | Same 7 sizes. Use a simplified, enlarged mark, because 16 px must stay legible. macOS has no menu-bar icon. |
| Runtime window and notification icon | `extraResources` copies `icon-windows.png` to `Resources/icon.png`; `apps/desktop/resources/icon.png` (1104×1104) and `icon.svg` | 1024×1024 PNG |
| Linux AppImage | Uses the PNG set (`linux.target: AppImage`) | 512×512 PNG (or a `build/icons/` set: 16 to 512) |
| DMG | `dmg` config has no `background`, so the volume icon comes from the app icon | Optional `dmg.background`: 540×380 PNG plus `@2x` (1080×760) |
| NSIS installer branding | `apps/desktop/installer/assets/brand.png` (600×196), `brand-2x.png` (1200×392), `brand-dark.png`, `brand-dark-2x.png`, `uninstaller-sidebar.png` (164×314; converted to `.bmp` by `scripts/prepare-windows-installer.ps1`); `installer/theme.nsh`, `drawing.nsh`, `window-frame.cpp` | Same sizes. The sidebar BMP is 164×314, 24-bit. |
| Desktop welcome window | `apps/desktop/renderer/assets/welcome-brand.svg`, `renderer/welcome.html`, `welcome.css`, `src/client/WelcomePage.tsx` | SVG wordmark and tile; the window is replaced by the ahel.ai login in Phase 2 |
| Update and mandatory-update dialogs | `apps/desktop/renderer/update-dialog.{html,css}`, `mandatory-update.{html,css}`, `policy-login-loading.html` (only "splash"-like page); DeepSeek blue `#4D6BFE` in both CSS files | Ahel tokens |
| Web favicon and manifest | `apps/web/public/favicon.svg`, `favicon-dark.svg`, `manifest.webmanifest` (`name: "DeepSeek Harness"`, `short_name: "DSH"`); `apps/web/index.html` `<title>DSH Local Build</title>`, which is also the window title source because the desktop window uses `titleBarStyle: hiddenInset` (`apps/desktop/src/main.ts:207-222`) | SVG favicon (light and dark) from the tile, plus PNG 32/180/192/512 if a manifest icon set is wanted |

### In-app brand components and copy

- **Sidebar header.**
  - `packages/client/ui-brand-official/src/client/{index.ts,Brand.tsx}` injects the `sidebar.brand.mark` and `sidebar.brand.name` slots (whale plus wordmark).
  - The fallback mark is `FishLogo` from `packages/client/ui-primitives/src/FishLogo.tsx`, used at `packages/client/ui-sidebar/src/client/SidebarRoot.tsx:189,225`.
  - The wordmark is `packages/client/ui-primitives/src/BrandWordmark.tsx`.
  - Phase 1 replaces `ui-brand-official` with an Ahel brand plugin that fills the same slots.
- **Empty-state hero.** "Into the Unknown" and the Preview badge: `packages/client/ui-conversation/src/client/locales.ts:453` (`hero.headline`).
- **Desktop shell strings.**
  - In `apps/desktop/src/locale.ts` (en and zh): `aboutMenu` and `aboutProduct` (About menu), hide/quit/open labels, `quitTitle`, `startupFailed`, the `welcome*` strings, `updateTitle`, and `cliCommandTitle` ("Manage dsh Command").
  - `apps/desktop/src/main.ts:928` sets `applicationName: 'DeepSeek Harness'` (About panel).
- **Installer strings.** `apps/desktop/installer/strings.nsh` (DeepSeek Harness in every message, en and zh) and `installer/extract-report.h`.
- **Other client copy naming DeepSeek Harness or DSH.**
  - `ui-plugin-manager/src/client/locales.ts`
  - `ui-settings-account/src/client/locales.ts` and `locales/onboarding.ts`
  - `ui-settings-models/src/client/locales.ts`
  - `ui-sidebar-documentpreview/src/client/office/locales.ts` (dropped)
  - `ui-primitives/src/code-file-icon-artwork.manifest.json`
- **Packaging identity**, all in `apps/desktop/scripts/electron-builder-config.mjs`:
  - `productName: 'DeepSeek Harness'`
  - `artifactName: deepseek-harness-${version}-${os}-${arch}`
  - `protocols: [{ name: 'DeepSeek Harness', schemes: ['dsh'] }]`
  - `mac.category: developer-tools` (change to productivity)
  - the `NSMicrophoneUsageDescription` copy
  - `appId` comes from `DSH_DESKTOP_APP_ID` (spike value `ai.ahel.desktop.spike`; Phase 1 uses `ai.ahel.desktop`).
- **Protocols and schemes.**
  - `dsh://` is set by `app.setAsDefaultProtocolClient('dsh')` at `main.ts:1228`.
  - `dsh-app://app/` is checked in `main.ts:719,726` and `keyboard.ts:68`.
  - Keep `dsh-app` internally or rename it together with every origin check.
- **User data dir.** `~/Library/Application Support/@deepseek-ai/dsh-desktop` follows the desktop `package.json` name. Rename the package or set `app.setName`/`userData` explicitly. `DSH_HOME` defaults to `~/.dsh` (`packages/util/home-paths/src/index.ts:12`).
- **Theme tokens.** The base custom properties are in `packages/client/ui-theme/src/styles/base.css` (15 vars), with `boot-theme.ts`, `focus.css` and `gradient-shadow-text.css` next to it. DeepSeek blue `#4D6BFE` is hard-coded in `apps/desktop/renderer/{update-dialog,mandatory-update}.css` and `packages/client/ui-attachment/src/FileCard.module.css`. Phase 1 maps these to the Ahel "Studio" slate tokens from `ahel/design`.
- **npm scope.** `@deepseek-ai/*` on every workspace package. Renaming it is optional for the binary, but it is visible in the plugin manager and in error messages.

## Go/No-go

**Go, with conditions.** Build and package work from source on this Mac. The MCP client works with ahel.ai OAuth after a small, contained patch. The prune shows the chat core boots without shell, fs, sandbox or subagents (102 of 185 packages kept). No copyleft blocker in shipped dependencies once the Anthropic SDK, LibreOffice kit and cua-driver are dropped.

The costs are real:
1. There is no MCP Apps renderer, which is the gate feature. It must be built (3 to 5 days).
2. The release pipeline is DeepSeek-specific: COS, Feishu policy, a Developer-ID-only mac path, telemetry on by default.
3. The DeepSeek account and key UI is spread across about 8 client packages plus the desktop shell.
4. The fork is a hard fork: upstream takes no PRs and ships breaking changes.

If the MCP Apps renderer is not acceptable as fork work, the fallback is borrow-patterns-only.

## Next steps for Phase 1

Disjoint "only touch" paths for two agents:

- **Agent A, strip + rebrand** (generate icons per "Brand surfaces"; `apps/desktop/**`, `packages/bundle/**`, `packages/client/ui-brand-official`, `packages/client/ui-settings-account`, `packages/client/ui-settings-models`, `packages/client/ui-model-selection`, `packages/client/ui-chat/src/client/conversation-nodes/turn-error.ts`):
  - turn `prune-chat-mcp.cordis.yml` into an `ahel` profile/bundle and re-add `compaction-basic`;
  - delete the DeepSeek welcome, account and key UI;
  - rebrand productName, appId, icons and protocol;
  - remove telemetry, COS, Feishu policy and the update feed (repoint to GitHub releases in Phase 3);
  - make the unsigned mac path a first-class `package:mac:arm64:dev` target;
  - drop the pruned packages from `release:pack`.
- **Agent B, MCP Apps cards** (`packages/mcp/**`, `packages/client/ui-tool/**`, new `packages/client/ui-mcp-app/**`):
  - carry `_meta.ui` through `mcp-client`;
  - read `ui://` through `mcp-resources`;
  - build a sandboxed iframe host with the MCP Apps bridge;
  - add tests and a snapshot;
  - move OAuth to the credentials seam (step 3 above).
- **Ahel repo (separate PR):** make `ahel.ai/mcp` advertise its own protected resource, or document `mcp.ahel.ai/mcp` as the connector URL.
