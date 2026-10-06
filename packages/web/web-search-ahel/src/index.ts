/**
 * Ahel Web Search for the `ctx.web` seam. Search and fetch both run on
 * ahel.ai's first-party, read-only Web Search app through the signed-in
 * account, so the model gets the usual `web_search` and `web_fetch` tools
 * with no key to configure. This plugin mounts `dsh-tool-web` as a child
 * only while an Ahel account is signed in: signed out, both tools are absent.
 * @module @ahel/dsh-web-search-ahel
 */

import type { Context, Fiber } from '@ahel/cordis'
import z from '@ahel/schemastery'
import type {} from '@ahel/dsh-ahel-account'
import * as ToolWeb from '@ahel/dsh-tool-web'
import { WebError } from '@ahel/dsh-web'
import type {
  WebFetchProvider, WebFetchRequest, WebFetchResult, WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource,
} from '@ahel/dsh-web'
import { AhelGateway } from './gateway.ts'
import type { AhelGatewayAccount } from './gateway.ts'

export { AHEL_WEB_SEARCH_KEY, AhelGateway } from './gateway.ts'
export type { AhelGatewayAccount } from './gateway.ts'

/** Provider id for both capabilities. */
export const AHEL_PROVIDER_ID = 'ahel'

/** Web Search answers at most this many results per query. */
const AHEL_MAX_RESULTS = 10

/** Results asked for when the request names no bound. */
const AHEL_DEFAULT_RESULTS = 5

/** Cap on page text kept from one `read_page` answer (the service itself caps at 40 KB). */
const FETCH_MAX_CHARS = 100_000

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-ahel'

/** The web seam and the account it searches with. */
export const inject = ['web', 'ahelAccount']

/** Plugin config. */
export interface Config {
  /** Deadline for one gateway call, in milliseconds. */
  requestTimeoutMs?: number
  /** Config handed to the `dsh-tool-web` child mounted while signed in. */
  tools?: ToolWeb.Config
}

export const Config: z<Config> = z.object({
  requestTimeoutMs: z.number().min(1_000).max(120_000).default(45_000),
  tools: ToolWeb.Config,
})

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * Map Web Search's `web_search` answer (`[{title, url, snippet}]`) to seam sources.
 * @param value - the tool's result value.
 * @returns sources with a URL; others are dropped.
 */
export function mapSearchResult(value: unknown): WebSearchSource[] {
  if (!Array.isArray(value)) return []
  const sources: WebSearchSource[] = []
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    const url = text(row.url)
    if (url === undefined) continue
    const title = text(row.title)
    const snippet = text(row.snippet)
    sources.push({ url, ...title === undefined ? {} : { title }, ...snippet === undefined ? {} : { snippet } })
  }
  return sources
}

/** Search through Ahel Web Search. */
export class AhelSearchProvider implements WebSearchProvider {
  readonly id = AHEL_PROVIDER_ID

  /**
   * @param gateway - the Ahel gateway client.
   * @param signedIn - cheap local sign-in check.
   */
  constructor(private readonly gateway: AhelGateway, private readonly signedIn: () => boolean) {}

  available(): boolean {
    return this.signedIn()
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const limit = Math.max(1, Math.min(AHEL_MAX_RESULTS, request.maxResults ?? AHEL_DEFAULT_RESULTS))
    const value = await this.gateway.call('web_search', { query: request.query, limit }, signal)
    return { sources: mapSearchResult(value), truncated: false }
  }
}

/** Read one public page through Ahel Web Search (`read_page`). */
export class AhelFetchProvider implements WebFetchProvider {
  readonly id = AHEL_PROVIDER_ID

  /**
   * @param gateway - the Ahel gateway client.
   * @param signedIn - cheap local sign-in check.
   */
  constructor(private readonly gateway: AhelGateway, private readonly signedIn: () => boolean) {}

  available(): boolean {
    return this.signedIn()
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    let url: URL
    try {
      url = new URL(request.url)
    } catch (error) {
      throw new WebError(`not a valid URL: ${request.url}`, 'WEB_INVALID_URL', { cause: error })
    }
    // Only public web pages: no file:, data: or other local schemes. ahel.ai also refuses private addresses.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new WebError('only http and https URLs can be fetched', 'WEB_INVALID_URL')
    }
    const value = await this.gateway.call('read_page', { url: url.href }, signal)
    const page = typeof value === 'string' ? value : JSON.stringify(value)
    const source = /^Source: (\S+)$/m.exec(page.slice(0, 2_000))?.[1]
    const capped = page.length > FETCH_MAX_CHARS
    return {
      url: source !== undefined && URL.canParse(source) ? source : url.href,
      statusCode: 200,
      body: { kind: 'text', content: capped ? page.slice(0, FETCH_MAX_CHARS) : page },
      truncated: capped || page.includes('[Content truncated'),
    }
  }
}

/**
 * Register the Ahel providers and keep `web_search`/`web_fetch` mounted
 * exactly while an Ahel account is signed in.
 * @param ctx - Host context with `web` and `ahelAccount`.
 * @param config - resolved config.
 */
export function apply(ctx: Context, config: Config): void {
  const account: AhelGatewayAccount = ctx.ahelAccount
  const gateway = new AhelGateway(account, config.requestTimeoutMs ?? 45_000)
  let signedIn = false
  ctx.web.registerSearchProvider(new AhelSearchProvider(gateway, () => signedIn))
  ctx.web.registerFetchProvider(new AhelFetchProvider(gateway, () => signedIn))

  let tools: Fiber | undefined
  const sync = (next: boolean): void => {
    signedIn = next
    if (next && tools === undefined) {
      tools = ctx.plugin(ToolWeb, config.tools ?? {})
    } else if (!next && tools !== undefined) {
      const mounted = tools
      tools = undefined
      void Promise.resolve(mounted.dispose()).catch((error: unknown) => {
        ctx.logger.warn(`web-search-ahel: the web tools did not unmount cleanly: ${String(error)}`)
      })
    }
  }
  ctx.on('ahel-account/changed', (view) => { sync(view.status === 'signed-in') })
  void ctx.ahelAccount.state().then(
    (view) => { sync(view.status === 'signed-in') },
    (error: unknown) => { ctx.logger.warn(`web-search-ahel: the Ahel sign-in could not be read: ${String(error)}`) },
  )
}
