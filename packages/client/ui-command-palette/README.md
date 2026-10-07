---
description: "The Cmd+K command palette of the Web client over chats, panels, apps, models, settings and account actions; for users and maintainers of palette groups."
kind: "package-reference"
---

# @ahel/dsh-client-ui-command-palette

English | [中文](README.zh.md)

## Summary

Cmd+K (Ctrl+K) opens one search over chats, main panels, installed Ahel apps, models, Settings pages, the theme and Sign in or out. Other packages add groups through `ctx.commandPalette`. The palette's keys, the sidebar chat keys (Desktop) and the Approvals and Inbox commands are registered through `ctx.shortcuts`, so they show and rebind in the shortcut reference.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The Model group lists the current chat's models as the composer's model picker shows them: short names, never model ids, with the maker as the subtitle. A model offered both metered and on the person's own key is one entry; running it keeps the route in use, otherwise it takes the metered route. The group reads `ui-model-selection`'s directory and stays empty without that plugin.

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Models of the chat in view only** — the Model group lists nothing until a chat is open in the main view.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
