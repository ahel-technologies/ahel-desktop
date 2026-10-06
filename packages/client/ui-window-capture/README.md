---
description: "Window capture in the Ahel Desktop composer: the capture button, the global shortcut row in Settings > General, and attaching the captured window's screenshot to the chat."
kind: "package-reference"
---

# @ahel/dsh-client-ui-window-capture

## Summary

Browser half of window capture in Ahel Desktop. Press the global shortcut (default Cmd+Shift+2, macOS only) in any app, or click the capture button in the composer: the Desktop shell captures the front window that is not Ahel Desktop, focuses Ahel Desktop, and this plugin attaches the window's PNG and, when it was read, its visible text to the draft, with the caption line `Window: {app} – {title}`. The model gets both through the composer's existing attachment path. On the served Web page the preload bridge is absent and the plugin registers nothing.

## Table of Contents

- [Use this package](#use-this-package)
- [Behavior](#behavior)
- [Dev Note](#dev-note)

## Use this package

```yaml
- id: ui-window-capture
  name: '@ahel/dsh-client-ui-window-capture'
```

It needs the `window.__DSH_WINDOW_CAPTURE__` preload bridge of `apps/desktop` and the capture backend [`dsh-window-capture`](../../capture/window-capture/README.md).

## Behavior

- **Composer button** (`conversation.input.left`): captures the front window that is not Ahel Desktop's, so a click captures the window you were in before.
- **Shortcut capture**: the visible composer takes it; with no composer on screen the plugin starts a new chat (`uiWorkspace.startSession`) and its composer takes it.
- **Attachments**: the PNG becomes an image draft and the text a `.txt` file draft, both through the conversation service's `createDrafts` and the session's `addAttachments`, as + > File does; the caption line goes in at the caret.
- **Notices** (`shell.overlay`): missing Screen Recording permission, no other window, or a failed capture.
- **Settings > General**: off macOS the row says "macOS only" and the composer button is absent. On macOS the row shows the keys, records a new combination with Change (Esc cancels; Cmd, Ctrl or Option is required), turns the shortcut off, or restores the default. A shortcut another app holds is reported.

## Dev Note

The plugin reaches `createDrafts` and `releaseDraftAttachments` on the concrete `ConversationController` from `ctx.get('conversation')`; the outward `IConversation` face does not carry them. A shortcut capture is pulled with the bridge's `take`, which hands each capture to one composer only.
