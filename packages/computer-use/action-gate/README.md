---
description: "The computer-use approval gate: which Cua Driver tools run, which wait for a click, which are refused, and the hard-block list."
kind: "package-reference"
---

# @ahel/dsh-computer-use-action-gate

## Summary

The gate sits in the Host tools pipeline (`tools/pre-execute`) in front of the Cua Driver MCP server `ahel-computer`, whose tools reach the model as `mcp__ahel-computer__<tool>`. Reads run without asking. Every write is checked against the hard-block list first, then asks the person through `ctx.approval` (`ask` decision) and runs only after a click on the approval card. Any other tool name is denied. While `computerUse.enabled` is off, or the `computerUse` switch service of `@ahel/dsh-computer-use` is not composed, every call is denied with one line the model sees. The approval card, stop control and activity log are drawn by `@ahel/dsh-client-ui-computer-use`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

```yaml
- id: computer-use-gate
  name: '@ahel/dsh-computer-use-action-gate'
  config:
    serverName: ahel-computer
```

| Field | Default | Meaning |
|---|---|---|
| `serverName` | `ahel-computer` | MCP server name of the Cua Driver |
| `blockedApps` | unset | Volatile. App names or bundle ids the person blocked in Settings, on top of the built-in list |
| `activityLimit` | `200` | Activity rows kept per session |

### Read or write, by tool name

| Class | Tools | What happens |
|---|---|---|
| Read | `list_apps`, `list_windows`, `get_window_state`, `get_accessibility_tree`, `get_desktop_state`, `get_screen_size`, `get_cursor_position`, `get_agent_cursor_state`, `check_permissions`, `health_report`, `zoom`, `verify_state`, `get_browser_state`, `start_session`, `end_session`, `get_session`, `get_session_state`, `list_sessions` | Runs without a card. Screenshots and accessibility trees go to the model |
| Write | `click`, `double_click`, `right_click`, `drag`, `scroll`, `move_cursor`, `type_text`, `press_key`, `hotkey`, `set_value`, `invoke_menu`, `launch_app`, `bring_to_front`, `set_window_frame`, `clipboard_write`, `page`, `browser_navigate`, `browser_click`, `browser_type`, `browser_dialog` | Hard blocks first, then an approval card. Runs once after Approve |
| Refused | `run_actions`, `kill_app`, `set_config`, `clipboard_read`, `set_agent_cursor_enabled`, `set_agent_cursor_motion`, `set_agent_cursor_theme`, `browser_prepare`, `browser_set_input_files` | Denied with a reason |
| Unknown | any other name | Denied |

Writes need a target the gate can name. A write other than `launch_app`, `clipboard_write` and the browser tools is denied until the model has observed the target window (`get_window_state`) or passes its `pid`. `type_text` and `set_value` must name the field (`element_token`, or `x, y` on its screenshot).

### Hard blocks (before any card)

- A password field: role or subrole `AXSecureTextField`, or a text field labelled as a password. Typing without naming a field is also blocked when the latest observation reports a focused secure field.
- Keychain Access, System Settings security panes (Privacy & Security and its sub-panes, Passwords, Touch ID, Users & Groups; an unobserved System Settings window counts as one), Terminal, iTerm, Warp, Bitwarden, 1Password, Passwords.app, and Ahel Desktop itself, by bundle id or name.
- `launch_app` URLs that open `x-apple.systempreferences:` or one of those apps.
- The person's own list (`blockedApps`).

### Kill switch and pause

`stop()` cancels every turn that used computer use (`agent.cancel({ kind: 'user' })`), holds the gate off at once, and saves `computerUse.enabled: false` through the switch service. `setPaused(sessionId, paused)` denies every call in one session until it is resumed.

## Model Experience

The model sees the Cua tools unchanged. A refused call returns one plain sentence as the tool error, for example `Blocked: the target is a password field. ... Ask the user to do this step.` A denial by the person reads `the user rejected tool "mcp__ahel-computer__click"`.

#### KV Cache effect

None. The gate adds no prompt text.

## Known Limitations and Deferred Work

- The activity log, pause state and approval cards live in Host memory. A Host restart clears them; the tool calls and approval audit events stay in the session log.
- `press_key` and `hotkey` into a focused field are not checked against the field's role unless the latest observation reported it.
- Approval is per action. There is no "allow this app for this turn".

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
