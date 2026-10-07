# Computer use in Ahel Desktop

Base: Cua Driver over MCP (server `ahel-computer`, tools `mcp__ahel-computer__<tool>`). macOS first. Off by default: the switch is `computerUse.enabled` (the `computer-use` row of `@ahel/dsh-computer-use`). Research: `ahel/docs/research/research-computer-use-bases-2026-10-07.md`.

## Approval gate and UI (stream B)

Packages:
- `packages/computer-use/action-gate` (`@ahel/dsh-computer-use-action-gate`, row `computer-use-gate`): the gate in the Host tools pipeline.
- `packages/client/ui-computer-use` (`@ahel/dsh-client-ui-computer-use`, row `ui-computer-use`): approval card, stop control, activity log, blocked-apps row. Remote namespace `computerUseApproval`.

Both rows are Desktop only (`disabled` unless the profile is `desktop`).

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

### Open

- OS-wide stop shortcut (Electron `globalShortcut` in the desktop main process).
- Activity log and pause live in Host memory; a restart clears them.
- No packaged smoke yet for the card with a real driver (stream A runs the packaged smoke).
