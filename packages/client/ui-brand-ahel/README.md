---
description: "Ahel brand occupants for the sidebar and the blank-session hero; for users and maintainers choosing or replacing brand presentation."
kind: "package-reference"
---

# @ahel/dsh-client-ui-brand-ahel

English | [中文](README.zh.md)

## Summary

This package gives the client the Ahel tile and the lowercase "ahel" wordmark in the sidebar, and the tile beside the blank-session headline. Every build that mounts it shows the Ahel brand; the build profile does not gate it. Without it, the sidebar falls back to the shell's tile and local-build label, and the hero keeps its animated fallback mark. It has no runtime state and does not affect model requests.

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

Mount this plugin in the browser roster of an Ahel deployment. The Web application bundle mounts it as the `ui-brand-ahel` row.

### Brand artwork

The tile is a red `#e42238` rounded square with a cream `#f6f1e7` chain-link glyph; both inks stay fixed in light and dark themes. The wordmark is lowercase "ahel" in Prime, drawn as outlines in the surrounding text color, so it follows the sidebar ink in both themes. Both come from `@ahel/dsh-client-ui-primitives` (`AhelTile`, `BrandWordmark`).

### Replacing the brand

A deployment with another identity leaves this package out and composes another package that occupies the same slots. Occupying a slot is the only composition route; there is no brand configuration surface here.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The two sidebar occupants install as one declaration-aware registration set: nested `ctx.slots.inject()` calls wait on the sidebar declaration, so the set works whether this row activates before or after the declarer, withdraws both occupants when the declaration collapses, and leaves no partial brand mix during HMR. The hero mark waits on its own declaration from the conversation package. The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat. The browser title is a build-environment concern (`DSH_CLIENT_TITLE`), outside the slot system.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the brand surface is not enough. They move from the slots this package occupies to the shell that renders them.

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.hero.brand.mark` in the hero.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **One occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.
- **The hero mark is static** — the tile does not animate on hover the way the fallback mark does.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
