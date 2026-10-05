# Discover and Your apps

The sidebar's Discover and Your apps panels show the ahel.ai catalog and the person's installs. Both read ahel.ai's own server state, so the desktop and the website always agree.

- Browse: an anonymous `GET https://ahel.ai/api/public/catalog-search?view=listing`, the listing ahel.ai/discover uses (24 rows a page, kind and category facets). It works signed out.
- Installs and writes: the MCP tools `installed`, `install` and `switch`, sent as a JSON-RPC `tools/call` POST straight to `https://mcp.ahel.ai/mcp` with the `AHEL_ACCOUNT` bearer and `?workspace=` when one is selected. On a 401 the token is refreshed once.
- Host: `packages/credentials/ahel-account/src/catalog.ts` (`ahelCatalog`). Client: `packages/client/ui-ahel-account/src/client/catalog/`.

No tool-list refresh follows an install. Ahel's `tools/list` is fixed by design; the model reaches new capabilities in the same chat through `installed`, `tools` and `use`.

## Known gaps

- MCP has no remove verb. "Remove on ahel.ai" links to ahel.ai/app/apps.
- The public listing ignores an organisation's trust floor. When `install` refuses, the server's sentence shows in place.
- The signed-in HTTP routes (`/api/catalog/search?view=discover`, `/api/stack/*`) accept only a cookie, so the desktop does not use them.
