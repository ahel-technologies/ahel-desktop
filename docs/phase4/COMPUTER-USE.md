# Computer use in Ahel Desktop (beta)

Ahel Desktop can let the model see and use apps on the person's computer. It runs the
MIT-licensed [Cua Driver](https://github.com/trycua/cua) as a bundled executable and
speaks MCP to it over stdio. macOS ships first; Windows follows.

Two parts:

- **Driver and plumbing:** bundling, signing, the embedded spawn, the `ahel-computer` MCP
  server, the Settings switch and macOS permissions. Packages `@ahel/dsh-computer-use`
  (row `computer-use`) and `@ahel/dsh-computer-use-cua-driver` (row `computer-use-cua-driver`).
- **Approval gate:** every driver call passes it. Packages `@ahel/dsh-computer-use-action-gate`
  (row `computer-use-gate`) and `@ahel/dsh-client-ui-computer-use` (row `ui-computer-use`).

All four rows are Desktop only (`disabled` unless the profile is `desktop`).
Research: `ahel/docs/research/research-computer-use-bases-2026-10-07.md`.

## Turn it on

Settings > General > **Computer use (beta)** > switch on.

Switching on gets the driver ready (bundled copy, or a one-time verified download) and,
on macOS, reads Accessibility and Screen Recording for Ahel Desktop. When one is missing it
opens that System Settings pane, and the row shows one sentence, for example "Allow Ahel
Desktop in Screen Recording, then click Check again.", with **Open System Settings** and
**Check again**. No other prompt, no Keychain.

The switch is off by default. The rows are mounted only in the `desktop` profile. The
hosted chat and the plain web profile never load them.

## The setting: `computerUse.enabled`

| Where | What |
|---|---|
| Profile entry | `computer-use` (`@ahel/dsh-computer-use`), volatile field `enabled`, default `false` |
| Persisted in | the desktop profile's own `cordis.patch.yml`, written by the Settings service |
| Host read | `ctx.computerUse.enabled` (boolean, live) |
| Host change event | `computer-use/enabled` with the new boolean, after the value is live |
| Host write | `await ctx.computerUse.setEnabled(true \| false)` |
| Settings namespace | `computer-use`, path `enabled` (for `ctx.remote.settings.update`) |
| Running provider | `ctx.computerUse.providerName === 'cua-driver'` while the driver session holds the slot |
| Browser status | Remote `computerUseDriver`: `current()`, `watch(signal)`, `setEnabled(on)`, `recheck()`, `openSystemSettings('accessibility' \| 'screen-recording')` |

The gate denies every `mcp__ahel-computer__*` call while `ctx.computerUse.enabled` is
false. The provider already removes the tools in that state, so the deny is a second fence.

## How the driver runs

```text
Ahel Desktop.app (Electron main, TCC responsible process)
  └─ Host (Electron binary in Node mode)
       ├─ cua-driver serve --embedded --socket $TMPDIR/ahel-cua-XXXXXX/d.sock   (daemon)
       ├─ cua-driver mcp   --embedded --socket <same>                         (MCP stdio, server ahel-computer)
       └─ osascript (short-lived: permission reads)
```

- Both driver processes are plain `spawn` children of the Host, never `open`, so macOS
  attributes Accessibility and Screen Recording to **Ahel Desktop**. The driver's
  `check_permissions` reports `source.attribution: "host"`. No second app appears in
  System Settings.
- Environment set by the Host: `CUA_DRIVER_EMBEDDED=1`,
  `CUA_DRIVER_HOST_BUNDLE_ID=ai.ahel.desktop`, `CUA_DRIVER_RS_HOME=~/.dsh/computer-use/cua-driver`,
  `DO_NOT_TRACK=1`, `CUA_TELEMETRY=0`, `CUA_DRIVER_RS_TELEMETRY_ENABLED=false`,
  `CUA_DRIVER_RS_UPDATE_CHECK=false`. `ELECTRON_RUN_AS_NODE` is removed. Profile config
  `environment` can add trusted tuning such as `CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS`.
- Permission mode is the driver default, `standard`. No `--dangerously-bypass-approvals`.
- Lifecycle: switch on starts the session (daemon, then the MCP proxy, then tool
  registration). Switch off disposes it in reverse order. If the daemon dies, the Host
  restarts it after 1 s, 5 s, then 30 s, then shows the error in the row.
- The packaged executable is `Ahel Desktop.app/Contents/Resources/cua-driver/cua-driver`
  with a `VERSION` file that must equal the pin (its bytes are covered by the app's
  signature; re-signing changes its hash). Without it, macOS downloads the pinned archive
  once to `~/.dsh/computer-use/driver/<version>/` and checks the archive and executable
  hashes. `AHEL_CUA_DRIVER_PATH` or the profile entry's `command` run any copy as given.

### macOS permissions

- Reads run in a fresh `osascript` child of the Host (`AXIsProcessTrusted`,
  `CGPreflightScreenCaptureAccess`). That child sits in Ahel Desktop's responsibility
  chain, so macOS answers for Ahel Desktop. Nothing raises a prompt, touches the Keychain
  or asks for a password; a missing grant opens its pane
  (`x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility` or
  `?Privacy_ScreenCapture`).
- Each driver start re-reads both grants, and the embedded driver's `check_permissions`
  confirms them. A driver start happens at every launch while the switch is on. This
  catches the macOS 15+ periodic Screen Recording re-confirmation. **Check again**
  re-reads on demand and restarts the driver when a grant changed, because macOS caches
  grants per process.

## Approval gate and UI

### What the gate does with each call

1. `computerUse.enabled` off, or the switch service missing: denied, "Computer use is turned off. The user can turn it on in Settings > General > Computer use."
2. Session paused: denied.
3. Refused or unknown tool name: denied.
4. Read: runs, no card. Screenshots and accessibility trees go to the model.
5. Write: target resolved from the latest observation, hard blocks checked, then `ask` through `@ahel/dsh-user-approval`. Runs once after a click on Approve.

| Class | Tools |
|---|---|
| Read | `list_apps` `list_windows` `get_window_state` `get_accessibility_tree` `get_desktop_state` `get_screen_size` `get_cursor_position` `get_agent_cursor_state` `check_permissions` `health_report` `zoom` `verify_state` `get_browser_state` `start_session` `end_session` `get_session` `get_session_state` `list_sessions` |
| Write (card) | `click` `double_click` `right_click` `drag` `scroll` `move_cursor` `type_text` `press_key` `hotkey` `set_value` `invoke_menu` `launch_app` `bring_to_front` `set_window_frame` `clipboard_write` `page` `browser_navigate` `browser_click` `browser_type` `browser_dialog` |
| Refused | `run_actions` `kill_app` `set_config` `clipboard_read` `set_agent_cursor_*` `browser_prepare` `browser_set_input_files` (the provider also refuses `install_extension` `install_ffmpeg` `check_for_update`) |
| Unknown | everything else: denied |

A write must name a target the gate can check: observe the window first (`get_window_state`), then act by `element_token` or `pid`/`window_id`. `type_text` and `set_value` must name the field.

### Hard blocks (checked before any card)

- Password fields: `AXSecureTextField` role or subrole, or a text field labelled as a password.
- Keychain Access, System Settings security panes, Terminal, iTerm, Warp, Bitwarden, 1Password, Passwords.app, Ahel Desktop.
- `launch_app` URLs to `x-apple.systempreferences:` or those apps.
- The person's own list: Settings > General > Computer use: blocked apps (`computer-use-gate.blockedApps`).

### UI

- Approval card: replaces the composer for a computer-use approval. Shows app (bundle id), window, element role and label, exact text or keys, a crop of the target from the latest screenshot, the arguments. Approve works only with a pointer click. File: `packages/client/ui-computer-use/src/client/ApprovalCard.tsx`.
- Composer dock: state, red Stop computer use while a turn uses the computer, pause toggle for this chat, activity log (time, status, summary, reason).
- Kill switch: the dock's Stop button, the card's Stop link, or Cmd/Ctrl+Option/Alt+Shift+Period in the Ahel window. Cancels every computer-use turn, holds the gate off at once and saves `computerUse.enabled: false`.

### Driver tool annotations

The driver marks 21 tools read-only and 37 as state-changing in 0.34.0 (`readOnlyHint`).
The gate's own table above decides; driver tools in neither gate list are denied.
The provider also refuses `install_extension`, `install_ffmpeg` and `check_for_update`
with a `tools.guard` before dispatch: they would download code (Cua's optional perception
extension is AGPL) or call GitHub.

## structuredContent reaches the model

The MCP bridge renders only `content` blocks. The driver puts the data a model needs in
`structuredContent`: element tokens, window ids, pids and permission booleans. For
example, `list_windows` text is only "Found 10 window(s).". This is deepseek-harness
issue #7788. The provider adds a `tools/post-execute` step for `mcp__ahel-computer__*` that
appends:

```text
structuredContent (JSON):
{"windows":[{"app_name":"Finder","pid":712,"window_id":118,...}]}
```

The step skips `tree_markdown` when the text already carries it, and replaces base64
blobs with a length note. It cuts the JSON at `structuredContentMaxChars` (60,000 by
default). The spill policy still applies afterwards.

## Pinned driver, packaging and signing

- Pin: `packages/computer-use/cua-driver/cua-driver.release.json`, Cua Driver **0.34.0**
  (tag `cua-driver-rs-v0.34.0`, commit `b0968e1b12834e485dda68789541a3cc57664a9f`).

  | Asset | Archive sha256 | `cua-driver` sha256 |
  |---|---|---|
  | `cua-driver-rs-0.34.0-darwin-arm64.tar.gz` | `329bcc140c4840a5877e2cfc9f756351eb4a70c2c2d6acf4954751918122c60a` | `47fa8722003066246ee8a828d3fe2c769f2194d6cf3ad63ae6f0becdc00d383a` (universal arm64+x86_64) |
  | `cua-driver-rs-0.34.0-darwin-x86_64.tar.gz` | `9f362ad3af021c2d092c89172a02663e5c7d8788f8f7643a0b5f4eb568279b27` | same universal binary |
  | `cua-driver-rs-0.34.0-windows-x86_64-binary.zip` (not shipped yet) | `bcc520e50861c7092cf775846fec76ae386d7dcd6b5b408608b0ea4423a8b888` | `cua-driver.exe` `77f5cac754b42b6a8bae126414fc8f7487432ace93466967965188e24e9e53fb` |

- Fetch: `apps/desktop/scripts/prepare-cua-driver.ts` (`pnpm --filter @ahel/dsh-desktop run
  prepare:cua-driver`). `package-target.ts` runs it for every package. It uses the same
  `installDriver()` as the Host (`packages/computer-use/cua-driver/src/release.ts`):
  download into the shared download cache, check both hashes, write only the executable
  and `VERSION` to `.desktop-build/targets/<target>/cua-driver/`. No binary is committed.
- electron-builder copies that folder to `Resources/cua-driver/`, and the notices to
  `Resources/licenses/cua-driver/`, on macOS targets.
- Signing: with the Apple secrets present (`desktop-release.yml` gate), electron-builder
  re-signs the nested executable with the release Developer ID and hardened runtime,
  using the inherited entitlements in `apps/desktop/scripts/macos-entitlements.plist`.
  `com.apple.security.automation.apple-events` was added for the driver's Apple Events
  path, and `NSAppleEventsUsageDescription` plus `NSScreenCaptureUsageDescription` were
  added to Info.plist. The universal binary needs no other entitlement. It links only
  system frameworks, so notarization sees one more signed Mach-O. Unsigned builds give it
  an ad-hoc signature like every other nested binary. The release workflow prints the
  packaged driver's signature after packaging.
- Bumping the pin: update every hash, rerun the licence scan below, then rerun
  `tests/real-driver.e2e.ts` and the packaged smoke.

## Licence result (0.34.0)

- `cua-driver` itself: MIT (Copyright (c) 2025 Cua AI, Inc.). Its own
  THIRD_PARTY_NOTICES lists MIT-derived code (trope-cua, Interface-Agent, yabai).
- The Rust crates linked into the executable were scanned with
  `cargo tree --locked -p cua-driver --target {aarch64,x86_64}-apple-darwin,x86_64-pc-windows-msvc -e normal,build`
  at the tag: 367 crates. The licences are MIT, Apache-2.0, BSD-2/3-Clause, ISC, Zlib,
  Unicode-3.0, Unlicense, MIT-0, 0BSD, CDLA-Permissive-2.0 and BSL-1.0 (Boost). The six
  `uniffi*` 0.31.0 crates are **MPL-2.0**. That is weak, file-level copyleft. We ship them
  unmodified and point to their source in the notices.
- **No AGPL, GPL, LGPL, SSPL, BUSL or commercial licence** is in the executable. The
  optional `cua-perception` crate (OmniParser models, AGPL) is not linked. Its install path
  is refused, as described above.
- Notices ship in `packages/computer-use/cua-driver/licenses/`: `LICENSE-cua-driver`,
  `THIRD_PARTY_NOTICES-cua-driver.md`, and `CUA-DRIVER-CRATES.md` (the crate table plus
  every licence text the crates ship).

## Verification

- `packages/computer-use/cua-driver/tests/driver.spec.ts`: embedded daemon spawn on a
  private socket, the MCP stdio handshake and a `check_permissions` call against a fake
  driver, failure reporting, the environment, permission scripts, and the
  structuredContent projection.
- `tests/provider.spec.ts`: a profile boot with Settings. It covers off by default, the
  switch persisting `enabled: true`, the missing-permission pane opening, the six fake
  tools registered as `mcp__ahel-computer__*`, structuredContent in the model text,
  `install_extension` refused before dispatch, switch off removing the tools and stopping
  the daemon, and a restart that resumes from the persisted switch. A second case composes
  the approval gate: reads run without a card, a click waits for approval and then reaches
  the driver, and Stop saves the switch off and stops the driver.
- `tests/release.spec.ts`: the verified install from a local archive (one download, both
  hashes, only the executable and `VERSION`).
- `tests/real-driver.e2e.ts` (opt-in, `AHEL_CUA_DRIVER_E2E=<cua-driver path>`): the real
  pinned driver. It lists the tools, then runs `list_windows`, one screenshot
  (`get_desktop_state`) and one AX find (`get_window_state` with `query`), and prints the
  model text. Reads only.

## Open items

- OS-wide stop shortcut (Electron `globalShortcut` in the desktop main process).
- Activity log and pause live in Host memory; a restart clears them.
- Windows: ship `cua-driver.exe` from the pinned zip, map the socket to a named pipe, and
  run a UIA smoke on a Windows machine.
- A signed and notarized build has not been produced yet. It needs the Apple secrets in
  CI. Run `codesign -dv --verbose=4 "Ahel Desktop.app/Contents/Resources/cua-driver/cua-driver"`
  on the first signed release.
- A clean-Mac smoke from a signed DMG is still to do: Ahel Desktop listed in both panes
  after switch-on (the pane may need the + button when macOS has not listed it yet), and
  the "quit and reopen" flow after granting Screen Recording.
- Whether `bounded` mode with a capability manifest should become a second fence.
