---
description: "MCP Apps card host: renders an MCP server's ui:// card in a sandboxed frame under each settled tool call and speaks the MCP Apps postMessage bridge."
kind: "package-reference"
---

# @ahel/dsh-client-ui-mcp-app

English | [中文](README.zh.md)

## Summary

This package renders MCP Apps cards (`io.modelcontextprotocol/ui`, protocol 2026-01-26). When a settled MCP tool call carries an `mcpApp` record in its persisted result metadata, the card reads the tool's `ui://` resource from the same server, mounts it in a sandboxed frame that stays open beside the call's collapsible row, and runs the host side of the MCP Apps JSON-RPC bridge: the `ui/initialize` handshake, tool input and result notifications, host-proxied `tools/call` and `resources/read`, `ui/open-link`, size changes, and theme updates. A card that cannot load shows the call's text and structured result instead.

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

Mount one row in a Web or Desktop composition that also mounts `@ahel/dsh-mcp-client`, `@ahel/dsh-mcp-resources`, and `@ahel/dsh-client-ui-tool`. The row loads the Host controller and the browser card.

```yaml
- id: ui-mcp-app
  name: '@ahel/dsh-client-ui-mcp-app'
  config:
    maxHeight: 640
```

| Field | Default | Meaning |
|---|---|---|
| `maxHeight` | `640` | Largest card height in CSS pixels, and never above 70% of the window height; taller app content scrolls inside the card. A confirm card waiting for the user is never capped |

A server declares a card by setting `_meta.ui.resourceUri` to a `ui://` URI on a tool in `tools/list` and serving that URI with MIME type `text/html;profile=mcp-app`. `@ahel/dsh-mcp-client` persists the record; this package needs no per-server configuration.

A card's `tools/call` runs the named tool of the card's own server through the Session Agent's tool registry, so pre-execute policy, guards, approval, and post-execute policy apply exactly as for a model call. The tool's `_meta.ui.visibility` must include `app`; calls to other servers are refused. `ui/open-link` opens `http:` and `https:` URLs through the window-open path, which the desktop shell hands to the system browser.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host plugin provides `ctx.mcpApps` and the Remote namespace `mcpApps` with two methods. `readResource(agent, server, uri)` reads through `ctx.mcpResources.readAppResource`, which caches `ui://` reads per server connection generation and URI. `callTool(agent, server, tool, args)` resolves the tool's public registry name, checks its MCP descriptor and visibility, and calls `ctx.tools.execute` with the Agent; the result's `_meta` comes from the call's presentation record, never from the canonical value. The Client mounts the generated Remote contribution itself.

The Client registers the `tool.call.app` occupant declared by `@ahel/dsh-client-ui-tool`. The card validates the record, reads the resource, and prepends the MCP Apps content security policy, built from the resource's declared domains, as the first element of the document head. The frame uses `sandbox="allow-scripts allow-forms"` without `allow-same-origin`, so the app runs in an opaque origin with no access to the host page, its storage, or its cookies, and cannot open popups or navigate the top window. The page's message listener accepts only messages whose source is the card's own frame window and whose origin is `null`. A second frame `load` event means the frame navigated; the bridge then stops and the card shows its fallback.

A call row inside a Chat process group (`[data-step-process]`) can be collapsed, height-capped, or folded with the whole Turn process. The group therefore renders an always-visible sibling dock (`[data-step-process-cards]`); the card portals itself into that dock, open by default, and leaves a "Show card" link in the row that scrolls to it and focuses it. Outside a group the card stays under the row. While the call's live result `_meta` holds an `ai.ahel/pressToken` and no card action has succeeded yet, the card waits for a decision: it shows an Ahel-red left rule and grows to its reported height without a cap.

The bridge holds tool input and result notifications until the app sends `ui/notifications/initialized`, then sends them in that order. Host context carries the theme's color scheme, inline display mode, the height cap, locale, time zone, platform, and style variables mapped from the current design tokens; a theme change sends only the changed fields.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host controller: `readResource` and `callTool` Remote methods |
| [`src/call-result.ts`](src/call-result.ts) | Registry outcome to MCP `CallToolResult` fields |
| [`src/types.ts`](src/types.ts) | Browser-safe wire types |
| [`src/client/bridge.ts`](src/client/bridge.ts) | Host end of the MCP Apps JSON-RPC bridge |
| [`src/client/document.ts`](src/client/document.ts) | Content security policy and frame sandbox |
| [`src/client/record.ts`](src/client/record.ts) | Card record and resource validation |
| [`src/client/McpAppCard.tsx`](src/client/McpAppCard.tsx) | Card component: placement, loading, frame, fallback |
| [`src/client/register.ts`](src/client/register.ts) | Slot registration and injected Session-bound server access |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [MCP client](../../mcp/mcp-client/README.md) — tool `_meta` and the persisted `mcpApp` record.
- [MCP resources](../../mcp/mcp-resources/README.md) — cached `ui://` reads.
- [Tool UI](../ui-tool/README.md) — the `tool.call.app` slot.
- [MCP Apps specification](https://modelcontextprotocol.io/extensions/apps) — the bridge methods and host security rules.

-----

<a id="model-experience"></a>
## Model Experience

### Cards and card-initiated calls

#### What the model sees

Nothing from this package. The model sees the MCP tool's ordinary text result. A card's own tool calls, resource reads, and `ui/update-model-context` payloads are not added to the Session log or to any model request.

#### Token effect

None; cards add no model input.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Approval outside a turn fails closed** — an `ask` decision needs an open turn, so a policy that asks for a card-initiated call while the Agent is idle denies it.
- **Card calls are not logged** — a card's `tools/call` result reaches only the card; the model does not learn about it, and replay does not show it.
- **Model context from cards is held, not sent** — the latest `ui/update-model-context` payload is kept per card and not yet added to the next request; `ui/message` is declined.
- **Single sandboxed frame** — the card runs in one opaque-origin frame rather than the double-frame sandbox proxy the specification describes for Web hosts, so `_meta.ui.domain` and `allow-same-origin` apps (storage, cookies) are unsupported.
- **Inline only** — `ui/request-display-mode` returns `inline`; fullscreen and picture-in-picture are not offered.
- **App-only tools** — tools whose visibility omits `model` are not bridged, so a card cannot call them.
- **No partial input** — cards mount after the call settles, so `ui/notifications/tool-input-partial` is never sent and `tool-input` arrives with the result.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
