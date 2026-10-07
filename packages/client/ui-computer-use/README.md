---
description: "The computer-use approval card, stop control, activity log and blocked-apps row in Ahel Desktop."
kind: "package-reference"
---

# @ahel/dsh-client-ui-computer-use

## Summary

The browser face of computer use. It reads the action gate (`@ahel/dsh-computer-use-action-gate`) through the Host Remote namespace `computerUseApproval` and fills three places:

- **Approval card** (`conversation.composer` takeover, ahead of the generic approval panel): target app and bundle id, window title, element role and label, the exact text it will type or the keys it will press, a crop of the target from the latest window screenshot, and the full arguments in a fold. Approve and Deny are buttons; Approve reacts only to a pointer click (`event.detail ≥ 1`), so Enter, Space, a programmatic click or a spoken "yes" do nothing. The card also has a Stop computer use link.
- **Composer dock** (`conversation.composer.dock`, id `computer-use`): on/off/paused state, a red Stop computer use button while a turn is using the computer, the per-session pause toggle, and the activity log (time, status chip, one-line summary, reason).
- **Settings > General** (`settings.general.item`, id `computer-use-blocked-apps`): the built-in block list and the person's own list, one app name or bundle id per line. The on switch is the `computer-use` row of `@ahel/dsh-computer-use-cua-driver`.

The stop shortcut is Cmd/Ctrl + Option/Alt + Shift + Period while the Ahel window has focus.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

```yaml
- id: ui-computer-use
  name: '@ahel/dsh-client-ui-computer-use'
```

The client accepts `serverName` (default `ahel-computer`); it must match the gate.

## Model Experience

None. The package draws UI only; the gate owns what the model sees.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The stop shortcut works only while the Ahel window is focused. An OS-wide shortcut needs Electron `globalShortcut` in the desktop main process.
- While the approval card holds the composer, the dock is hidden; the card's own Stop link covers that time.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
