---
description: "Settings > General > Web search on the dsh web client: Ahel Web Search status for the selected ahel.ai workspace and a Turn on button when it is off there."
kind: "package-reference"
---

# @ahel/dsh-client-ui-settings-web-search

English | [中文](README.zh.md)

## Summary

Web search in Ahel Desktop is Ahel Web Search through the Ahel account ([`dsh-web-search-ahel`](../../web/web-search-ahel/README.md)). This row in **Settings > General** shows "Ahel Web Search (on)" while it is on in the selected workspace, "off in this workspace" with a **Turn on** button otherwise, and a sign-in hint while signed out. There is no provider picker.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount it after `@ahel/dsh-client-ui-ahel-account`, which mounts the `ahelAccount` and `ahelCatalog` Remote namespaces this row reads. The web-app bundle mounts both.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser half follows `ahelAccount.watch`; on sign-in or a workspace change it reads `ahelCatalog.installed()` and looks for the key `ahel-services-web-search`. **Turn on** calls `ahelCatalog.add('ahel.services/web-search')` when the workspace lacks it, else `ahelCatalog.setEnabled(key, true)`, then reads again. Only the person's click writes. The Host half registers nothing.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [web-search-ahel](../../web/web-search-ahel/README.md) — the provider and the `web_search`/`web_fetch` tools.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No in-app turn off** — turning Web Search off is done in Your apps or on ahel.ai.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
