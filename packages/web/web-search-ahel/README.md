---
description: "Ahel Web Search for the web seam: web_search and web_fetch run on ahel.ai's read-only Web Search app through the signed-in Ahel account, and exist only while signed in."
kind: "package-reference"
---

# @ahel/dsh-web-search-ahel

English | [中文](README.zh.md)

## Summary

Search and page reads through ahel.ai's first-party Web Search app (`ahel.services/web-search`, gateway key `ahel-services-web-search`). Each call is an MCP `tools/call` of the Ahel gateway's `use` verb with the `AHEL_ACCOUNT` bearer and the selected `?workspace=`. `web_search` maps to Web Search's `web_search`; `web_fetch` maps to its `read_page`. Both are read-only. The plugin mounts [`dsh-tool-web`](../tool-web/README.md) as a child only while an Ahel account is signed in, so signed out the model has neither tool.

## Table of Contents

- [Use this package](#use-this-package)
- [Limits and failures](#limits-and-failures)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

```yaml
- id: web
  name: '@ahel/dsh-web'
  config: { searchProvider: ahel, fetchProvider: ahel }
- id: web-search-ahel
  name: '@ahel/dsh-web-search-ahel'
  config:
    requestTimeoutMs: 45000
    tools: { searchMaxQueries: 3 }
```

| Field | Default | Meaning |
|---|---|---|
| `requestTimeoutMs` | `45000` | Deadline for one gateway call |
| `tools` | tool-web defaults | Config for the `dsh-tool-web` child |

It injects `web` and `ahelAccount`; the bearer goes only to `ahelAccount.gateway()`, the URL the grant is bound to, and redirects are refused.

<a id="limits-and-failures"></a>
## Limits and failures

- ahel.ai meters every call: one cent from the workspace balance per search query or page read. A `web_search` call with three queries is three calls.
- ahel.ai rate-limits the workspace per minute (plan rate; Ahel Desktop clients at least 120) and per day; Web Search itself caps its own load. HTTP 429 fails as `AHEL_RATE_LIMITED`.
- Web Search returns at most 10 results per query and at most 40 KB of page text; this package also caps page text at 100,000 characters. Only `http:` and `https:` URLs are sent; ahel.ai refuses private and loopback addresses.
- Web Search off in the workspace fails as `AHEL_WEB_SEARCH_OFF` with a sentence pointing to Settings > General > Web search. Signed out or a refused grant fails as `AHEL_SIGNED_OUT`.

<a id="model-experience"></a>
## Model Experience

The model sees `dsh-tool-web`'s `web_search` and `web_fetch` tools and their output format; this package adds no prompt text. A fetched page arrives as text (`body.kind: 'text'`) headed by Web Search's `# title` and `Source:` lines.

#### KV Cache effect

Signing in or out adds or removes two tool definitions, which changes the tool list of the next request.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work


- `web_fetch` reports HTTP 200 for every page Web Search could read; Web Search does not pass the origin status through.
- Web Search's `screenshot` tool is not exposed; it stays reachable through the Ahel MCP server.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
