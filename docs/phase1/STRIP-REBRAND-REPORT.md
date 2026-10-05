# Ahel Desktop Phase 1A: strip and rebrand

Date: 2026-10-05. Branch: `phase1/strip-rebrand` (from `spike/phase-0`).

## Result

The app builds (`pnpm run build`), packages unsigned for mac arm64 (`pnpm run package:desktop:mac:arm64:dev`), launches, and shows Ahel branding. No DeepSeek screen is left. Settings → Models adds an Anthropic or OpenAI-compatible provider with your own key.

- `.app` 805 MB, DMG 264 MB (spike: 1.0 GB / 376 MB).
- Packaged runtime smoke passed (Host, frontend, plugin route).

## Removed

- **Deleted packages:**
  - DeepSeek: deepseek-account, deepseek-account-platform, llm-deepseek, llm-deepseek-api-key, llm-deepseek-account, deepseek-llm-api-extensions, session-log-deepseek, plugin-package-inventory-deepseek, web-search-deepseek.
  - DeepSeek account UI: api/account-controller, client/ui-settings-account.
  - subagent-claude-code (and `@anthropic-ai/claude-agent-sdk`).
  - office-to-pdf, skill-office, LibreOffice kit.
  - computer-use and the cua-driver packages.
  - ui-brand-official.
- **Unmounted, still in the tree:** shell, fs tools, sandboxes, skills, subagents, PTC, workflows, jobs, goals, plan, schedule, web tools, telemetry, product analytics, and their client panels.
  - Their rows moved from `dsh-base` to the new private bundle `@ahel/dsh-agent-tools`. Only the headless, sdk and acp profiles use it.
  - The web and desktop profiles load base + web-app only. Evidence: `web-profile-dump-config.yml`, 99 rows, 0 DeepSeek or telemetry rows.
  - `release:pack` packs only the runtime closure of `dsh` + desktop-host: 161 of 305 packages.
- **DeepSeek UI removed:**
  - Welcome sign-in and Add API Key.
  - Platform account view.
  - Settings → Account.
  - DeepSeek onboarding and presets in Settings → Models.
  - Composer default-model pinning. The default is now the first configured model, or "Add a model".
  - The web-search DeepSeek card.
  - The "signed out of DeepSeek" error.
- **Release pipeline:**
  - Removed: COS upload, the Feishu mandatory-update policy, `download.deepseek.com`.
  - electron-updater now uses the GitHub provider for `ahel-technologies/ahel-desktop`. `TODO(phase3)`: token for the private repo; no token added.
  - Product analytics is off by default and sends no identity. OTel rows are disabled, and no collector URL ships.

## Rebrand

- **Identity:** product name "Ahel Desktop", appId `ai.ahel.desktop`, artifact `ahel-desktop-<ver>-mac-arm64`.
- **Schemes:** `ahel://` and `ahel-app://`, renamed in every origin check.
- **Category and data:** productivity; userData lives under "Ahel Desktop".
- **Icons:** all generated from `ahel-tile.svg` by `apps/desktop/scripts/render-brand-assets.ts`: mac, win, tray, linux, NSIS, welcome, favicons.
- **In-app brand:** new `ui-brand-ahel` puts the tile and wordmark in the sidebar. The hero reads "Your apps, in one chat". Theme uses the Ahel Studio slate light and dark tokens.
- **Copy and notices:**
  - Strings changed in en and zh: locale, installer, About ("Built on DeepSeek Harness (MIT)").
  - LICENSE keeps the DeepSeek line and adds an Ahel line.
  - THIRD_PARTY_NOTICES adds the LGPL libvips notice.

## Verification

- **Screenshots** in `screenshots/`: main window and sidebar brand, About, Settings → Models (BYO key form), welcome.
- **Network:** a 2-minute run of the packaged app (`network-2min-idle.txt`) connected only to loopback and `140.82.121.3:443` (github.com, the update check, which fails with 404 on the private repo). No `*.deepseek.com` or `deepseeksvc.com`. No DeepSeek host strings appear in the app resources.
- **Typecheck:** host and client `tsc -b` are clean.
- **Tests:** focused vitest runs over the touched packages pass (each agent's runs, about 6,000 tests in total).

## Known gaps

- `ui-mcp-app` row and dependency: added in the last commit, after verification. The branch only installs and builds once it is merged with `phase1/card-renderer`.
- **Doc gates not fixed** (Karl: not a priority):
  - doc-graphs, cordis-catalog, client-catalog, export-jsdoc, translation-pairing.
  - persistence-changes: two DeepSeek event types left the schema. They are still in `known-event-types` so old logs load.
- **Web e2e (`test:web`):** suites for removed surfaces were deleted. The remaining ones (e.g. `shipped-composition`) still assume DeepSeek defaults; not run.
- **DeepSeek defaults remain in unshipped code:** `acp-app` and the SDK client / Python SDK still default to the `deepseek-official` provider.
- **Composer placeholder** still reads "Describe what you want to build"; the coding-view toggle is still in Settings → General.
- **Windows:** an unsigned Windows build has no `publisherName`, so update signatures are not checked.
- **Installer log path** used the `@deepseek-ai` package name; fixed by the Phase 2b scope rename.
- **Primary runtime:** the bundled Python/Node runtime still ships, for the CLI command manager. Removing it is a follow-up.
- **Old local file:** the spike's local `apps/desktop/.env.macos` in the original checkout holds keys that packaging now rejects. Delete those lines.
