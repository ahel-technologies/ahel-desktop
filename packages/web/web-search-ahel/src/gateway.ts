/**
 * One read-only call into Ahel Web Search: an MCP `tools/call` of the Ahel
 * gateway's `use` verb on the first-party key `ahel-services-web-search`,
 * with the signed-in account's bearer and selected `?workspace=`. ahel.ai
 * meters and rate-limits each call as it does for any other host.
 * @module @ahel/dsh-web-search-ahel/gateway
 */

import { WebError } from '@ahel/dsh-web'

/** The gateway key of ahel.ai's first-party Web Search (`ahel.services/web-search`). */
export const AHEL_WEB_SEARCH_KEY = 'ahel-services-web-search'

/** The account surface this package needs; `AhelAccount` satisfies it. */
export interface AhelGatewayAccount {
  /** @returns a fresh bearer, or undefined while signed out. */
  accessToken(): Promise<string | undefined>
  /** Refresh the bearer once after the gateway refused it. */
  revalidate(): Promise<void>
  /** @returns the selected workspace id, or undefined for the account default. */
  workspace(): Promise<string | undefined>
  /** @returns the gateway URL the bearer is bound to. */
  gateway(): string
}

interface RpcAnswer {
  result?: {
    isError?: boolean
    content?: readonly { type?: string; text?: string }[]
    structuredContent?: Record<string, unknown>
  }
  error?: { message?: string }
}

/** Parse a JSON-RPC answer sent as a JSON body or as an SSE stream of `data:` lines. */
function rpcAnswer(body: string, id: number): RpcAnswer | undefined {
  const trimmed = body.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as RpcAnswer
  let found: RpcAnswer | undefined
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (data === '') continue
    try {
      const message = JSON.parse(data) as RpcAnswer & { id?: unknown }
      if (message.id === id) found = message
    } catch (_notJson) {
      // A keep-alive or progress frame; the answer is another event.
    }
  }
  return found
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

/** Calls Web Search tools through the Ahel gateway. */
export class AhelGateway {
  private rpcId = 0

  /**
   * @param account - the signed-in ahel.ai account.
   * @param timeoutMs - deadline for one gateway call.
   */
  constructor(private readonly account: AhelGatewayAccount, private readonly timeoutMs: number) {}

  /**
   * Run one Web Search tool and return its result value.
   * @param tool - `web_search` or `read_page`; both are read-only.
   * @param args - the tool's arguments.
   * @param signal - cancellation from the model tool call.
   * @returns the tool's result (`structuredContent.result`, else the parsed text).
   */
  async call(tool: 'web_search' | 'read_page', args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const url = new URL(this.account.gateway())
    const workspace = await this.account.workspace()
    if (workspace !== undefined) url.searchParams.set('workspace', workspace)
    const id = ++this.rpcId
    const body = JSON.stringify({
      jsonrpc: '2.0', id, method: 'tools/call',
      params: { name: 'use', arguments: { key: AHEL_WEB_SEARCH_KEY, tool, arguments: args } },
    })
    const deadline = AbortSignal.timeout(this.timeoutMs)
    const combined = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
    let response: Response | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.account.accessToken()
      if (token === undefined) throw new WebError('Sign in to Ahel to search the web.', 'AHEL_SIGNED_OUT')
      try {
        response = await fetch(url, {
          method: 'POST',
          // The bearer must never follow a redirect to another origin.
          redirect: 'error',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
          body,
          signal: combined,
        })
      } catch (error) {
        if (signal?.aborted === true) throw new WebError('Ahel Web Search aborted', 'WEB_ABORTED', { cause: error })
        if (isAbort(error)) throw new WebError('Ahel Web Search took too long to answer.', 'WEB_TIMEOUT', { cause: error })
        throw new WebError('Ahel did not answer. Check the connection and try again.', 'WEB_PROVIDER_ERROR', { cause: error })
      }
      if (response.status !== 401) break
      await response.body?.cancel()
      if (attempt === 0) await this.account.revalidate()
    }
    if (response === undefined || response.status === 401) {
      throw new WebError('ahel.ai no longer accepts this sign-in; sign in to Ahel again.', 'AHEL_SIGNED_OUT')
    }
    if (response.status === 429) {
      await response.body?.cancel()
      throw new WebError('Ahel is limiting how fast this workspace calls tools. Wait a minute and try again.', 'AHEL_RATE_LIMITED')
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new WebError(`Ahel answered HTTP ${response.status}.`, 'WEB_PROVIDER_ERROR')
    }
    let answer: RpcAnswer | undefined
    try {
      answer = rpcAnswer(await response.text(), id)
    } catch (error) {
      if (signal?.aborted === true) throw new WebError('Ahel Web Search aborted', 'WEB_ABORTED', { cause: error })
      answer = undefined
    }
    if (answer === undefined) throw new WebError('Ahel sent an unreadable answer.', 'WEB_PROVIDER_ERROR')
    if (answer.error !== undefined) throw new WebError(answer.error.message ?? `${tool} failed`, 'WEB_PROVIDER_ERROR')
    const result = answer.result ?? {}
    const text = (result.content ?? []).map(part => part.text ?? '').join('\n').trim()
    if (result.isError === true) {
      if (/is not on for this account|is not installed/i.test(text)) {
        throw new WebError(
          'Ahel Web Search is off in this Ahel workspace. Turn it on in Settings > General > Web search, or at ahel.ai/app/apps.',
          'AHEL_WEB_SEARCH_OFF',
        )
      }
      throw new WebError(text === '' ? `${tool} was refused` : text, 'WEB_PROVIDER_ERROR')
    }
    const structured = result.structuredContent
    if (structured !== undefined && 'result' in structured) return structured.result
    try {
      return JSON.parse(text) as unknown
    } catch (_plainText) {
      return text
    }
  }
}
