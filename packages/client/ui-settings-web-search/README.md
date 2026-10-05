---
description: "Placeholder for the removed web-search provider settings page on the dsh web client: both halves load and register nothing."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-web-search

English | [中文](README.zh.md)

## Summary

Ahel Desktop ships no search provider for a **Web search** page under **Plugins** to edit, so both halves load and register nothing. Profiles that still name the package keep loading.

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

Do not mount it in new profiles. Removing its row from a profile changes nothing visible.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half and the browser half each export an empty `apply`; the browser half injects no services.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page where provider settings pages register.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No search settings page** — a search provider shipped later needs its own settings page.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
