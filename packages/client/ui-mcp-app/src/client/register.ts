/** Card registration: dictionaries, injected Session-bound server access, and the slot occupant. */
import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-mcp-app/remote'
import type { McpAppInjected } from './contract.ts'
import { McpAppCard } from './McpAppCard.tsx'
import { en, NS, zh } from './locales.ts'

/** Whether this page runs inside the desktop shell. */
function hostPlatform(): 'web' | 'desktop' {
  return /\bElectron\//.test(navigator.userAgent) ? 'desktop' : 'web'
}

/**
 * Register dictionaries and the `tool.call.app` occupant.
 * @param ctx - Client context with the mounted `mcpApps` namespace, slots, and locale.
 * @param config - card limits.
 * @param config.maxHeight - largest card height in CSS pixels.
 */
export function registerMcpAppCard(ctx: Context, config: { maxHeight: number }): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-mcp-app: dictionaries')
  const colorScheme: HostObservable<'light' | 'dark'> = {
    getSnapshot: () => ctx.get('theme')?.getTheme().active.colorScheme ?? 'light',
    subscribe: listener => ctx.on('theme/change', () => { listener() }),
  }
  const platform = hostPlatform()
  ctx.slots.inject('tool.call.app', () => ctx.slots.register({
    name: 'tool.call.app',
    locale: NS,
    inject: (sessionId): McpAppInjected => ({
      readResource: async (server, uri, signal) => {
        const result = await ctx.remote.mcpApps.readResource(sessionId, server, uri, signal)
        if (!result.ok) throw result.error
        return result.value
      },
      callTool: async (server, tool, args, signal) => {
        const result = await ctx.remote.mcpApps.callTool(sessionId, server, tool, args, signal)
        if (!result.ok) throw result.error
        return result.value
      },
      resultMeta: async (callId) => {
        const result = await ctx.remote.mcpApps.resultMeta(sessionId, callId)
        return result.ok ? result.value : null
      },
      updateModelContext: (server, update) => { void ctx.remote.mcpApps.updateModelContext(sessionId, server, update) },
      // In the desktop shell the window-open handler hands http(s) URLs to the
      // system browser; on the Web it opens a new tab without an opener.
      openLink: (url) => { window.open(url, '_blank', 'noopener,noreferrer') },
      maxHeight: config.maxHeight,
      platform,
      hooks: { colorScheme },
    }),
  }, McpAppCard))
}
