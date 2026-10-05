/**
 * Remote namespace `ahelCatalog`: the ahel.ai Discover catalog and the
 * signed-in person's installs. Browsing reads the anonymous public listing
 * that ahel.ai/discover reads; installs, the installed list and on/off go
 * through the Ahel MCP gateway's `install`, `installed` and `switch` tools
 * with the account's own OAuth grant, so the desktop and ahel.ai read and
 * write the same server state.
 */

import type { Context } from '@ahel/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@ahel/dsh-typert-protocol'
import type {
  CatalogBrowsePage, CatalogBrowseQuery, CatalogCapability, CatalogGroup, CatalogInstalled, CatalogInstallResult, CatalogPart, CatalogRow,
  CatalogSwitchResult,
} from './types.ts'

declare module '@ahel/cordis' {
  interface Context {
    ahelCatalog: AhelCatalog
  }
}

declare module '@ahel/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** ahel.ai rate-limited the catalog listing; retry shortly. */
    'ahel-catalog/busy': { readonly retryAfterSec: number | null }
    /** ahel.ai did not answer, timed out, or answered a server error. */
    'ahel-catalog/unreachable': { readonly status: number | null }
    /** No Ahel account is signed in, or ahel.ai refused its grant after one refresh. */
    'ahel-catalog/signed-out': Record<string, never>
    /** The gateway refused the request; the message is ahel.ai's own sentence. */
    'ahel-catalog/refused': { readonly tool: string }
  }
}

/** Origins passed by the parent `AhelAccount`. */
export interface CatalogConfig {
  /** ahel.ai origin serving `/api/public/catalog-search`. */
  appOrigin: string
  /** The Ahel MCP gateway URL the grant is bound to. */
  resource: string
}

const TIMEOUT_MS = 15_000

interface JsonRpcAnswer {
  result?: { isError?: boolean; content?: readonly { type?: string; text?: string }[]; structuredContent?: Record<string, unknown> }
  error?: { message?: string }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Parse a JSON-RPC answer sent either as a JSON body or as an SSE stream of `data:` lines. */
function rpcAnswer(body: string, id: number): JsonRpcAnswer | undefined {
  const trimmed = body.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as JsonRpcAnswer
  let found: JsonRpcAnswer | undefined
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (data === '') continue
    try {
      const message = JSON.parse(data) as JsonRpcAnswer & { id?: unknown }
      if (message.id === id) found = message
    } catch (_notJson) {
      // A keep-alive or comment frame; the answer is another event.
    }
  }
  return found
}

function capability(value: unknown): CatalogCapability {
  const row = record(value)
  const state = text(row.state)
  return {
    key: text(row.key) ?? '',
    name: text(row.name) ?? text(row.key) ?? '',
    type: text(row.type),
    ...text(row.servedBy) === null ? {} : { servedBy: text(row.servedBy) as string },
    state: state === 'on' || state === 'off' || state === 'needs_setup' || state === 'available' ? state : 'unavailable',
    needs: Array.isArray(row.needs) ? row.needs.filter((need): need is string => typeof need === 'string') : [],
    ...Array.isArray(row.missingTypes) ? { missingTypes: row.missingTypes.filter((type): type is string => typeof type === 'string') } : {},
    ...'itemId' in row ? { itemId: text(row.itemId) } : {},
    ...text(row.signInUrl) === null ? {} : { signInUrl: text(row.signInUrl) as string },
    reason: text(row.reason),
  }
}

/** Child service of `AhelAccount`; the Remote namespace `ahelCatalog`. */
export class AhelCatalog extends TypertRemoteService {
  static inject = ['ahelAccount']
  private readonly appOrigin: string
  private readonly resource: string
  private rpcId = 0

  /**
   * @param ctx - Host context carrying `ahelAccount`.
   * @param config - origins from the parent account plugin.
   */
  constructor(ctx: Context, config: CatalogConfig) {
    super(ctx, 'ahelCatalog')
    this.appOrigin = config.appOrigin
    this.resource = config.resource
  }

  /**
   * One page of the Discover listing; works signed out.
   * @param query - search words, kind, category and page.
   * @returns the page with every link and mark made absolute on ahel.ai.
   * @throws RemoteError `ahel-catalog/busy` or `ahel-catalog/unreachable`.
   */
  @Remote
  async browse(query: CatalogBrowseQuery): Promise<CatalogBrowsePage> {
    const page = record(await this.listing(this.listingUrl(query)))
    const groups = Array.isArray(page.groups) ? page.groups.map(group => this.group(group)) : []
    const kinds = record(page.kinds)
    return {
      total: Number(page.total ?? 0),
      page: Number(page.page ?? 0),
      pageSize: Number(page.pageSize ?? groups.length),
      groups,
      kinds: { app: Number(kinds.app ?? 0), skill: Number(kinds.skill ?? 0) },
      categories: record(page.categories) as Record<string, number>,
    }
  }

  /**
   * A further slice of one group's nested skills.
   * @param query - the query the group was listed under.
   * @param groupKey - `CatalogGroup.key`.
   * @param offset - rows of the nest already shown.
   * @returns the slice and how many rows remain.
   * @throws RemoteError `ahel-catalog/busy` or `ahel-catalog/unreachable`.
   */
  @Remote
  async browsePart(query: CatalogBrowseQuery, groupKey: string, offset: number): Promise<CatalogPart> {
    const url = this.listingUrl({ ...query, page: 0 })
    url.searchParams.set('group', groupKey)
    url.searchParams.set('part', 'skills')
    url.searchParams.set('offset', String(Math.max(0, Math.floor(offset))))
    const part = record(await this.listing(url))
    return {
      rows: Array.isArray(part.rows) ? part.rows.map(row => this.row(row)) : [],
      remaining: Number(part.remaining ?? 0),
    }
  }

  /**
   * The signed-in person's capabilities in the selected workspace.
   * @returns the rows, or `signedIn: false` with none while signed out.
   * @throws RemoteError `ahel-catalog/signed-out`, `ahel-catalog/refused` or `ahel-catalog/unreachable`.
   */
  @Remote
  async installed(): Promise<CatalogInstalled> {
    if (await this.ctx.ahelAccount.accessToken() === undefined) return { signedIn: false, rows: [] }
    const answer = await this.mcpCall('installed', {})
    const capabilities = Array.isArray(answer.capabilities) ? answer.capabilities : []
    return { signedIn: true, rows: capabilities.map(capability) }
  }

  /**
   * Install one catalog item, or answer how to connect an "app:<service>" row.
   * @param id - `CatalogRow.id`.
   * @returns the install outcome; `needs_setup` carries the URL to open in the browser.
   * @throws RemoteError `ahel-catalog/signed-out`, `ahel-catalog/refused` or `ahel-catalog/unreachable`.
   */
  @Remote
  async install(id: string): Promise<CatalogInstallResult> {
    const result = record((await this.mcpCall('install', { id })).install)
    return {
      key: text(result.key),
      name: text(result.name) ?? id,
      type: text(result.type) ?? '',
      state: text(result.state) ?? 'unavailable',
      needs: Array.isArray(result.needs) ? result.needs.filter((need): need is string => typeof need === 'string') : [],
      ...text(result.signInUrl) === null ? {} : { signInUrl: text(result.signInUrl) as string },
      ...text(result.connectUrl) === null ? {} : { connectUrl: text(result.connectUrl) as string },
      note: text(result.note) ?? '',
      try: text(result.try),
    }
  }

  /**
   * Turn one installed capability on or off.
   * @param key - `CatalogCapability.key`.
   * @param on - the wanted state.
   * @returns the state ahel.ai stored.
   * @throws RemoteError `ahel-catalog/signed-out`, `ahel-catalog/refused` or `ahel-catalog/unreachable`.
   */
  @Remote
  async setEnabled(key: string, on: boolean): Promise<CatalogSwitchResult> {
    const answer = await this.mcpCall('switch', { key, state: on ? 'on' : 'off' })
    return { key: text(answer.key) ?? key, state: text(answer.state) ?? (on ? 'on' : 'off') }
  }

  private listingUrl(query: CatalogBrowseQuery): URL {
    const url = new URL('/api/public/catalog-search', this.appOrigin)
    url.searchParams.set('view', 'listing')
    url.searchParams.set('q', query.q)
    if (query.kind !== 'all') url.searchParams.set('kind', query.kind)
    if (query.category !== null && query.category !== '') url.searchParams.set('category', query.category)
    if (query.page > 0) url.searchParams.set('page', String(Math.floor(query.page)))
    return url
  }

  private async listing(url: URL): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (error) {
      throw new RemoteError('ahel-catalog/unreachable', `ahel.ai did not answer: ${error instanceof Error ? error.message : String(error)}`, { status: null })
    }
    if (response.status === 429) {
      await response.body?.cancel()
      const retry = Number(response.headers.get('retry-after'))
      throw new RemoteError('ahel-catalog/busy', 'ahel.ai is busy; try again shortly', { retryAfterSec: Number.isFinite(retry) && retry > 0 ? retry : null })
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new RemoteError('ahel-catalog/unreachable', `ahel.ai answered HTTP ${response.status}`, { status: response.status })
    }
    try {
      return await response.json()
    } catch (error) {
      throw new RemoteError('ahel-catalog/unreachable', `ahel.ai sent an unreadable listing: ${String(error)}`, { status: response.status })
    }
  }

  /** Make a site path absolute on `appOrigin`; absolute URLs pass through. */
  private absolute(path: string): string {
    return new URL(path, this.appOrigin).href
  }

  private row(value: unknown): CatalogRow {
    const row = record(value)
    const tile = record(row.tile)
    const mark = text(tile.mark)
    return {
      ...row as unknown as CatalogRow,
      href: this.absolute(text(row.href) ?? '/discover'),
      tile: { ...tile as unknown as CatalogRow['tile'], mark: mark === null ? null : this.absolute(mark) },
    }
  }

  private group(value: unknown): CatalogGroup {
    const group = record(value)
    const skills = group.skills === null || group.skills === undefined ? null : record(group.skills)
    return {
      key: text(group.key) ?? '',
      row: this.row(group.row),
      skills: skills === null
        ? null
        : {
          vendorName: text(skills.vendorName) ?? '',
          count: Number(skills.count ?? 0),
          rows: Array.isArray(skills.rows) ? skills.rows.map(row => this.row(row)) : [],
        },
      copies: Number(group.copies ?? 0),
    }
  }

  /** Call one Ahel MCP tool with the account's bearer; the gateway is stateless, so no initialize. */
  private async mcpCall(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = new URL(this.resource)
    const workspace = await this.ctx.ahelAccount.workspace()
    if (workspace !== undefined) url.searchParams.set('workspace', workspace)
    const id = ++this.rpcId
    const body = JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
    let response: Response | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.ctx.ahelAccount.accessToken()
      if (token === undefined) throw new RemoteError('ahel-catalog/signed-out', 'sign in to Ahel first', {})
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch (error) {
        throw new RemoteError('ahel-catalog/unreachable', `the Ahel gateway did not answer: ${error instanceof Error ? error.message : String(error)}`, { status: null })
      }
      if (response.status !== 401) break
      await response.body?.cancel()
      if (attempt === 0) await this.ctx.ahelAccount.revalidate()
    }
    if (response === undefined || response.status === 401) {
      throw new RemoteError('ahel-catalog/signed-out', 'ahel.ai no longer accepts this sign-in; sign in to Ahel again', {})
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new RemoteError('ahel-catalog/unreachable', `the Ahel gateway answered HTTP ${response.status}`, { status: response.status })
    }
    let answer: JsonRpcAnswer | undefined
    try {
      answer = rpcAnswer(await response.text(), id)
    } catch (_unreadable) {
      answer = undefined
    }
    if (answer === undefined) throw new RemoteError('ahel-catalog/unreachable', 'the Ahel gateway sent an unreadable answer', { status: response.status })
    if (answer.error !== undefined) throw new RemoteError('ahel-catalog/refused', answer.error.message ?? `${name} failed`, { tool: name })
    const result = answer.result ?? {}
    if (result.isError === true) {
      const sentence = (result.content ?? []).map(part => part.text ?? '').join(' ').trim()
      throw new RemoteError('ahel-catalog/refused', sentence === '' ? `${name} was refused` : sentence, { tool: name })
    }
    return record(result.structuredContent)
  }
}

export default AhelCatalog
