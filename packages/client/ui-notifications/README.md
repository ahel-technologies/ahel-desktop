---
description: "System notifications when a chat needs the person and the window is not focused: a reply is ready, an approval or question is waiting, or a teammate handed over a chat."
kind: "package-reference"
---

# @ahel/dsh-client-ui-notifications

English | [中文](README.zh.md)

## Summary

This package posts a system notification when a chat needs the person and the window is not focused. Ahel Desktop shows it through Electron's main-process `Notification`; a browser uses the Web Notification API. A click raises the window and opens that chat, or the Inbox for a handoff. Settings > General has one switch, on by default.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the row in the Web composition; it takes no config. The title is the chat title. It notifies on:

- **Reply ready:** a turn finished; the body is the final reply, or "Reply ready".
- **Stopped:** a turn failed; the body is "Stopped: {reason}".
- **Waiting:** an approval card ("Needs your approval: {summary}") or a question card ("Needs your answer: {question}").
- **Handoff:** a teammate handed you a chat ("{from} handed you a chat"); the click opens the Inbox.

### What to expect

Nothing is shown while the window is focused and visible. Subagent chats never notify. macOS asks for notification permission the first time; Do Not Disturb and Focus apply as for any app. The preference is stored per device in `localStorage` key `dsh.ui-notifications.settings`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`SessionNotifications`](src/client/watcher.ts) is React-free. It reads `api-session/status` and `api-session/error` Remote Events and the `uiSession.sessionStatus` pending interactions. A stopped turn settles for 400 ms, so a failure and the `turnOutline` projection preview on other streams arrive first. [`InboxNotifications`](src/client/inbox.ts) reads `ahelTeam.inbox()` structurally, only while the window is in the background: once on blur to seed, then every 60 s. [`notifier.ts`](src/client/notifier.ts) picks `window.dshDesktopNotifications` from the Desktop preload when present, else Web notifications. The Desktop main process (`apps/desktop/src/notifications.ts`) validates the application main frame, shows the notification, and on click raises the window and sends the target back. The plugin then calls `uiWorkspace.openSession` or `layout.selectPanel`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-session](../ui-session/README.md) — the Session status and pending-interaction source.
- [ui-approval](../ui-approval/README.md) and [ui-user-questions](../ui-user-questions/README.md) — the cards whose waits notify.

-----

<a id="model-experience"></a>
## Model Experience

None, as notifications are browser and desktop chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Handoffs need an Ahel account.** Without `ctx.remote.ahelTeam` the Inbox watcher is off.
- **A focused window on another chat stays quiet.** Only an unfocused window notifies.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
