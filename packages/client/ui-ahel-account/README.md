---
description: "The Ahel account in the Web client: account menu, Settings > Models rows, the model picker's metering source, Discover and the team panels; for users and maintainers of the Ahel surfaces."
kind: "package-reference"
---

# @ahel/dsh-client-ui-ahel-account

English | [中文](README.zh.md)

## Summary

The browser face of the ahel.ai account, in Ahel Desktop and in the hosted chat at ahel.ai/chat. It fills the sidebar account menu, the Ahel rows of Settings > Models, the blank-chat greeting and starter prompts, the notices for Ahel model refusals, Discover and Your apps, and the team surfaces (Approvals, Inbox, team header and strip, Hand off). It is also the model picker's metering source: prices, the workspace's default model, the balance and each request's hold and settle.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount it after `dsh-ahel-account` on the Host. It mounts the Host's `ahelAccount`, `ahelCatalog` and `ahelTeam` Remote namespaces and keeps one live account view from the `watch` stream.

Settings > Models gets two rows. At the top, "Default model for this workspace" lists the metered models grouped by maker with their typical message price. The owner or a team lead picks the default, where new chats in ahel chat and Ahel Desktop start; everyone else sees it read-only. A refused save shows ahel.ai's sentence under the row. Signed out, or while ahel.ai does not report the setting, the row is hidden. Below the provider rows, the Ahel row shows the account and its Sign in button.

Once `ui-model-selection` is loaded, the package registers the Ahel account as the picker's metering source for the `ahel` route: ahel.ai's facts per model from `ahelTeam.models()`, the workspace default, the newest balance (from the summary poll or the latest settle, whichever came last) and the view's `billing` frame. A settle re-reads the model facts, so the last-charge tooltip stays current.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`team/summary.ts` runs the one shared `ahelTeam.summary()` poll. Each Inbox read sets the poll's `inbox.unread` to the Inbox read's count: unread handoffs that are not done plus ahel.ai's whole-Inbox count of unread issue rows, which can exceed the rows shown (`adoptInbox`), so the sidebar badge and the hosted chat's rail match the list; an open Inbox re-reads when a later poll counts differently. `models/source.ts` combines it with the account view and `ahelTeam.models()` / `workspaceModel()` into the picker's `ModelBillingState` and the Default model row's view; values from a summary, a GET and a PUT apply in arrival order. `models/DefaultModelRow.tsx` renders the row in the `settings.models.header` seat. The source registers through `ctx.inject(['modelDirectories'], …)`, so the package loads without the picker.

</details>

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No workspace picker in Settings > Models** — the default model applies to the workspace the account menu selected.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The `/api/desktop/*` and `/api/llm/v1/models` shapes live in `dsh-ahel-account`'s `src/types.ts`.

</details>
