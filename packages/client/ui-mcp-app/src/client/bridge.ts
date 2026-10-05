/**
 * Host side of the MCP Apps JSON-RPC bridge (`io.modelcontextprotocol/ui`,
 * protocol 2026-01-26) over `postMessage` to one sandboxed card frame.
 *
 * The bridge holds no DOM: the card component forwards only messages whose
 * `event.source` is its own frame window, and supplies a `post` function that
 * targets that window. Host notifications wait until the app sends
 * `ui/notifications/initialized`, then flush in order, as the specification
 * requires.
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { McpAppCallResult, McpAppJsonObject } from '../types.ts'

/** Protocol version this host implements. */
export const MCP_APPS_PROTOCOL_VERSION = '2026-01-26'

/** JSON-RPC error codes used by the bridge. */
export const RPC_ERRORS = {
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** MCP Apps: the host refused the request. */
  refused: -32000,
} as const

/** Display modes defined by MCP Apps; this host renders inline only. */
export type McpAppDisplayMode = 'inline' | 'fullscreen' | 'pip'

/** Host context fields sent at initialization and on change. */
export type McpAppHostContext = {
  theme?: 'light' | 'dark'
  displayMode?: McpAppDisplayMode
  availableDisplayModes?: McpAppDisplayMode[]
  containerDimensions?: { maxHeight?: number; width?: number; maxWidth?: number }
  locale?: string
  timeZone?: string
  platform?: 'web' | 'desktop' | 'mobile'
  userAgent?: string
  styles?: { variables?: { [name: string]: string } }
}

/** Host behaviour the bridge delegates to. */
export interface McpAppBridgeHandlers {
  /**
   * Run a host-proxied `tools/call` on the card's own server.
   * @param name - raw MCP tool name.
   * @param args - tool arguments.
   * @param signal - aborted when the bridge is disposed.
   * @returns MCP `CallToolResult` fields.
   */
  callTool(name: string, args: McpAppJsonObject, signal: AbortSignal): Promise<McpAppCallResult>
  /**
   * Read a resource from the card's own server.
   * @param uri - resource URI.
   * @param signal - aborted when the bridge is disposed.
   * @returns the `resources/read` result.
   */
  readResource(uri: string, signal: AbortSignal): Promise<JsonValue>
  /**
   * Open an `http:` or `https:` URL outside the card.
   * @param url - absolute URL the app asked to open.
   */
  openLink(url: string): void
  /**
   * Whether the user is interacting with the page right now (transient user
   * activation; a click inside the card frame activates its host page).
   * @returns true when a link may open.
   */
  hasUserActivation(): boolean
  /**
   * Report a changed `ui/update-model-context` payload for the next model turn.
   * @param update - the payload: `content` blocks and optional `structuredContent`.
   */
  updateModelContext(update: McpAppJsonObject): void
  /**
   * Apply the app's preferred content size.
   * @param size - requested width and height in CSS pixels.
   */
  sizeChanged(size: { width?: number; height?: number }): void
}

/** Construction options for {@link McpAppBridge}. */
export interface McpAppBridgeOptions {
  /** Deliver one message to the card frame. */
  post(message: JsonValue): void
  /** Host identity reported to the app. */
  hostInfo: { name: string; version: string }
  /** Initial host context. */
  hostContext: McpAppHostContext
  /** Host behaviour. */
  handlers: McpAppBridgeHandlers
  /** Clock for link throttling; defaults to `Date.now`. */
  now?: () => number
}

/** Shortest interval between two links one card may open. */
export const LINK_INTERVAL_MS = 3000

type RequestId = string | number

type RpcMessage = {
  jsonrpc: '2.0'
  id?: RequestId
  method?: string
  params?: McpAppJsonObject
  result?: JsonValue
  error?: { code: number; message: string }
}

class RpcFailure extends Error {
  constructor(readonly code: number, message: string) {
    super(message)
  }
}

function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read one JSON-RPC 2.0 message from an untrusted `postMessage` payload.
 * @param data - the event data.
 * @returns the message, or `null` when it is not a JSON-RPC 2.0 object.
 */
export function readRpcMessage(data: unknown): RpcMessage | null {
  if (!isObject(data) || data.jsonrpc !== '2.0') return null
  const id = data.id
  if (id !== undefined && typeof id !== 'string' && typeof id !== 'number') return null
  if (data.method !== undefined && typeof data.method !== 'string') return null
  if (data.params !== undefined && !isObject(data.params)) return null
  if (data.method === undefined && id === undefined) return null
  const error = data.error
  return {
    jsonrpc: '2.0',
    ...id === undefined ? {} : { id },
    ...typeof data.method === 'string' ? { method: data.method } : {},
    ...isObject(data.params) ? { params: data.params as McpAppJsonObject } : {},
    ...data.result === undefined ? {} : { result: data.result as JsonValue },
    ...isObject(error) ? { error: { code: typeof error.code === 'number' ? error.code : RPC_ERRORS.internal, message: String(error.message) } } : {},
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    // An unparsable string is not an openable URL.
    return false
  }
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Host end of one card's MCP Apps session. One bridge serves one frame
 * document; a navigated or reloaded frame needs a new bridge.
 */
export class McpAppBridge {
  private readonly options: McpAppBridgeOptions
  private hostContext: McpAppHostContext
  private initialized = false
  private disposed = false
  private readonly queued: RpcMessage[] = []
  private readonly abort = new AbortController()
  private nextId = 1
  private readonly pending = new Map<RequestId, (outcome: { ok: boolean }) => void>()
  private modelContext: McpAppJsonObject | undefined
  private toolCallRunning = false
  private lastLinkAt = Number.NEGATIVE_INFINITY

  /** @param options - frame delivery, host identity, initial context, and handlers. */
  constructor(options: McpAppBridgeOptions) {
    this.options = options
    this.hostContext = options.hostContext
  }

  /** Whether the app completed `ui/initialize` and `ui/notifications/initialized`. */
  get isInitialized(): boolean {
    return this.initialized
  }

  /** The latest `ui/update-model-context` payload, kept for a later model turn. */
  get latestModelContext(): McpAppJsonObject | undefined {
    return this.modelContext
  }

  /**
   * Handle one message from the card frame. Callers forward only events whose
   * `source` is this card's frame window; malformed payloads are ignored.
   * @param data - the `MessageEvent.data` value.
   */
  receive(data: unknown): void {
    if (this.disposed) return
    const message = readRpcMessage(data)
    if (message === null) return
    if (message.method === undefined) {
      this.settleResponse(message)
      return
    }
    if (message.id === undefined) {
      this.handleNotification(message.method, message.params ?? {})
      return
    }
    void this.handleRequest(message.id, message.method, message.params ?? {})
  }

  /**
   * Send the complete tool arguments (`ui/notifications/tool-input`).
   * @param args - the call's arguments.
   */
  sendToolInput(args: McpAppJsonObject): void {
    this.notify('ui/notifications/tool-input', { arguments: args })
  }

  /**
   * Send the settled tool result (`ui/notifications/tool-result`).
   * @param result - MCP `CallToolResult` fields.
   */
  sendToolResult(result: McpAppCallResult): void {
    this.notify('ui/notifications/tool-result', { ...result })
  }

  /**
   * Report that the tool call was cancelled or failed (`ui/notifications/tool-cancelled`).
   * @param reason - human-readable reason.
   */
  sendToolCancelled(reason: string): void {
    this.notify('ui/notifications/tool-cancelled', { reason })
  }

  /**
   * Replace the host context and send the changed fields
   * (`ui/notifications/host-context-changed`).
   * @param next - complete new host context.
   */
  setHostContext(next: McpAppHostContext): void {
    const changed: McpAppJsonObject = {}
    for (const [key, value] of Object.entries(next)) {
      if (JSON.stringify(value) !== JSON.stringify(this.hostContext[key as keyof McpAppHostContext])) {
        changed[key] = value
      }
    }
    this.hostContext = next
    if (Object.keys(changed).length > 0) this.notify('ui/notifications/host-context-changed', changed)
  }

  /**
   * Ask the app to release its resources (`ui/resource-teardown`) and wait for
   * its answer or the deadline, then dispose the bridge.
   * @param timeoutMs - longest wait for the app's answer.
   * @returns after the app answered or the deadline passed.
   */
  async teardown(timeoutMs: number): Promise<void> {
    if (this.disposed) return
    if (this.initialized) {
      const id = `host-${this.nextId++}`
      const answered = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(id)
          resolve()
        }, timeoutMs)
        this.pending.set(id, () => {
          clearTimeout(timer)
          resolve()
        })
      })
      this.post({ jsonrpc: '2.0', id, method: 'ui/resource-teardown', params: {} })
      await answered
    }
    this.dispose()
  }

  /** Stop handling messages and abort in-flight host work. Idempotent. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.abort.abort()
    for (const settle of this.pending.values()) settle({ ok: false })
    this.pending.clear()
    this.queued.length = 0
  }

  private post(message: RpcMessage): void {
    if (this.disposed) return
    this.options.post(message)
  }

  private notify(method: string, params: McpAppJsonObject): void {
    const message: RpcMessage = { jsonrpc: '2.0', method, params }
    if (this.initialized) this.post(message)
    else if (!this.disposed) this.queued.push(message)
  }

  private settleResponse(message: RpcMessage): void {
    if (message.id === undefined) return
    const settle = this.pending.get(message.id)
    if (settle === undefined) return
    this.pending.delete(message.id)
    settle({ ok: message.error === undefined })
  }

  private handleNotification(method: string, params: McpAppJsonObject): void {
    switch (method) {
      case 'ui/notifications/initialized': {
        if (this.initialized) return
        this.initialized = true
        for (const message of this.queued.splice(0)) this.post(message)
        return
      }
      case 'ui/notifications/size-changed': {
        const width = finiteOrUndefined(params.width)
        const height = finiteOrUndefined(params.height)
        this.options.handlers.sizeChanged({
          ...width === undefined ? {} : { width },
          ...height === undefined ? {} : { height },
        })
        return
      }
      default:
        // `notifications/message` (logging), `ui/notifications/request-teardown`
        // (which a host may ignore), and unknown notifications need no action.
        return
    }
  }

  private async handleRequest(id: RequestId, method: string, params: McpAppJsonObject): Promise<void> {
    try {
      const result = await this.dispatch(method, params)
      this.post({ jsonrpc: '2.0', id, result })
    } catch (error: unknown) {
      const code = error instanceof RpcFailure ? error.code : RPC_ERRORS.internal
      const message = error instanceof Error ? error.message : String(error)
      this.post({ jsonrpc: '2.0', id, error: { code, message } })
    }
  }

  private async dispatch(method: string, params: McpAppJsonObject): Promise<JsonValue> {
    const handlers = this.options.handlers
    switch (method) {
      case 'ui/initialize':
        return {
          protocolVersion: MCP_APPS_PROTOCOL_VERSION,
          hostInfo: this.options.hostInfo,
          hostCapabilities: {
            openLinks: {},
            serverTools: {},
            serverResources: {},
            logging: {},
            updateModelContext: { text: {}, structuredContent: {} },
          },
          hostContext: this.hostContext,
        }
      case 'ping':
        return {}
      case 'tools/call': {
        const name = params.name
        const args = params.arguments ?? {}
        if (typeof name !== 'string' || !isObject(args)) {
          throw new RpcFailure(RPC_ERRORS.invalidParams, 'tools/call needs a name and object arguments')
        }
        // One card action at a time: a second press while one runs is refused.
        if (this.toolCallRunning) throw new RpcFailure(RPC_ERRORS.refused, 'another card action is still running')
        this.toolCallRunning = true
        try {
          return await handlers.callTool(name, args, this.abort.signal)
        } finally {
          this.toolCallRunning = false
        }
      }
      case 'resources/read': {
        const uri = params.uri
        if (typeof uri !== 'string') throw new RpcFailure(RPC_ERRORS.invalidParams, 'resources/read needs a uri')
        return await handlers.readResource(uri, this.abort.signal)
      }
      case 'ui/open-link': {
        const url = params.url
        if (typeof url !== 'string' || !isHttpUrl(url)) throw new RpcFailure(RPC_ERRORS.refused, 'only http and https links can be opened')
        if (!handlers.hasUserActivation()) throw new RpcFailure(RPC_ERRORS.refused, 'links open only from a user action')
        const now = (this.options.now ?? Date.now)()
        if (now - this.lastLinkAt < LINK_INTERVAL_MS) throw new RpcFailure(RPC_ERRORS.refused, 'links open at most once every 3 seconds')
        this.lastLinkAt = now
        handlers.openLink(url)
        return {}
      }
      case 'ui/update-model-context':
        if (JSON.stringify(params) !== JSON.stringify(this.modelContext)) handlers.updateModelContext(params)
        this.modelContext = params
        return {}
      case 'ui/request-display-mode':
        return { mode: this.hostContext.displayMode ?? 'inline' }
      case 'ui/message':
        // Starting a model turn from a card is not offered by this host.
        return { isError: true }
      default:
        throw new RpcFailure(RPC_ERRORS.methodNotFound, `method ${method} is not supported by this host`)
    }
  }
}
