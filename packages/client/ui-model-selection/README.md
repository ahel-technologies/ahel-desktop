---
description: "Model selection for the Web GUI: one composer model picker grouped by maker with prices and a live balance chip, the /model popup and the open-picker shortcut over one per-session directory; for users and maintainers of model routing."
kind: "package-reference"
---

# @ahel/dsh-client-ui-model-selection

English | [中文](README.zh.md)

Desktop product events use the optional [product analytics service](../product-analytics/README.md); ordinary Web interactions are excluded.

## Summary

The composer's model picker switches a session's model and reasoning effort, in Ahel Desktop and the hosted chat alike. One list, grouped by maker, shows short names, a "best for" line, the price of a typical message and where each model is billed. A balance chip beside the trigger shows the workspace balance for a metered model, "held" while a request runs, and "your key" for the person's own key. `/model` and the Cmd+K Model group offer the same models. A selection applies to the next request.

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

Mount this plugin alongside `ui-conversation` and the commands package; the composer then shows the trigger and the balance chip, and `/model` opens the same models as a popup. Cmd+Alt+/ (Ctrl+Alt+/ elsewhere) opens the picker of the chat in view; Cmd+/ stays the keyboard shortcuts reference, and Linux Web leaves the combination to the browser. With no provider configured, the trigger reads "Add a model" and the list points to Settings → Models.

### The list

The list opens at once with search focused. Search matches short names and makers case-insensitively, including nonconsecutive characters in order. `↑`/`↓` move the highlight without leaving search; Enter and Tab pick it; Escape and `Shift+Tab` close back to the trigger. Groups are makers, labelled in text only, in catalog order with metered models first.

Each row shows the short name, a "best for" line, the typical message price ("3.3¢", 8,000 tokens in and 1,000 out, fee included) and where it is billed: "ahel · billed to the workspace" or "billed by DeepSeek". The workspace's last real charge for a metered model is the row's tooltip ("About 4.1¢ last time"). A model offered both metered and on an own key is one row with a billing switch ("ahel · billed to the workspace" / "your key"); a click on the row keeps the route in use, otherwise it takes the metered route. The workspace default carries a "Default" badge.

Short names, makers and "best for" lines come from the metering account for metered models. For other models a static table recognises common families (Claude, GPT, o-series, Gemini, DeepSeek, Grok, Mistral, Kimi, Qwen, GLM, Llama); any other id falls back to its last path segment made readable ("deepseek-v4.1-flash" becomes "DeepSeek V4.1 Flash").

### Footer

The footer holds "Remember for this chat" and the effort levels of the current model. While the workspace has a default model, a new chat starts on it. Picking another model keeps that model for the chat and turns "Remember for this chat" on; turning it off returns the chat to the workspace default. The choice is stored per chat in this browser. Effort lists the exact model's adapter-advertised levels; a model without them says "This model has no effort levels."

### Balance chip

For a metered model the chip shows the workspace balance ("$12.40"). From send it reads "held" until the request's settle reports no money on hold, then shows the balance that settle reported. A turn that ends without a settle re-reads the balance. For a model on the person's own key the chip reads "your key" and shows no number. Signed out of the metering account, the chip is hidden.

### Unroutable sessions and failures

Catalog availability does not block sending with a saved selection; request execution reports missing credentials or unavailable models. Refreshes and refresh failures keep the last displayed selection and rows. A removed provider leaves the list while the saved provider/model id and reasoning effort stay; the trigger then shows the saved `provider/model` id. A rejected selection announces through the transient Toast anchored to the composer card. When another writer owns the Session, the message asks the user to quit other running Ahel Desktop instances and retry.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The list uses the shared `MenuSurface` material and `MenuGroup` sticky headings; custom content follows the [menu rules](../../../docs/web-styling.md#component-rules).

<details>
<summary>Implementation internals — click to expand</summary>

`ModelDirectoryResolver` (`ctx.modelDirectories`) owns one `ModelDirectory` per session. The composer seat, the `/model` popupSelect contribution and the command palette's Model group read the same directory and submit through `session.selectModel`, so a switch made in one entry is what the others show next. Directory loads and selections share a generation counter so an older response never overwrites a newer one; a connection reset drops every resident projection and repulls the Host-restored selection.

`rows.ts` regroups the Host catalog's provider groups by maker and merges a metered model with the same model on an own key by model identity (last path segment, lower case, dots as dashes, without release dates). `names.ts` holds the static name table.

A metering account registers a `ModelBillingSource` with `ctx.modelDirectories.registerBilling(source)`: the metered route's provider key, an observable `ModelBillingState` (signed in, facts per model, workspace default, balance, latest hold or settle frame) and `refreshBalance()`. One source is active at a time. Without a source every route reads as an own key and the chip stays hidden. `ui-ahel-account` registers the Ahel account. The resolver also starts a blank chat on the source's workspace default unless the chat remembers its own choice, once per default.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the model surface is not enough. They move from the browser surfaces to the command popup shell and the selection contract.

- [ui-commands](../ui-commands/README.md) — the popupSelect shell the `/model` contribution registers into.
- [ui-conversation](../ui-conversation/README.md) — declares the composer's `conversation.input.model` seat.
- [dsh-agent-default-model](../../core/agent-default-model/README.md) — the default-model service for sessions that never choose.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `session.selectModel` selection every entry submits: the Host snapshots the complete `ModelSelection` at the next prompt-assembly boundary and owns the model-visible effect, while a running step keeps its assembled selection.

#### KV Cache effect

Switching the route can reduce or invalidate provider-side cache reuse for subsequent requests; the prompt prefix itself is untouched.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current model surface. They are current package constraints, not a general model-router comparison or a task backlog.

- **No create-time or addressed-subagent selection** — every entry requires an existing ordinary session's Agent; subagent continuation deliberately exposes no independent model-selection contract.
- **"Remember for this chat" is per browser** — the choice lives in this browser's storage, so another device sees the chat's selected model but not whether it follows the default.
- **No arbitrary effort input** — the picker offers only the exact model's adapter-advertised levels.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The approved design is `design/explorations/2026-10-08-model-picker/option-a.html` in `ahel-technologies/ahel`. The server half (model facts on `GET /api/llm/v1/models`, the billing event, `GET/PUT /api/desktop/workspace/model`) is ahel PR #468.

</details>
