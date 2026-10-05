/**
 * Scoped MCP resource providers and the shared model-facing resource tools.
 *
 * @module @deepseek-ai/dsh-mcp-resources
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createScope, NamedEntries, ScopedLayers, scopeOf, type ScopeKey, type ScopeLayer } from '@deepseek-ai/dsh-scope'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { registerResourceTools } from './tools.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcpResources: McpResourceRuntime
  }
}

/** One supported resource operation, with server-owned cursors and URIs. */
export type McpResourceRequest =
  | { method: 'resources/list' | 'resources/templates/list'; cursor?: string }
  | { method: 'resources/read'; uri: string }

/** Cancellation for one provider operation. */
export interface McpResourceRequestOptions {
  /** Caller-owned cancellation. */
  readonly signal: AbortSignal
}

/** One configured server's resource access, owned by its MCP connection plugin. */
export interface McpResourceProvider {
  /**
   * Run an operation against one live connection generation.
   * @param request - MCP resource method and parameters.
   * @param options - cancellation for this invocation.
   * @returns the protocol result as lossless JSON.
   */
  request(request: McpResourceRequest, options: McpResourceRequestOptions): Promise<JsonValue>
  /**
   * Current connection generation. A changed value invalidates cached
   * `ui://` reads, because a reconnected server may serve different content.
   * @returns a counter that changes whenever the provider reconnects.
   */
  generation?(): number
}

/** Resource runtime configuration. */
export interface Config {
  /** Cached `ui://` reads kept per server provider (least recently used evicted first). */
  appResourceCacheEntries?: number
}

/** Cached `resources/read` results of one provider, in least-recently-used order. */
type AppResourceCache = Map<string, Promise<JsonValue>>

class ResourceLayer implements ScopeLayer {
  readonly servers = new NamedEntries<McpResourceProvider>(name =>
    new Error(`MCP resource server "${name}" is already registered in this scope`))
  disposeTools: (() => void | Promise<void>) | undefined

  isEmpty(): boolean {
    return this.servers.isEmpty()
  }
}

/** Scoped resource access plus three tools shared by configured MCP servers. */
export class McpResourceRuntime extends Service {
  /** Tool registry required by the resource consumer. */
  static inject = ['tools']

  static Config: z<Config> = z.object({
    appResourceCacheEntries: z.natural().min(1).default(16),
  })

  private readonly layers = new ScopedLayers(() => new ResourceLayer(), () => undefined)
  /** Shared tool registrations outlive any one server's registering context. */
  private readonly selfCtx: Context
  private readonly appResourceCacheEntries: number
  private readonly appResourceCaches = new WeakMap<McpResourceProvider, AppResourceCache>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'mcpResources')
    this.selfCtx = ctx
    this.appResourceCacheEntries = config.appResourceCacheEntries ?? 16

    ctx.inject(['systemPrompt'], (inner) => {
      inner.systemPrompt.section({
        name: 'mcp-resource-servers',
        order: inner.systemPrompt.getSectionOrder('MCP_SERVERS'),
        interpolate: false,
        text: ({ scope }) => {
          const names = [...this.layers.merge(scope, layer => layer.servers).keys()].sort()
          return names.length === 0 ? '' : '## MCP resource servers\n\n'
            + 'Use list_mcp_resources, list_mcp_resource_templates, or read_mcp_resource with one of these names '
            + `as the server argument: ${JSON.stringify(names)}.`
        },
      })
    })
  }

  /**
   * Register one server and expose resource tools while that scope has providers.
   * @param server - configured server name, unique in this scope.
   * @param provider - connection-owned resource operations.
   * @returns the effect disposer for this exact registration.
   */
  register(server: string, provider: McpResourceProvider): () => void {
    const ctx = this.ctx
    const scope = scopeOf(ctx)
    const dispose = ctx.effect(function* (this: McpResourceRuntime) {
      let disposal: void | Promise<void>
      // Tools disappear synchronously; Cordis owns any pending scoped-fiber teardown.
      yield () => disposal
      yield this.layers.effect(ctx, (layer) => {
        const first = layer.servers.isEmpty()
        const remove = layer.servers.insert(server, provider)
        try {
          if (first) layer.disposeTools = this.registerTools(scope)
        } catch (error) {
          remove()
          throw error
        }
        return () => {
          remove()
          // oxlint-disable-next-line typescript/no-non-null-assertion -- successful provider registration owns the shared tools
          if (layer.servers.isEmpty()) disposal = layer.disposeTools!()
        }
      }, { label: `mcpResources.provider(${server})` })
    }.bind(this), `mcpResources.register(${server})`)
    // oxlint-disable-next-line typescript/no-misused-promises -- visibility cleanup is synchronous; Cordis retains pending fiber disposal
    return dispose
  }

  /** Own one scope's tools independently of its configured server plugins. */
  private registerTools(scope: ScopeKey | undefined): () => void | Promise<void> {
    const ctx = this.selfCtx
    return ctx.effect(function* (this: McpResourceRuntime) {
      let toolCtx = ctx
      if (scope !== undefined) {
        const owned = createScope(ctx, scope)
        yield owned.rawDispose
        toolCtx = owned.ctx
      }
      yield registerResourceTools(toolCtx, (server, request, exec) => this.request(server, request, exec))
    }.bind(this), 'mcpResources.tools')
  }

  /**
   * Read one resource for an MCP Apps host on behalf of an agent. `ui://`
   * results are cached per server provider, connection generation, and URI
   * (the URI carries the server's content version); other URIs are read
   * uncached. A failed read is never cached.
   * @param agent - agent whose scope selects the server.
   * @param server - configured server name visible to that agent.
   * @param uri - resource URI to read.
   * @param signal - caller cancellation; it stops this caller's wait, not a shared cached read.
   * @returns the `resources/read` result as lossless JSON.
   */
  async readAppResource(agent: ToolExecution['agent'], server: string, uri: string, signal: AbortSignal): Promise<JsonValue> {
    const provider = this.provider(agent, server)
    if (!uri.startsWith('ui://')) return await provider.request({ method: 'resources/read', uri }, { signal })
    signal.throwIfAborted()
    const cache = this.appResourceCaches.get(provider) ?? new Map<string, Promise<JsonValue>>()
    this.appResourceCaches.set(provider, cache)
    const key = `${provider.generation?.() ?? 0}\0${uri}`
    let pending = cache.get(key)
    if (pending === undefined) {
      // The shared read is bounded by the provider's own request timeout, so
      // one caller's cancellation does not fail the other waiters.
      pending = provider.request({ method: 'resources/read', uri }, { signal: new AbortController().signal })
      const owned = pending
      void owned.catch(() => { if (cache.get(key) === owned) cache.delete(key) })
      if (cache.size >= this.appResourceCacheEntries) {
        const oldest = cache.keys().next()
        if (oldest.done !== true) cache.delete(oldest.value)
      }
    } else {
      cache.delete(key)
    }
    cache.set(key, pending)
    return await raceAbort(pending, signal)
  }

  /** Resolve the caller-visible server before starting any network operation. */
  private request(server: string, request: McpResourceRequest, exec: ToolExecution): Promise<JsonValue> {
    return this.provider(exec.agent, server).request(request, exec)
  }

  private provider(agent: ToolExecution['agent'], server: string): McpResourceProvider {
    const provider = this.layers.merge(agent, layer => layer.servers).get(server)
    if (!provider) throw new Error(`MCP resource server "${server}" is unavailable in this agent's scope`)
    return provider
  }
}

/** Settle with `promise`, or reject with the signal's reason once it aborts first. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(signal.reason as Error) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => { signal.removeEventListener('abort', onAbort) })
  })
}

export default McpResourceRuntime
